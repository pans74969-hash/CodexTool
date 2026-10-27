import { isBusy } from './domain.mjs';
export class Engine {
 constructor(rpc,store,emit){this.rpc=rpc;this.store=store;this.emit=emit;this.loaded=new Set();this.pumping=false;this.phases=new Map();
  rpc.on('notification',n=>this.onEvent(n));
  rpc.on('offline',message=>{this.loaded.clear();emit('connection',{ready:false,message});});
  this.timer=setInterval(()=>this.pump().catch(()=>{}),3000);this.timer.unref();
 }
 async page(id,cursor=null,limit=12){let r;try{r=await this.rpc.call('thread/turns/list',{threadId:id,cursor,limit,sortDirection:'desc',itemsView:'full'});}catch(e){if(e.message.includes('not materialized yet'))return {data:[],nextCursor:null};throw e;}return {...r,data:r.data.map(t=>({...t,items:(t.items||[]).filter(i=>['agentMessage','userMessage'].includes(i.type))}))};}
 async read(id,cursor=null){
  const [{thread},page]=await Promise.all([this.rpc.call('thread/read',{threadId:id}),this.page(id,cursor)]);
  return {thread,turns:page.data.reverse(),nextCursor:page.nextCursor};
 }
 tasks(){return this.store.all('task');}
 update(t,patch){Object.assign(t,patch,{updatedAt:Date.now()});this.store.put('task',t.id,t);for(const b of this.store.all('branch').filter(b=>b.taskId===t.id))this.store.put('branch',b.id,{...b,status:t.status});this.emit('task',t);return t;}
 enqueue(input){const existing=this.store.get('task',input.id);if(existing)return existing;const task={...input,status:'queued',createdAt:Date.now()};this.update(task,{});this.pump().catch(()=>{});return task;}
 async reconcile(t){
  const p=await this.page(t.threadId,null,30);
  const match=p.data.find(turn=>(turn.items||[]).some(i=>i.type==='userMessage'&&(i.clientId===t.id||i.clientUserMessageId===t.id)));
  if(match){this.update(t,{turnId:match.id,status:match.status==='inProgress'?'running':match.status==='completed'?'completed':match.status==='interrupted'?'interrupted':'failed',error:match.error?.message});return true;}
  if(t.turnId){const known=p.data.find(x=>x.id===t.turnId);if(known){this.update(t,{status:known.status==='inProgress'?'running':known.status==='completed'?'completed':known.status==='interrupted'?'interrupted':'failed'});return true;}}
  return false;
 }
 async pump(){if(this.pumping||!this.rpc.ready)return;this.pumping=true;try{
  for(const t of this.tasks().filter(t=>['running','sending','uncertain'].includes(t.status))) {
   try {if(!await this.reconcile(t))this.update(t,{status:'uncertain',waiting:'发送结果待核对，仅暂停此对话；其他对话可继续'});}catch(e){this.update(t,{status:'uncertain',error:e.message,waiting:'发送结果待核对，仅暂停此对话；其他对话可继续'});}
  }
  // Unknown outcomes still block their own thread, but cannot starve all
  // unrelated threads. They are reconciled above and are never auto-resubmitted.
  let active=this.tasks().filter(t=>['running','sending'].includes(t.status)).length;
  for(const t of this.tasks().filter(t=>t.status==='queued')){
   active=this.tasks().filter(t=>['running','sending'].includes(t.status)).length;
   if(active>=3)break;
   if(this.tasks().some(o=>o.id!==t.id&&o.threadId===t.threadId&&['running','sending','uncertain'].includes(o.status)))continue;
   try{
    const {thread}=await this.rpc.call('thread/read',{threadId:t.threadId});const p=await this.page(t.threadId,null,2);
    if(isBusy(thread,p.data)){this.update(t,{waiting:'此对话正在 Codex 中回答，等待完成'});continue;}
    if(!this.loaded.has(t.threadId)){
     await this.rpc.call('thread/resume',{threadId:t.threadId,excludeTurns:true});this.loaded.add(t.threadId);
    }
    // Last check immediately before turn/start, including current daemon state.
    const latest=await this.rpc.call('thread/read',{threadId:t.threadId});if(isBusy(latest.thread,p.data))continue;
    if(this.store.get('task',t.id)?.status!=='queued')continue;
    this.update(t,{status:'sending',waiting:null});active++;
    const params={threadId:t.threadId,clientUserMessageId:t.id,input:[{type:'text',text:t.text}],sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'never'};
    if(t.model)params.model=t.model;if(t.effort)params.effort=t.effort;
    const r=await this.rpc.call('turn/start',params);
    this.update(t,{turnId:r.turn.id,status:r.turn.status==='completed'?'completed':'running'});
   }catch(e){
    if(t.status==='sending'&&e.code!==undefined&&/active turn|already.*running|already.*progress|busy/i.test(e.message))this.update(t,{status:'queued',waiting:'对话正在其他客户端回答，等待完成',error:null});
    else this.update(t,{status:t.status==='sending'&&e.code===undefined?'uncertain':'failed',error:e.message});
   }
  }
 }finally{this.pumping=false;}}
 onEvent(n){
  const p=n.params||{};
  if(p.item?.type==='agentMessage')this.phases.set(p.item.id,p.item.phase);
  if(n.method==='item/agentMessage/delta'&&this.phases.get(p.itemId)==='commentary')return;
  if(n.method==='turn/completed')for(const t of this.tasks().filter(t=>t.threadId===p.threadId&&t.turnId===p.turn?.id))this.update(t,{status:p.turn.status==='completed'?'completed':p.turn.status==='interrupted'?'interrupted':'failed',error:p.turn.error?.message});
  if(n.method==='client/blocked')this.emit('notice',p);
  // Stream only useful display events; never send raw tool outputs or account data.
  if(['item/agentMessage/delta','turn/started','turn/completed','thread/status/changed','item/started','item/completed'].includes(n.method)){
   if(n.method.startsWith('item/')&&!['agentMessage','userMessage'].includes(p.item?.type)&&n.method!=='item/agentMessage/delta')return;
   this.emit('codex',n);
  }
 }
 async stop(id){const t=this.store.get('task',id);if(!t)throw new Error('任务不存在');if(t.status==='queued')return this.update(t,{status:'cancelled'});if(!t.turnId)throw new Error('发送结果尚未确认，请先刷新核对');await this.rpc.call('turn/interrupt',{threadId:t.threadId,turnId:t.turnId});return t;}
 async retry(id){const t=this.store.get('task',id);if(!t)throw new Error('任务不存在');if(!['failed','interrupted','uncertain'].includes(t.status))throw new Error('此任务不能重试');if(await this.reconcile(t)){if(t.status==='completed'||t.status==='running')return t;if(t.status==='interrupted')throw new Error('已中断的消息保留在 Codex 中，请在该分支发送“请继续”');}
  if(t.turnId)throw new Error('此消息已经写入 Codex。请在原分支发送新的追问或“请继续”，不会重复发送原消息。');
  if(t.status==='uncertain')throw new Error('发送结果无法确认，暂不重复提交；请在 Codex 中核对该对话');
  return this.update(t,{status:'queued',error:null});}
}
