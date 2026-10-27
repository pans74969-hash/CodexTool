import {cleanQuestion} from './presentation.ts';
import type {QuestionPreview} from './questionGraph.ts';

type Task={id:string;threadId:string;text:string;status:string;turnId?:string;createdAt?:number};
type View={turns:{id:string;items:{clientId?:string;clientUserMessageId?:string}[]}[]};
type Input={
 rootId:string;
 branches:{rootId:string;threadId:string;taskId:string;title:string}[];
 views:Record<string,View>;
 tasks:Task[];
 drafts:Record<string,string>;
 selection?:{parentId:string;anchor:{turnId:string;quote:string}}|null;
 question?:string;
 custom?:boolean;
 submitting?:boolean;
};

export function graphPreviews({rootId,branches,views,tasks,drafts,selection,question='',custom=false,submitting=false}:Input):QuestionPreview[]{
 const relevant=branches.filter(b=>b.rootId===rootId);
 const ids=new Set([rootId,...relevant.map(b=>b.threadId)]);
 const previews:QuestionPreview[]=[];
 for(const task of [...tasks].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))){
  if(!ids.has(task.threadId)||!['queued','sending','running','completed','uncertain'].includes(task.status))continue;
  const turns=views[task.threadId]?.turns||[];
  if(turns.some(t=>t.id===task.turnId||t.items.some(i=>i.clientId===task.id||i.clientUserMessageId===task.id)))continue;
  const title=relevant.find(b=>b.taskId===task.id)?.title||cleanQuestion(task.text);
  previews.push({id:'task:'+task.id,threadId:task.threadId,label:title,state:'pending'});
 }
 for(const [threadId,text] of Object.entries(drafts)){
  if(ids.has(threadId)&&text.trim())previews.push({id:'draft:'+threadId,threadId,label:text.trim(),state:'draft'});
 }
 if(selection&&ids.has(selection.parentId)){
  previews.push({id:'draft:fork',threadId:'draft:fork',parentId:selection.parentId,sourceTurnId:selection.anchor.turnId,label:custom?(question.trim()||'输入具体问题…'):'解释「'+selection.anchor.quote+'」',state:submitting?'pending':'draft'});
 }
 return previews;
}
