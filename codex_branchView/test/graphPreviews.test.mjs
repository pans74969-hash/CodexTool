import {test} from 'node:test';
import assert from 'node:assert/strict';
import {graphPreviews} from '../src/graphPreviews.ts';
import {questionGraph,currentQuestionNode,conversationMainline} from '../src/questionGraph.ts';

const turn=(id,text,items=[])=>({id,items:[{type:'userMessage',content:[{type:'text',text}]},...items]});
const input=()=>({rootId:'root',branches:[],views:{root:{turns:[turn('q1','入口'),turn('q2','续问')]}},tasks:[],drafts:{}});

test('输入续问即时添加预览，清空后移除，真实节点身份和当前路径保持不变',()=>{
 const state=input();state.drafts.root='正在输入的问题';
 const previews=graphPreviews(state),graph=questionGraph(state.rootId,state.branches,state.views,previews);
 assert.equal(previews.length,1);
 const draft=graph.nodes.find(n=>n.preview),last=graph.nodes.find(n=>n.id==='root:q2');
 assert.equal(draft.turnId,undefined);assert.equal(draft.x,last.x);
 assert.ok(graph.edges.some(e=>e.from===last.id&&e.to===draft.id&&e.kind==='continue'));
 assert.equal(currentQuestionNode(graph.nodes,'root').id,'root:q2');
 assert.equal(conversationMainline(graph.nodes,graph.edges,'root').size,1);
 state.drafts.root='  ';assert.equal(graphPreviews(state).length,0);
});

test('选词草稿从准确的较早来源分叉，输入内容改变时保持同一预览节点',()=>{
 const state=input();state.selection={parentId:'root',anchor:{turnId:'q1',quote:'术语'}};
 state.custom=true;state.question='为什么';
 const first=graphPreviews(state);state.question='为什么这样实现？';const second=graphPreviews(state);
 assert.equal(first[0].id,second[0].id);assert.equal(second[0].label,'为什么这样实现？');
 const graph=questionGraph(state.rootId,[],state.views,second);
 assert.ok(graph.edges.some(e=>e.from==='root:q1'&&e.to===second[0].id&&e.kind==='fork'));
 assert.equal(conversationMainline(graph.nodes,graph.edges,'root','q2').size,1);
 state.selection.anchor.turnId='unread';
 assert.equal(questionGraph(state.rootId,[],state.views,graphPreviews(state)).nodes.filter(n=>n.preview).length,0);
});

test('发送中的预览自动被真实轮次替换，兼容两种客户端消息 ID',()=>{
 for(const field of ['clientId','clientUserMessageId']){
  const state=input();state.tasks=[{id:'job',threadId:'root',text:'新问题',status:'running'}];
  assert.equal(graphPreviews(state).length,1);
  state.views.root.turns.push(turn('q3','新问题',[{[field]:'job'}]));
  assert.equal(graphPreviews(state).length,0);
 }
 const state=input();state.tasks=[{id:'job',threadId:'root',text:'新问题',status:'completed',turnId:'q3'}];
 assert.equal(graphPreviews(state).length,1,'完成事件先于历史读取时仍保留节点');
 state.views.root.turns.push(turn('q3','新问题'));assert.equal(graphPreviews(state).length,0);
});

test('空对话的首条草稿复用入口占位，无关对话不添加草稿',()=>{
 const state=input();state.views.root.turns=[];state.drafts={root:'首条问题',other:'不可见草稿'};
 const graph=questionGraph('root',[],state.views,graphPreviews(state));
 assert.equal(graph.nodes.length,1);assert.equal(graph.edges.length,0);assert.equal(graph.nodes[0].label,'首条问题');

});

test('多个排队消息按发送顺序预览，取消和失败消息不冒充问答',()=>{
 const state=input();state.tasks=[
  {id:'second',threadId:'root',text:'第二条',status:'queued',createdAt:2},
  {id:'first',threadId:'root',text:'第一条',status:'sending',createdAt:1},
  {id:'cancelled',threadId:'root',text:'已取消',status:'cancelled'},
  {id:'failed',threadId:'root',text:'失败',status:'failed'},
 ];
 const previews=graphPreviews(state);assert.deepEqual(previews.map(p=>p.label),['第一条','第二条']);
 const graph=questionGraph('root',[],state.views,previews);
 assert.ok(graph.edges.some(e=>e.from==='task:first'&&e.to==='task:second'));
});
