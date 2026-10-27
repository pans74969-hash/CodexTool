import {cleanQuestion} from './presentation.ts';
type Branch={threadId:string;parentId:string;rootId:string;title:string;createdAt:number;anchor:{turnId:string;quote:string}};
type Turn={id:string;startedAt?:number;items:{type:string;content?:{type:string;text?:string}[]}[]};
export type QuestionNode={id:string;threadId:string;turnId?:string;label:string;kind:'question'|'pending'|'missing';preview?:'draft'|'pending';x:number;y:number};
export type QuestionPreview={id:string;threadId:string;label:string;state:'draft'|'pending';parentId?:string;sourceTurnId?:string};
export type QuestionEdge={from:string;to:string;kind:'continue'|'fork';quote?:string};
export function overviewGraph(graph:{nodes:QuestionNode[];edges:QuestionEdge[];width?:number}){const nodes=graph.nodes.map(n=>({...n,x:25+(n.x-100)/210*48,y:25+(n.y-30)/155*19}));return {nodes,edges:graph.edges,width:Math.max(100,...nodes.map(n=>n.x+40),graph.width?25+(graph.width-100)/210*48:0),height:Math.max(160,...nodes.map(n=>n.y+35))};}
export function sourceBranchPath(rootId:string,parentId:string,branches:Branch[]){const path:string[]=[],seen=new Set<string>();let id=parentId;while(id!==rootId&&!seen.has(id)){seen.add(id);const b=branches.find(b=>b.threadId===id&&b.rootId===rootId);if(!b)break;path.unshift(b.anchor.quote);id=b.parentId;}return path;}
export function currentQuestionNode(nodes:QuestionNode[],threadId:string,turnId?:string){return turnId?nodes.find(n=>n.threadId===threadId&&n.turnId===turnId):nodes.filter(n=>n.threadId===threadId&&n.kind!=='missing'&&!n.preview).at(-1);}
export function conversationMainline(nodes:QuestionNode[],edges:QuestionEdge[],threadId:string,turnId?:string){
 const mainline=new Set<string>();
 let node=currentQuestionNode(nodes,threadId,turnId);
 const visited=new Set<string>();
 while(node&&!visited.has(node.id)){
  visited.add(node.id);
  const edge=edges.find(e=>e.to===node!.id);
  if(!edge)break;
  mainline.add(edge.from+'\0'+edge.to);
  node=nodes.find(n=>n.id===edge.from);
 }
 return mainline;
}
export function questionGraph(rootId:string,branches:Branch[],views:Record<string,{turns:Turn[]}>,previews:QuestionPreview[]=[]){
 const relevant=branches.filter(b=>b.rootId===rootId),ids=[rootId,...new Set(relevant.map(b=>b.threadId))];
 const nodes:QuestionNode[]=[],edges:QuestionEdge[]=[];const first=new Map<string,string>();
 for(const id of ids){const branch=relevant.find(b=>b.threadId===id);let turns=views[id]?.turns||[];
  if(branch){const at=turns.findIndex(t=>t.id===branch.anchor.turnId);turns=at>=0?turns.slice(at+1):turns.filter(t=>(t.startedAt||0)*1000>=branch.createdAt-2000);}
  let previous='';for(const t of turns){const text=t.items.filter(i=>i.type==='userMessage').flatMap(i=>(i.content||[]).filter(c=>c.type==='text').map(c=>c.text||'')).join('\n');if(!text.trim())continue;
   const label=(branch&&!first.has(id)?branch.title:cleanQuestion(text)).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[#*`]/g,'');
   const key=id+':'+t.id;nodes.push({id:key,threadId:id,turnId:t.id,label,kind:'question',x:0,y:0});if(!first.has(id))first.set(id,key);if(previous)edges.push({from:previous,to:key,kind:'continue'});previous=key;}
  if(!first.has(id)){const key=id+':pending';nodes.push({id:key,threadId:id,label:branch?.title||'入口问题',kind:'pending',x:0,y:0});first.set(id,key);}
 }
 for(const b of relevant){const from=b.parentId+':'+b.anchor.turnId;if(!nodes.some(n=>n.id===from)){nodes.push({id:from,threadId:b.parentId,turnId:b.anchor.turnId,label:'来源问题未能读取',kind:'missing',x:0,y:0});continue;}const to=first.get(b.threadId);if(to)edges.push({from,to,kind:'fork',quote:b.anchor.quote});}
 // Drafts are ephemeral display nodes. They never invent a Codex turn ID and
 // cannot become a navigation target or the current answer's solid path.
 for(const preview of previews){
  if(preview.parentId){
   const source=nodes.find(n=>n.threadId===preview.parentId&&n.turnId===preview.sourceTurnId&&n.kind==='question');
   if(!source)continue;
   nodes.push({id:preview.id,threadId:preview.threadId,label:preview.label,kind:'pending',preview:preview.state,x:0,y:0});
   edges.push({from:source.id,to:preview.id,kind:'fork'});
  }else{
   const source=nodes.filter(n=>n.threadId===preview.threadId&&n.kind!=='missing').at(-1);
   if(!source)continue;
   if(source.kind==='pending'&&!source.preview){source.label=preview.label;source.preview=preview.state;continue;}
   nodes.push({id:preview.id,threadId:preview.threadId,label:preview.label,kind:'pending',preview:preview.state,x:0,y:0});
   edges.push({from:source.id,to:preview.id,kind:'continue'});
  }
 }
 // A fork sets a new straight direction. Every ordinary continuation stays
 // on that same ray until another fork creates a new direction.
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const children=new Map(nodes.map(n=>[n.id,[] as QuestionEdge[]]));for(const e of edges)children.get(e.from)?.push(e);
 const incoming=new Set(edges.map(e=>e.to)),visited=new Set<string>();let row=0;
 const rootBranches=relevant.filter(b=>b.parentId===rootId).sort((a,b)=>a.createdAt-b.createdAt||a.threadId.localeCompare(b.threadId));
 const rootDirections=new Map(rootBranches.map((b,index)=>[b.threadId,index%2===0?1:-1]));
 const branchDirections=new Map<string,number>();
 for(const parent of new Set(relevant.map(b=>b.parentId))){const siblings=relevant.filter(b=>b.parentId===parent).sort((a,b)=>a.createdAt-b.createdAt||a.threadId.localeCompare(b.threadId));siblings.forEach((b,index)=>branchDirections.set(b.threadId,index%2===0?1:-1));}
 function place(id:string,atRow:number,x:number,slope:number,depth:number):number{if(visited.has(id))return atRow;const n=byId.get(id);if(!n)return atRow;visited.add(id);n.x=x;n.y=atRow;
  const outgoing=children.get(id)||[];
  const forks=outgoing.filter(e=>e.kind==='fork');let left=atRow+1,right=atRow+1;
  const side=(e:QuestionEdge)=>{const thread=byId.get(e.to)?.threadId||rootId;return n.threadId===rootId?(rootDirections.get(thread)||1):(branchDirections.get(thread)||1)*(Math.sign(slope)||1);};
  // Add a finite slope change instead of clamping angles: a deep fork must
  // still turn, while all continuations retain the parent's exact slope.
  const grow=(e:QuestionEdge,row:number,sibling:number)=>{const direction=side(e),turn=.36+(depth? .10:0)+Math.min(.12,sibling*.045),nextSlope=slope+direction*Math.tan(turn);return place(e.to,row,x+nextSlope*(row-atRow),nextSlope,depth+1);};
  forks.filter(e=>side(e)<0).forEach((e,index)=>{left=grow(e,left,index);});
  forks.filter(e=>side(e)>0).forEach((e,index)=>{right=grow(e,right,index);});
  const next=Math.max(atRow+1,left,right),continuation=outgoing.find(e=>e.kind==='continue');
  return continuation?place(continuation.to,next,x+slope*(next-atRow),slope,depth):next;
 }
 for(const n of nodes.filter(n=>!incoming.has(n.id)))row=place(n.id,row,0,0,0);
 for(const n of nodes)if(!visited.has(n.id))row=place(n.id,row,0,0,0);
 const minX=Math.min(0,...nodes.map(n=>n.x)),maxX=Math.max(0,...nodes.map(n=>n.x));
 for(const n of nodes){n.x=100+(n.x-minX)*210;n.y=30+n.y*155;}
 return {nodes,edges,width:Math.max(300,325+(maxX-minX)*210),height:Math.max(360,...nodes.map(n=>n.y+140))};
}
