// Explicit end-to-end smoke test: creates a disposable real Codex conversation.
// It never sends to an existing user conversation.
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4317';
let token;
async function api(p,b){const r=await fetch(base+'/api/'+p,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},body:b===undefined?undefined:JSON.stringify(b)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
token=(await api('bootstrap')).token;
const {thread}=await api('new',{});console.log('TEST ROOT',thread.id);
const task=await api('send',{id:randomUUID(),threadId:thread.id,text:'这是枝间网页的独立验收对话。请只用两句话回答：水面遮罩使用 Alpha 通道表达透明度，加法混合让光束提亮颜色。不要调用工具。'});
async function wait(id){for(let n=0;n<100;n++){const b=await api('bootstrap'),task=b.tasks.find(t=>t.id===id);if(task?.status==='completed')return task;if(['failed','uncertain','interrupted'].includes(task?.status))throw new Error(task.status+': '+task.error);await new Promise(r=>setTimeout(r,1000));}throw new Error('验收回答等待超时');}
await wait(task.id);
const read=await api('thread?id='+thread.id);const turn=read.turns.find(t=>t.id===task.turnId)||read.turns.find(t=>t.status==='completed');const item=turn.items.findLast(i=>i.type==='agentMessage');
async function branch(parentId,turn,item,rootId,quote){const sourceText=item.text;const start=sourceText.indexOf(quote);if(start<0)throw new Error('测试词不在回答中');const id=randomUUID();const params={id,parentId,rootId,anchor:{turnId:turn.id,messageId:item.id,quote,start,end:start+quote.length,prefix:sourceText.slice(Math.max(0,start-32),start),suffix:sourceText.slice(start+quote.length,start+quote.length+32),sourceText,answerText:item.text},question:'这是界面验收。请只回复一句简单的话，不调用工具，并保留“透明度”三个字。'};const r=await api('branch',params);const again=await api('branch',params);if(r.branch.threadId!==again.branch.threadId)throw new Error('同一创建请求发生重复 fork');console.log('FORK',parentId,'->',r.branch.threadId);return r;}
const siblings=await Promise.all(['Alpha','透明度','混合'].map(q=>branch(thread.id,turn,item,thread.id,q)));
await Promise.all(siblings.map(s=>wait(s.task.id)));
let parent=siblings[0].branch.threadId;
for(let depth=2;depth<=3;depth++){const view=await api('thread?id='+parent);const turn=view.turns.findLast(t=>t.status==='completed');const item=turn.items.findLast(i=>i.type==='agentMessage');const r=await branch(parent,turn,item,thread.id,'透明度');await wait(r.task.id);parent=r.branch.threadId;}
const state=await api('bootstrap');if(state.branches.filter(b=>b.rootId===thread.id).length!==5)throw new Error('分支计数错误');
await api('position',{id:thread.id,top:123});
fs.mkdirSync('data',{recursive:true});fs.writeFileSync('data/live-test-result.json',JSON.stringify({rootId:thread.id,deepestId:parent,branches:siblings.map(s=>s.branch.threadId),passedAt:new Date().toISOString(),checks:['real send','three parallel siblings','three levels','fork idempotency']},null,2));
console.log('PASS: real send, three parallel siblings, three levels, fork idempotency');
