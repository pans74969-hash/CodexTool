import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionGraph,currentQuestionNode,sourceBranchPath,overviewGraph,conversationMainline} from '../src/questionGraph.ts';
const turn=(id,text,at=10)=>({id,startedAt:at,items:[{type:'userMessage',content:[{type:'text',text}]}]});

test('连续十二层追问仍逐层改变方向，每层普通续问与追问段共线',()=>{
 const branches=[],views={root:{turns:[turn('q0','入口')]}};
 for(let depth=1;depth<=12;depth++){
  const id='child'+depth,parentId=depth===1?'root':'child'+(depth-1);
  branches.push({threadId:id,parentId,rootId:'root',title:id,createdAt:depth*20000,anchor:{turnId:'q'+(depth-1),quote:id}});
  views[id]={turns:[turn('q'+depth,id,depth*20),turn('next'+depth,'普通续问',depth*20+1)]};
 }
 const graph=questionGraph('root',branches,views),get=id=>graph.nodes.find(n=>n.id===id);
 const slope=(a,b)=>(b.x-a.x)/(b.y-a.y);let previousSlope=0;
 for(let depth=1;depth<=12;depth++){
  const source=get((depth===1?'root':'child'+(depth-1))+':q'+(depth-1)),first=get('child'+depth+':q'+depth),next=get('child'+depth+':next'+depth);
  const forkSlope=slope(source,first);
  assert.ok(forkSlope-previousSlope>.1,'第 '+depth+' 层必须转向');
  assert.ok(Math.abs(forkSlope-slope(first,next))<1e-10,'第 '+depth+' 层续问必须共线');
  previousSlope=forkSlope;
 }
 assert.ok(graph.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
 assert.equal(new Set(graph.nodes.map(n=>n.x+','+n.y)).size,graph.nodes.length);
});
test('同一个问题点可分出多个追问，普通续聊也是独立的问题点',()=>{
 const branches=['a','b','c'].map(id=>({threadId:id,parentId:'root',rootId:'root',title:'追问 '+id,createdAt:20000,anchor:{turnId:'q1',quote:'词 '+id}}));
 const views={root:{turns:[turn('q1','入口的问题'),turn('q2','普通续聊')]},a:{turns:[turn('q1','继承的入口'),turn('a1','追问 a',20)]},b:{turns:[turn('b1','追问 b',20)]},c:{turns:[]}};
 const g=questionGraph('root',branches,views);
 assert.equal(g.nodes.filter(n=>n.threadId==='root').length,2);
 assert.equal(g.edges.filter(e=>e.from==='root:q1'&&e.quote).length,3);
 assert.ok(g.edges.some(e=>e.from==='root:q1'&&e.to==='root:q2'&&e.kind==='continue'));
 assert.ok(g.edges.filter(e=>e.from==='root:q1'&&e.kind==='fork').length===3);
 assert.equal(g.nodes.filter(n=>n.threadId==='a').length,1);
 assert.ok(g.nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
});
test('不同轮次的追问连到各自问题，而不是笼统连到同一个对话',()=>{
 const branches=[{threadId:'a',parentId:'root',rootId:'root',title:'追问',createdAt:20000,anchor:{turnId:'q2',quote:'术语'}}];
 const g=questionGraph('root',branches,{root:{turns:[turn('q1','问题一'),turn('q2','问题二')]}});
 assert.ok(g.edges.some(e=>e.from==='root:q2'&&e.to==='a:pending'));
 assert.ok(!g.edges.some(e=>e.from==='root:q1'&&e.to==='a:pending'));
});
test('当前节点定位跟随具体问题，不选择同对话中其他有分支的问题',()=>{
 const g=questionGraph('root',[],{root:{turns:[turn('old','旧问题'),turn('new','新问题')]}});
 assert.equal(currentQuestionNode(g.nodes,'root','new').id,'root:new');
 assert.equal(currentQuestionNode(g.nodes,'root','old').id,'root:old');
 assert.equal(currentQuestionNode(g.nodes,'root','not-loaded'),undefined);
 assert.equal(conversationMainline(g.nodes,g.edges,'root','not-loaded').size,0);
});
test('无法读取来源轮次时保留提示点，但不伪造追问连接',()=>{
 const branches=[{threadId:'child',parentId:'root',rootId:'root',title:'追问',createdAt:20000,anchor:{turnId:'older',quote:'词'}}];
 const g=questionGraph('root',branches,{root:{turns:[turn('new','最近问题')]},child:{turns:[turn('c1','追问',20)]}});
 assert.equal(g.nodes.find(n=>n.id==='root:older')?.kind,'missing');
 assert.ok(!g.edges.some(e=>e.to==='child:c1'&&e.kind==='fork'));
 assert.equal(conversationMainline(g.nodes,g.edges,'child','c1').size,0);
});
test('入口主干固定在中轴，同一来源的追问向左右分布且不重叠',()=>{
 const branches=['a','b'].map(id=>({threadId:id,parentId:'root',rootId:'root',title:id,createdAt:20000,anchor:{turnId:'q',quote:id}}));
 const g=questionGraph('root',branches,{root:{turns:[turn('q','来源'),turn('q2','入口续问')]}});const source=g.nodes.find(n=>n.id==='root:q'),next=g.nodes.find(n=>n.id==='root:q2'),a=g.nodes.find(n=>n.threadId==='a'),b=g.nodes.find(n=>n.threadId==='b');
 assert.equal(source.x,next.x);assert.ok(next.y>source.y);
 assert.ok(a.x>source.x&&b.x<source.x);assert.equal(a.y,b.y);
 assert.ok(a.y>source.y&&b.y>source.y&&next.y>Math.max(a.y,b.y));
});
test('追问中的普通续聊沿斜向主干，三级追问继续向外且切换当前点不重排',()=>{
 const branches=[
  {threadId:'a',parentId:'root',rootId:'root',title:'一级',createdAt:20000,anchor:{turnId:'q1',quote:'甲'}},
  {threadId:'b',parentId:'a',rootId:'root',title:'二级',createdAt:30000,anchor:{turnId:'a1',quote:'乙'}},
  {threadId:'c',parentId:'b',rootId:'root',title:'三级',createdAt:40000,anchor:{turnId:'b1',quote:'丙'}}
 ];
 const views={root:{turns:[turn('q1','入口'),turn('q2','入口续问')]},a:{turns:[turn('a1','一级',20),turn('a2','一级续问',21)]},b:{turns:[turn('b1','二级',30)]},c:{turns:[turn('c1','三级',40)]}};
 const {nodes,edges}=questionGraph('root',branches,views),get=id=>nodes.find(n=>n.id===id);
 assert.equal(get('root:q1').x,get('root:q2').x);
 assert.ok(get('a:a2').x>get('a:a1').x);
 assert.ok(get('root:q1').x<get('a:a1').x&&get('a:a1').x<get('b:b1').x&&get('b:b1').x<get('c:c1').x);
 assert.equal(new Set(nodes.map(n=>n.x+','+n.y)).size,nodes.length);
 assert.equal(edges.filter(e=>e.kind==='fork').length,3);
 assert.equal(edges.filter(e=>e.kind==='continue').length,2);
 const before=nodes.map(n=>[n.id,n.x,n.y]);
 conversationMainline(nodes,edges,'c','c1');conversationMainline(nodes,edges,'root','q1');
 assert.deepEqual(nodes.map(n=>[n.id,n.x,n.y]),before);
});
test('左右旁支的再追问继续向外生长',()=>{
 const branches=[
  {threadId:'right',parentId:'root',rootId:'root',title:'右',createdAt:20000,anchor:{turnId:'q',quote:'甲'}},
  {threadId:'left',parentId:'root',rootId:'root',title:'左',createdAt:21000,anchor:{turnId:'q',quote:'乙'}},
  {threadId:'left-child',parentId:'left',rootId:'root',title:'左侧再追问',createdAt:30000,anchor:{turnId:'l1',quote:'丙'}}
 ];
 const views={root:{turns:[turn('q','入口')]},right:{turns:[turn('r1','右',20)]},left:{turns:[turn('l1','左',21)]},'left-child':{turns:[turn('lc1','左侧再追问',30)]}};
 const g=questionGraph('root',branches,views),get=id=>g.nodes.find(n=>n.id===id);
 assert.ok(get('left-child:lc1').x<get('left:l1').x&&get('left:l1').x<get('root:q').x&&get('root:q').x<get('right:r1').x);
 assert.equal(get('left:l1').y,get('right:r1').y);
 assert.ok(get('left-child:lc1').y>get('left:l1').y);
});
test('同一来源的同侧追问扇形展开，不形成平行线',()=>{
 const branches=['a','b','c'].map((id,index)=>({threadId:id,parentId:'root',rootId:'root',title:id,createdAt:20000+index*1000,anchor:{turnId:'q',quote:id}}));
 const views={root:{turns:[turn('q','入口')]},a:{turns:[turn('a1','甲',20),turn('a2','甲续问',21)]},b:{turns:[turn('b1','乙',21),turn('b2','乙续问',22)]},c:{turns:[turn('c1','丙',22),turn('c2','丙续问',23)]}};
 const g=questionGraph('root',branches,views),get=id=>g.nodes.find(n=>n.id===id),slope=(a,b)=>(get(b).x-get(a).x)/(get(b).y-get(a).y);
 assert.ok(slope('a:a1','a:a2')>0);
 assert.ok(slope('b:b1','b:b2')<0);
 assert.ok(slope('c:c1','c:c2')>slope('a:a1','a:a2'));
});
test('追问与其后续问题严格共线，再追问改变方向',()=>{
 const branches=[{threadId:'a',parentId:'root',rootId:'root',title:'一级',createdAt:20000,anchor:{turnId:'q',quote:'甲'}},{threadId:'b',parentId:'a',rootId:'root',title:'二级',createdAt:30000,anchor:{turnId:'a2',quote:'乙'}}];
 const g=questionGraph('root',branches,{root:{turns:[turn('q','入口')]},a:{turns:[turn('a1','一级',20),turn('a2','续问',21)]},b:{turns:[turn('b1','二级',30),turn('b2','续问',31)]}}),get=id=>g.nodes.find(n=>n.id===id),slope=(a,b)=>(get(b).x-get(a).x)/(get(b).y-get(a).y);
 assert.ok(Math.abs(slope('root:q','a:a1')-slope('a:a1','a:a2'))<1e-12);
 assert.ok(Math.abs(slope('a:a2','b:b1')-slope('b:b1','b:b2'))<1e-12);
 assert.ok(Math.abs(slope('root:q','a:a1')-slope('a:a2','b:b1'))>.01);
});
test('追问对话本身也能从问题点向主干线两侧岔出',()=>{
 const branches=[
  {threadId:'a',parentId:'root',rootId:'root',title:'一级',createdAt:20000,anchor:{turnId:'q',quote:'甲'}},
  {threadId:'b',parentId:'a',rootId:'root',title:'右侧',createdAt:30000,anchor:{turnId:'a1',quote:'乙'}},
  {threadId:'c',parentId:'a',rootId:'root',title:'左侧',createdAt:31000,anchor:{turnId:'a1',quote:'丙'}}
 ];
 const g=questionGraph('root',branches,{root:{turns:[turn('q','入口')]},a:{turns:[turn('a1','一级',20),turn('a2','续问',21)]},b:{turns:[turn('b1','右',30)]},c:{turns:[turn('c1','左',31)]}}),get=id=>g.nodes.find(n=>n.id===id),slope=(a,b)=>(get(b).x-get(a).x)/(get(b).y-get(a).y);
 const parentSlope=slope('a:a1','a:a2');
 assert.ok(slope('a:a1','b:b1')>parentSlope);
 assert.ok(slope('a:a1','c:c1')<parentSlope);
 assert.ok(get('b:b1').x>get('a:a1').x&&get('c:c1').x<get('a:a1').x);
});
test('同时查看父子问答时，追问路径根据选中文字的来源，而不是当前打开的子对话',()=>{
 const branches=[{threadId:'child',parentId:'root',rootId:'root',title:'子问题',createdAt:20000,anchor:{turnId:'q',quote:'术语'}}];
 assert.deepEqual(sourceBranchPath('root','root',branches),[]);
 assert.deepEqual(sourceBranchPath('root','child',branches),['术语']);
});
test('简图压缩坐标但保留相同问题和分支连线，点击目标不变',()=>{
 const g=questionGraph('root',[],{root:{turns:[turn('q1','问题一'),turn('q2','问题二')]}});const small=overviewGraph(g);
 assert.deepEqual(small.nodes.map(n=>[n.id,n.threadId,n.turnId]),g.nodes.map(n=>[n.id,n.threadId,n.turnId]));
 assert.deepEqual(small.edges,g.edges);assert.ok(small.height<g.height);assert.ok(small.nodes[1].y>small.nodes[0].y);
});
test('实线跟随选中对话，进入追问后原对话的后续和其他追问变为虚线',()=>{
 const branches=[
  {threadId:'a',parentId:'root',rootId:'root',title:'追问 a',createdAt:20000,anchor:{turnId:'q1',quote:'词 a'}},
  {threadId:'b',parentId:'root',rootId:'root',title:'追问 b',createdAt:20000,anchor:{turnId:'q1',quote:'词 b'}},
  {threadId:'c',parentId:'a',rootId:'root',title:'追问 c',createdAt:30000,anchor:{turnId:'a1',quote:'词 c'}}
 ];
 const views={root:{turns:[turn('q1','入口'),turn('q2','续问')]},a:{turns:[turn('a1','追问 a',20),turn('a2','a 续问',21)]},b:{turns:[turn('b1','追问 b',20)]},c:{turns:[turn('c1','追问 c',30)]}};
 const {nodes,edges}=questionGraph('root',branches,views);
 const key=(a,b)=>a+'\0'+b;
 const root=conversationMainline(nodes,edges,'root');
 assert.ok(root.has(key('root:q1','root:q2')));
 assert.ok(!root.has(key('root:q1','a:a1')));
 const a=conversationMainline(nodes,edges,'a');
 assert.ok(a.has(key('root:q1','a:a1')));
 assert.ok(a.has(key('a:a1','a:a2')));
 assert.ok(!a.has(key('root:q1','root:q2')));
 assert.ok(!a.has(key('a:a1','c:c1')));
 const c=conversationMainline(nodes,edges,'c');
 assert.ok(c.has(key('root:q1','a:a1')));
 assert.ok(c.has(key('a:a1','c:c1')));
 assert.ok(!c.has(key('a:a1','a:a2')));
 assert.ok(!c.has(key('root:q1','b:b1')));
});
test('从下游问题点返回上游，只有通往当前点的路径是实线',()=>{
 const branches=[{threadId:'child',parentId:'root',rootId:'root',title:'追问',createdAt:20000,anchor:{turnId:'q1',quote:'词'}}];
 const {nodes,edges}=questionGraph('root',branches,{root:{turns:[turn('q1','上游'),turn('q2','下游')]},child:{turns:[turn('c1','追问',20),turn('c2','继续',21)]}});
 const key=(from,to)=>from+'\0'+to;
 const downstream=conversationMainline(nodes,edges,'child','c2');
 assert.ok(downstream.has(key('root:q1','child:c1')));
 assert.ok(downstream.has(key('child:c1','child:c2')));
 const upstream=conversationMainline(nodes,edges,'root','q1');
 assert.equal(upstream.size,0);
 assert.ok(!upstream.has(key('root:q1','root:q2')));
 assert.ok(!upstream.has(key('root:q1','child:c1')));
 const firstChild=conversationMainline(nodes,edges,'child','c1');
 assert.ok(firstChild.has(key('root:q1','child:c1')));
 assert.ok(!firstChild.has(key('child:c1','child:c2')));
});
test('三级追问的续问仍在各自轨道，当前路径贯穿入口早期轮次',()=>{
 const branches=[
  {threadId:'a',parentId:'root',rootId:'root',title:'一级',createdAt:20000,anchor:{turnId:'r2',quote:'甲'}},
  {threadId:'b',parentId:'a',rootId:'root',title:'二级',createdAt:30000,anchor:{turnId:'a2',quote:'乙'}},
  {threadId:'c',parentId:'b',rootId:'root',title:'三级',createdAt:40000,anchor:{turnId:'b2',quote:'丙'}}
 ];
 const views={root:{turns:[turn('r1','入口一'),turn('r2','入口二',11),turn('r3','入口三',12)]},a:{turns:[turn('a1','一级',20),turn('a2','一级续问',21)]},b:{turns:[turn('b1','二级',30),turn('b2','二级续问',31)]},c:{turns:[turn('c1','三级',40),turn('c2','三级续问',41)]}};
 const g=questionGraph('root',branches,views),small=overviewGraph(g),key=(a,b)=>a+'\0'+b;
 for(const graph of [g,small]){
  for(const e of graph.edges){const from=graph.nodes.find(n=>n.id===e.from),to=graph.nodes.find(n=>n.id===e.to);assert.ok(to.y>from.y);if(e.kind==='continue')assert.equal(Math.sign(to.x-from.x),from.threadId==='root'?0:1);else assert.ok(to.x>from.x);}
  const active=conversationMainline(graph.nodes,graph.edges,'c','c2');
  for(const pair of [['root:r1','root:r2'],['root:r2','a:a1'],['a:a1','a:a2'],['a:a2','b:b1'],['b:b1','b:b2'],['b:b2','c:c1'],['c:c1','c:c2']])assert.ok(active.has(key(...pair)),pair.join(' -> '));
  assert.ok(!active.has(key('root:r2','root:r3')));
  const upstream=conversationMainline(graph.nodes,graph.edges,'a','a1');
  assert.deepEqual([...upstream].sort(),[key('root:r1','root:r2'),key('root:r2','a:a1')].sort());
 }
});
