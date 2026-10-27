// Uses only the disposable root created by test/live.mjs; never sends to user discussions.
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
const fixture=JSON.parse(fs.readFileSync('data/live-test-result.json','utf8')),root=fixture.rootId;
const base='http://127.0.0.1:4317';let token;
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-Session-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
token=(await api('bootstrap')).token;
async function wait(id){for(let n=0;n<90;n++){const b=await api('bootstrap'),t=b.tasks.find(t=>t.id===id);if(t?.status==='completed')return t;if(['failed','interrupted','uncertain'].includes(t?.status))throw new Error(t.status+': '+t.error);await new Promise(r=>setTimeout(r,1000));}throw new Error('等待验收超时');}
const original=await api('thread?id='+root);const source=original.turns.find(t=>t.status==='completed'&&t.items.some(i=>i.type==='userMessage'));
const message=source.items.find(i=>i.type==='userMessage'),raw=message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
const later=await api('send',{id:randomUUID(),threadId:root,text:'独立验收后续轮次：请只回复“后续轮次”，不要调用工具。'});const laterDone=await wait(later.id);console.log('Later test turn completed');
const quote='水面遮罩',start=raw.indexOf(quote);if(start<0)throw new Error('缺少测试选词');
const result=await api('branch',{id:randomUUID(),rootId:root,parentId:root,anchor:{turnId:source.id,messageId:message.id,sourceText:raw,answerText:raw,quote,start,end:start+quote.length,prefix:raw.slice(Math.max(0,start-32),start),suffix:raw.slice(start+quote.length,start+quote.length+32)},question:'独立分支验收：请只回复“来源问题分支正常”，不要调用工具。'});
await wait(result.task.id);const child=await api('thread?id='+result.branch.threadId);
if(!child.turns.some(t=>t.id===source.id))throw new Error('没有继承指定来源轮次');
if(child.turns.some(t=>t.id===laterDone.turnId))throw new Error('错误地继承了后续轮次');
const report={rootId:root,sourceTurn:source.id,excludedLaterTurn:laterDone.turnId,childId:result.branch.threadId,quote,passedAt:new Date().toISOString()};fs.writeFileSync('data/source-fork-test-result.json',JSON.stringify(report,null,2));console.log('PASS user-question selection, exact source fork, excludes later turns');
