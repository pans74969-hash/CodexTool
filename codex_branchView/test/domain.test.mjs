import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {validateAnchor,resolveAnchor,branchPrompt,isBusy} from '../server/domain.mjs';
const answer='Alpha 通道控制透明度。另一个 Alpha 通道。';
const anchor={turnId:'t1',messageId:'a1',sourceText:answer,answerText:answer,quote:'Alpha',start:0,end:5,prefix:'',suffix:' 通道控制透明度。另一个 Alpha 通道。'};

test('只允许已完成回答，且来源回答必须一致',()=>{
 const turn={id:'t1',status:'completed',items:[{id:'a1',type:'agentMessage',text:answer}]};
 assert.equal(validateAnchor(anchor,turn).id,'a1');
 assert.throws(()=>validateAnchor(anchor,{...turn,status:'inProgress'}));
 assert.throws(()=>validateAnchor({...anchor,answerText:'changed'},turn));
 assert.throws(()=>validateAnchor({...anchor,start:1},turn));
});
test('重复词使用准确偏移，不匹配时不乱标',()=>{
 assert.deepEqual(resolveAnchor(anchor,answer),[0,5]);
 assert.equal(resolveAnchor({...anchor,sourceText:'old',prefix:'?',suffix:'?'},answer),null);
 const a={...anchor,sourceText:'old',prefix:'另一个 ',suffix:' 通道。'};
 const start=answer.lastIndexOf('Alpha');assert.deepEqual(resolveAnchor(a,answer),[start,start+5]);
});
test('用户问题原文也能作为选词分支来源，来源消息必须属于指定轮次',()=>{
 const turn={id:'t1',status:'completed',items:[{id:'u1',type:'userMessage',content:[{type:'text',text:answer}]}]};
 assert.equal(validateAnchor({...anchor,messageId:'u1'},turn).id,'u1');
 assert.throws(()=>validateAnchor({...anchor,messageId:'other'},turn));
});
test('追问明确包含入口、来源回答、选词、路径和问题',()=>{
 const p=branchPrompt({anchor,question:'为什么透明？',rootQuestion:'水如何绘制？',path:['水','通道']});
 for(const s of [answer,'为什么透明？','水如何绘制？','水 → 通道','「Alpha」'])assert.ok(p.includes(s));
});
test('持久历史正在执行时视为忙碌，即使独立 RPC 显示未加载',()=>{
 assert.equal(isBusy({status:{type:'notLoaded'}},[{status:'inProgress'}]),true);
 assert.equal(isBusy({status:{type:'active'}},[]),true);
 assert.equal(isBusy({status:{type:'idle'}},[{status:'completed'}]),false);
});
test('SQLite 重启后保留分支和阅读位置，自动清理旧版快照',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'branches-test-'));let store=new Store(dir);
 try{
  store.put('branch','b1',{id:'b1',threadId:'c1',parentId:'p1',rootId:'p1',anchor});
  store.put('position','p1',{id:'p1',top:215});
  store.put('snapshot','p1',{id:'p1',turns:[]});
  store.close();store=new Store(dir);
  assert.equal(store.get('branch','b1').threadId,'c1');
  assert.equal(store.get('position','p1').top,215);
  assert.deepEqual(store.all('snapshot'),[]);
 }finally{store.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
