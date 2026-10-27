import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Engine} from '../server/engine.mjs';
class Memory{data=new Map();get(k,id){return structuredClone(this.data.get(k+id));}put(k,id,v){this.data.set(k+id,structuredClone(v));}all(k){return [...this.data].filter(([key])=>key.startsWith(k)).map(([,v])=>structuredClone(v));}}
class RPC extends EventEmitter{ready=false;starts=[];busy=new Set();history=new Map();async call(method,p){if(method==='thread/read')return {thread:{id:p.threadId,status:{type:this.busy.has(p.threadId)?'active':'idle'}}};if(method==='thread/turns/list')return {data:this.history.get(p.threadId)||[]};if(method==='thread/resume')return {};if(method==='turn/start'){this.starts.push(p);this.busy.add(p.threadId);const turn={id:'turn-'+p.clientUserMessageId,status:'inProgress',items:[{type:'userMessage',clientId:p.clientUserMessageId,content:p.input}]};this.history.set(p.threadId,[turn]);return {turn};}if(method==='turn/interrupt')return {};throw new Error(method);}}
function setup(){const rpc=new RPC(),store=new Memory(),engine=new Engine(rpc,store,()=>{});clearInterval(engine.timer);return {rpc,store,engine};}

test('历史只读取实时 Codex，不写快照，也不在连接失败时返回旧快照',async()=>{
 const {rpc,store,engine}=setup();
 rpc.history.set('a',[{id:'real',items:[],status:'completed'}]);
 assert.equal((await engine.read('a')).turns[0].id,'real');
 assert.equal(store.all('snapshot').length,0);
 store.put('snapshot','a',{id:'a',thread:{id:'a'},turns:[{id:'stale'}]});
 rpc.call=async()=>{throw new Error('连接不可用');};
 await assert.rejects(()=>engine.read('a'),/连接不可用/);
});
test('三个并发上限、同对话串行、只读参数和取消排队',async()=>{
 const {rpc,engine}=setup();for(const [id,threadId]of [['1','a'],['2','a'],['3','b'],['4','c'],['5','d']])engine.enqueue({id,threadId,text:'解释'});rpc.ready=true;await engine.pump();assert.equal(rpc.starts.length,3);assert.deepEqual(rpc.starts.map(p=>p.threadId),['a','b','c']);for(const p of rpc.starts){assert.equal(p.sandboxPolicy.type,'readOnly');assert.equal(p.sandboxPolicy.networkAccess,false);assert.equal(p.approvalPolicy,'never');}await engine.stop('5');assert.equal(engine.tasks().find(t=>t.id==='5').status,'cancelled');await engine.pump();assert.equal(rpc.starts.length,3);
});
test('外部对话忙碌时不发送，完成后再发送',async()=>{
 const {rpc,engine}=setup();rpc.busy.add('a');engine.enqueue({id:'1',threadId:'a',text:'解释'});rpc.ready=true;await engine.pump();assert.equal(rpc.starts.length,0);assert.equal(engine.tasks()[0].status,'queued');rpc.busy.clear();await engine.pump();assert.equal(rpc.starts.length,1);
});
test('重启后的 sending 任务按 clientId 找回，不重新发送',async()=>{
 const {rpc,store,engine}=setup();store.put('task','1',{id:'1',threadId:'a',text:'解释',status:'sending'});rpc.history.set('a',[{id:'old-turn',status:'completed',items:[{type:'userMessage',clientId:'1'}]}]);rpc.ready=true;await engine.pump();assert.equal(rpc.starts.length,0);assert.equal(engine.tasks()[0].status,'completed');
});
test('不确定任务不盲目重试；同一请求 ID 幂等',async()=>{
 const {rpc,store,engine}=setup();store.put('task','1',{id:'1',threadId:'a',text:'解释',status:'uncertain'});rpc.ready=true;await assert.rejects(()=>engine.retry('1'),/无法确认/);engine.enqueue({id:'1',threadId:'a',text:'重复'});assert.equal(engine.tasks().length,1);assert.equal(engine.tasks()[0].text,'解释');
});
test('排队任务在状态查询期间被取消，不会继续发送',async()=>{
 const {rpc,engine}=setup();let release;const original=rpc.call.bind(rpc);let blocked=false;
 rpc.call=async(method,p)=>{if(method==='thread/read'&&!blocked){blocked=true;await new Promise(r=>release=r);}return original(method,p);};
 engine.enqueue({id:'1',threadId:'a',text:'解释'});rpc.ready=true;const pumping=engine.pump();await new Promise(r=>setImmediate(r));await engine.stop('1');release();await pumping;assert.equal(rpc.starts.length,0);assert.equal(engine.tasks()[0].status,'cancelled');
});

test('三个不确定任务只暂停各自对话，不阻塞其他对话，也不重复发送',async()=>{
 const {rpc,store,engine}=setup();
 for(const id of ['a','b','c'])store.put('task',id,{id,threadId:id,text:'旧消息',status:'uncertain'});
 engine.enqueue({id:'same',threadId:'a',text:'同对话后续'});
 for(const id of ['d','e','f','g'])engine.enqueue({id,threadId:id,text:'新消息'});
 rpc.ready=true;await engine.pump();
 assert.deepEqual(rpc.starts.map(p=>p.threadId),['d','e','f']);
 assert.equal(store.get('task','same').status,'queued');
 assert.equal(store.get('task','g').status,'queued');
 assert.equal(store.get('task','a').status,'uncertain');
 await assert.rejects(()=>engine.retry('a'),/无法确认/);
 rpc.history.set('a',[{id:'recovered',status:'completed',items:[{type:'userMessage',clientId:'a'}]}]);
 await engine.pump();assert.equal(store.get('task','a').status,'completed');
 assert.equal(rpc.starts.filter(p=>p.clientUserMessageId==='a').length,0);
});

test('重启后无法核实的 sending 任务转为待核对，其他对话仍可启动',async()=>{
 const {rpc,store,engine}=setup();
 for(const id of ['a','b','c'])store.put('task',id,{id,threadId:id,text:'旧消息',status:'sending'});
 engine.enqueue({id:'new',threadId:'new',text:'新消息'});
 rpc.ready=true;await engine.pump();
 assert.deepEqual(rpc.starts.map(p=>p.threadId),['new']);
 for(const id of ['a','b','c'])assert.equal(store.get('task',id).status,'uncertain');
});
