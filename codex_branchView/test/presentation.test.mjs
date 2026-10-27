import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanQuestion,finalAnswer} from '../src/presentation.ts';
import {parseDesktop,projectFor} from '../server/desktop.mjs';
test('正文不显示环境包装、分支提示词，只留下用户问题',()=>{
 const text='<in-app-browser-context source="ambient">secret UI</in-app-browser-context>\n## My request:\n水怎么画？';
 assert.equal(cleanQuestion(text),'水怎么画？');
 assert.equal(cleanQuestion('关于「Alpha」的追问。\n来源回答：\n原回答\n\n我的问题：为什么透明？\n\n请从基础解释，结合原句给具体例子；'),'为什么透明？');
 assert.equal(cleanQuestion('关于「离屏图」的追问。\n入口问题：\n## My request:\n旧问题\n\n来源回答：\n旧回答\n\n我的问题：离屏图是什么？\n\n请从基础解释，给例子。'),'离屏图是什么？');
 assert.equal(finalAnswer({type:'agentMessage',phase:'commentary'}),false);
 assert.equal(finalAnswer({type:'agentMessage',phase:'final_answer'}),true);
 assert.equal(finalAnswer({type:'agentMessage'}),true);
});
test('桌面项目顺序、显式归属和新旧项目 ID 对应，不按工作目录猜归属',()=>{
 const sidebar=parseDesktop({'local-projects':{a:{name:'REA',rootPaths:['E:/GPT/rea']},b:{name:'其他',rootPaths:['E:/other']}},'project-order':['b','a'],'thread-project-assignments':{t1:{projectId:'a'}},'projectless-thread-ids':['t2'],'app-server-project-id-by-legacy-project-id-by-host':{local:{a:'new-a'}}});
 assert.deepEqual(sidebar.projects.map(p=>p.name),['其他','REA']);assert.equal(projectFor({id:'t1',projectId:null},sidebar),'a');assert.equal(projectFor({id:'t2',projectId:'new-a'},sidebar),null);assert.equal(projectFor({id:'t3',projectId:'new-a'},sidebar),'a');assert.equal(projectFor({id:'t4',cwd:'E:/GPT/rea'},sidebar),null);
 assert.equal('electron-persisted-atom-state' in sidebar,false);
});
