import {useMemo,useState,useRef,useEffect} from 'react';
import {questionGraph,currentQuestionNode,overviewGraph,conversationMainline} from './questionGraph';
import type {QuestionPreview} from './questionGraph';
import './question-map.css';
type Props={rootId:string;branches:any[];views:any;previews?:QuestionPreview[];current:string;currentTurnId?:string;inline?:boolean;onClose:()=>void;onExpand?:()=>void;onOpen:(threadId:string,turnId?:string)=>void};
export default function QuestionMap({rootId,branches,views,previews,current,currentTurnId,inline=false,onClose,onExpand,onOpen}:Props){
 const detailed=useMemo(()=>questionGraph(rootId,branches,views,previews),[rootId,branches,views,previews]);
 const [compact,setCompact]=useState(()=>localStorage.getItem('question-map-view')!=='detail'),[zoom,setZoom]=useState(1),[hover,setHover]=useState(''),[pan,setPan]=useState({x:0,y:0}),[panning,setPanning]=useState(false);
 const canvas=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:300,height:400});
 const drag=useRef<{pointerId:number;x:number;y:number;panX:number;panY:number}|null>(null);
 const graph=useMemo(()=>compact?overviewGraph(detailed):detailed,[detailed,compact]);
 const activeNode=currentQuestionNode(graph.nodes,current,currentTurnId);
 const mainline=conversationMainline(graph.nodes,graph.edges,current,currentTurnId);
 const fit=compact?Math.min((size.width-32)/graph.width,(size.height-32)/graph.height,1.6):1;
 const scale=Math.max(.1,fit)*zoom;
 const route=new Set<string>();let ancestor=activeNode?.id;while(ancestor&&!route.has(ancestor)){route.add(ancestor);ancestor=graph.edges.find(e=>e.to===ancestor)?.from;}
 useEffect(()=>{const el=canvas.current;if(!el)return;const observer=new ResizeObserver(()=>setSize({width:el.clientWidth,height:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();},[]);
 const focus=()=>{const node=activeNode;if(node&&canvas.current){setPan({x:0,y:0});canvas.current.scrollTo({left:Math.max(0,(node.x+12)*scale-canvas.current.clientWidth/2),top:Math.max(0,node.y*scale-75),behavior:'instant'});}};
 const entry=()=>{setPan({x:0,y:0});if(compact){setZoom(1);canvas.current?.scrollTo({left:0,top:0,behavior:'instant'});return;}const first=graph.nodes.find(n=>n.threadId===rootId);canvas.current?.scrollTo({left:Math.max(0,(first?.x||0)*scale-(canvas.current?.clientWidth||0)/2),top:0,behavior:'instant'});};
 const switchView=(simple:boolean)=>{setCompact(simple);setZoom(simple?1:.9);setPan({x:0,y:0});localStorage.setItem('question-map-view',simple?'simple':'detail');};
 const stopPan=(pointerId:number)=>{if(drag.current?.pointerId!==pointerId)return;drag.current=null;setPanning(false);if(canvas.current?.hasPointerCapture(pointerId))canvas.current.releasePointerCapture(pointerId);};
 useEffect(()=>{const t=setTimeout(()=>{if(!compact||zoom>1)focus();},80);return()=>clearTimeout(t);},[activeNode?.id,activeNode?.x,activeNode?.y,scale,compact]);
 return <div className={inline?'inline-map':'map-backdrop'} onClick={inline?undefined:onClose}>
  <section className={'question-map vertical-map '+(compact?'compact-map':'')} onClick={e=>e.stopPropagation()} role={inline?'region':'dialog'} aria-label={inline?'左侧问题分支图':'问题分支图'}>
   <header><div><h2>{inline?'问题分支':'问题分支图'}</h2>{!inline&&<p>入口对话竖直向下；追问向两侧岔出一条直线，续问沿这条线继续。</p>}</div>{inline?<button onClick={onExpand} aria-label="放大查看分支图">⛶</button>:<button onClick={onClose} aria-label="关闭分支图">×</button>}</header>
   <div className="map-view-tabs"><button aria-pressed={compact} onClick={()=>switchView(true)}>简图</button><button aria-pressed={!compact} onClick={()=>switchView(false)}>详图</button>{compact&&<span className="compact-key"><i/> 当前问题</span>}</div>
   <div className="map-meaning">改变方向＝新追问 · 沿原方向＝本对话续问 · 实线＝当前路径</div>
   {graph.nodes.some(n=>n.preview)&&<div className="map-live-status" role="status">{graph.nodes.some(n=>n.preview==='draft')?'正在输入 · 虚线节点预览':'正在同步新问答…'}</div>}
   <div className="map-controls">{!inline&&!compact&&<span><i/> 当前问题 <span className="map-legend-line"/> 当前问题路径 <span className="map-legend-dash"/> 其他路径</span>}<div><button onClick={entry}>{compact?'看整体':'回到顶部'}</button><button onClick={focus}>定位当前</button><button aria-label="缩小分支图" onClick={()=>setZoom(z=>Math.max(.35,z-.15))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="放大分支图" onClick={()=>setZoom(z=>Math.min(2.5,z+.15))}>＋</button></div></div>
   <div className={'map-canvas'+(panning?' is-panning':'')} ref={canvas} onPointerDown={e=>{if(e.button!==1)return;e.preventDefault();drag.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y};e.currentTarget.setPointerCapture(e.pointerId);setPanning(true);}} onPointerMove={e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;if(!(e.buttons&4)){stopPan(e.pointerId);return;}e.preventDefault();setPan({x:d.panX+e.clientX-d.x,y:d.panY+e.clientY-d.y});}} onPointerUp={e=>stopPan(e.pointerId)} onPointerCancel={e=>stopPan(e.pointerId)} onLostPointerCapture={e=>stopPan(e.pointerId)} onAuxClick={e=>{if(e.button===1)e.preventDefault();}}><div className="map-scale-container" style={{width:graph.width*scale,height:graph.height*scale,margin:compact?'12px auto':undefined,transform:`translate(${pan.x}px, ${pan.y}px)`}}><div className="map-world" style={{width:graph.width,height:graph.height,transform:`scale(${scale})`}}>
    <svg width={graph.width} height={graph.height} aria-hidden="true">{graph.edges.map(e=>{const a=graph.nodes.find(n=>n.id===e.from)!,b=graph.nodes.find(n=>n.id===e.to)!;const x=a.x+(compact?9:12),y=a.y+(compact?9:14),tx=b.x+(compact?9:12),ty=b.y+(compact?9:14);const shape=`M${x},${y} L${tx},${ty}`;return <g key={e.from+e.to} className={hover===e.from||hover===e.to||route.has(e.from)&&route.has(e.to)?'edge-emphasis':''}><path data-kind={e.kind} data-from={e.from} data-to={e.to} className={(mainline.has(e.from+'\0'+e.to)?'mainline-edge':'side-edge')+(e.kind==='fork'?' fork-connector':'')} d={shape}/></g>;})}</svg>
    {graph.nodes.map((n,index)=><button key={n.id} disabled={!!n.preview} aria-label={n.preview?(n.preview==='draft'?'草稿预览：':'待同步问答：')+n.label:compact?'问题 '+(index+1)+'：'+n.label:undefined} className={'question-point '+(n.preview?'preview-point ':'')+(n.threadId===rootId?'trunk ':'')+(n.id===activeNode?.id?'current ':'')+(route.has(n.id)?'on-route ':'')+(hover===n.id?'hovered':'')} style={{left:n.x,top:n.y}} onMouseEnter={()=>setHover(n.id)} onMouseLeave={()=>setHover('')} onClick={()=>{if(!n.preview)onOpen(n.threadId,n.turnId);}} title={n.label}><span className="point-circle"/>{!compact&&<span className="point-card"><small>{n.preview?(n.preview==='draft'?'正在输入 · 待发送':'正在同步…'):<> {n.threadId===rootId?'入口主干 · ':''}问题 {index+1}{n.kind==='pending'?' · 等待回答':''}</>}</small><strong>{n.label.slice(0,110)}</strong><span>{n.preview?'发送后自动同步真实问答':<>{graph.edges.filter(e=>e.from===n.id&&e.kind==='fork').length} 个追问 <em>打开 ↗</em></>}</span></span>}</button>)}
   </div></div></div>{!inline&&<footer>{compact?'按住鼠标中键拖动。实线是当前问题路径，虚线是其他路径。':'按住鼠标中键拖动，左键点击节点打开问答；实线是当前问题路径。'}</footer>}
  </section>
 </div>;
}
