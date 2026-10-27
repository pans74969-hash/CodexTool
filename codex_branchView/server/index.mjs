import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodexRPC,findCodex } from './rpc.mjs';
import { Store } from './store.mjs';
import { Engine } from './engine.mjs';
import { validateAnchor,branchPrompt } from './domain.mjs';
import {desktopSidebar,projectFor} from './desktop.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=process.env.BRANCH_DATA_DIR||path.join(root,'data');
const store=new Store(dataDir),rpc=new CodexRPC();
const token=randomBytes(32).toString('hex'),clients=new Set();
const emit=(event,data)=>{for(const res of clients)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
const engine=new Engine(rpc,store,emit);
function enqueueBranch(branch){
 const existing=store.get('task',branch.taskId);if(existing)return existing;
 return engine.enqueue({id:branch.taskId,threadId:branch.threadId,text:branchPrompt({anchor:branch.anchor,question:branch.title,path:branch.path||[]}),model:branch.model||undefined,effort:branch.effort||undefined});
}
let connectionError='',capabilities=false,connecting=false;
let threadIndex={time:0,archived:false,threads:[]};
async function sidebarThreads(archived){
 if(threadIndex.archived===archived&&Date.now()-threadIndex.time<12000)return threadIndex.threads;
 const threads=[];let cursor=null;do{const r=await rpc.call('thread/list',{limit:100,cursor,archived,modelProviders:[],sortKey:'updated_at'});threads.push(...r.data);cursor=r.nextCursor;}while(cursor);
 threadIndex={time:Date.now(),archived,threads};return threads;
}
async function connect(){if(connecting)return;connecting=true;try{
 await rpc.connect();
 const schemaDir=path.join(dataDir,'protocol');
 await promisify(execFile)(findCodex(),['app-server','generate-json-schema','--out',schemaDir],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 const schema=JSON.parse(fs.readFileSync(path.join(schemaDir,'v2','ThreadForkParams.json'),'utf8'));
 capabilities=!!schema.properties.lastTurnId;
 if(!capabilities)throw new Error('本机 Codex 缺少指定轮次 fork，请更新 Codex。');
 await rpc.call('thread/list',{limit:1,modelProviders:[]});connectionError='';emit('connection',{ready:true,mode:rpc.mode});
}catch(e){connectionError=e.message;capabilities=false;emit('connection',{ready:false,message:connectionError});}finally{connecting=false;}}
rpc.on('offline',message=>{connectionError=message;});
function json(res,body,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>25*1024*1024)throw new Error('请求超过 25 MB');}return text?JSON.parse(text):{};}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.json':'application/json','.md':'text/plain; charset=utf-8','.c':'text/plain; charset=utf-8','.frag':'text/plain; charset=utf-8','.vert':'text/plain; charset=utf-8'};
function sameToken(value){return typeof value==='string'&&value.length===token.length&&timingSafeEqual(Buffer.from(value),Buffer.from(token));}
function authorize(req,url){return sameToken(req.headers['x-session-token']||url.searchParams.get('token'));}
async function route(req,res,url){
 const p=url.pathname;
 if(p==='/api/bootstrap')return json(res,{token,ready:rpc.ready&&capabilities,error:connectionError,mode:rpc.mode,branches:store.all('branch'),positions:store.all('position'),tasks:engine.tasks(),settings:store.get('settings','main')||{cwd:'',mappings:[]}});
 if(!authorize(req,url))return json(res,{error:'会话令牌无效，请刷新网页'},403);
 if(p==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);const keep=setInterval(()=>res.write(': ping\n\n'),20000);req.on('close',()=>{clients.delete(res);clearInterval(keep);});return;}
 if(p==='/api/reconnect'&&req.method==='POST'){rpc.close();await connect();return json(res,{ready:rpc.ready&&capabilities,error:connectionError});}
 if(p==='/api/account') {const r=await rpc.call('account/read',{});return json(res,{account:r.account?{type:r.account.type,planType:r.account.planType}:null,requiresOpenaiAuth:r.requiresOpenaiAuth});}
 if(p==='/api/login'&&req.method==='POST'){const r=await rpc.call('account/login/start',{type:'chatgpt'});return json(res,{authUrl:r.authUrl,loginId:r.loginId});}
 if(p==='/api/models')return json(res,await rpc.call('model/list',{}));
 if(p==='/api/sidebar')return json(res,desktopSidebar(rpc.info?.codexHome));
 if(p==='/api/threads'){
  const sidebar=desktopSidebar(rpc.info?.codexHome),project=url.searchParams.get('project'),query=(url.searchParams.get('q')||'').toLocaleLowerCase();
  let threads=await sidebarThreads(url.searchParams.get('archived')==='true');
  if(project&&project!=='all')threads=threads.filter(t=>projectFor(t,sidebar)===(project==='none'?null:project));
  if(query)threads=threads.filter(t=>(t.name||t.preview||'').toLocaleLowerCase().includes(query));
  const offset=Math.max(0,Number(url.searchParams.get('cursor'))||0),data=threads.slice(offset,offset+30);
  return json(res,{data,nextCursor:offset+30<threads.length?String(offset+30):null,total:threads.length});
 }
 if(p==='/api/thread')return json(res,await engine.read(url.searchParams.get('id'),url.searchParams.get('cursor')));
 if(p==='/api/position'&&req.method==='POST'){const b=await body(req);if(typeof b.id!=='string'||!Number.isFinite(b.top))throw new Error('阅读位置无效');return json(res,store.put('position',b.id,b));}
 if(p==='/api/settings'&&req.method==='POST'){const b=await body(req);if(b.cwd&&!fs.statSync(b.cwd).isDirectory())throw new Error('项目目录不存在');if(!Array.isArray(b.mappings)||b.mappings.some(m=>typeof m.from!=='string'||!m.from||typeof m.to!=='string'||!fs.statSync(m.to).isDirectory()))throw new Error('目录映射无效');return json(res,store.put('settings','main',{cwd:b.cwd||'',mappings:b.mappings}));}
 if(p==='/api/new'&&req.method==='POST'){if(!capabilities)throw new Error('Codex 协议尚未验证');const b=await body(req),settings=store.get('settings','main');const r=await rpc.call('thread/start',{cwd:settings?.cwd||undefined,sandbox:'read-only',approvalPolicy:'never',...(b.model?{model:b.model}:{})});engine.loaded.add(r.thread.id);return json(res,{thread:r.thread});}
 if(p==='/api/send'&&req.method==='POST'){if(!capabilities)throw new Error('Codex 协议尚未验证');const b=await body(req);if(typeof b.text!=='string'||!b.text.trim()||b.text.length>100000)throw new Error('消息为空或太长');if(typeof b.id!=='string'||!b.threadId)throw new Error('消息标识无效');return json(res,engine.enqueue({id:b.id,threadId:b.threadId,text:b.text,model:b.model||undefined,effort:b.effort||undefined}));}
 if(p==='/api/branch'&&req.method==='POST'){
  if(!capabilities)throw new Error('Codex 不支持指定轮次分叉');const b=await body(req);
  if(typeof b.id!=='string'||!b.parentId||!b.rootId)throw new Error('分支标识不完整');
  const existing=store.get('branch',b.id);if(existing)return json(res,{branch:existing,task:enqueueBranch(existing)});
  // Persist intent before fork. A crash or timeout cannot silently create another fork.
  if(store.get('forkIntent',b.id))throw new Error('该分支创建结果尚未确认，请在 Codex 会话列表中核对；不会自动重复 fork。');
  let cursor=null,turn;do{const page=await engine.page(b.parentId,cursor,30);turn=page.data.find(t=>t.id===b.anchor?.turnId);cursor=page.nextCursor;}while(!turn&&cursor);
  validateAnchor(b.anchor,turn);
  store.put('forkIntent',b.id,{id:b.id,status:'sending',parentId:b.parentId});
  const r=await rpc.call('thread/fork',{threadId:b.parentId,lastTurnId:b.anchor.turnId,excludeTurns:true,sandbox:'read-only',approvalPolicy:'never',ephemeral:false});
  engine.loaded.add(r.thread.id);const branch={id:b.id,threadId:r.thread.id,parentId:b.parentId,rootId:b.rootId,anchor:b.anchor,title:b.question?.trim()||`解释「${b.anchor.quote.slice(0,32)}」`,taskId:randomUUID(),createdAt:Date.now(),path:Array.isArray(b.path)?b.path:[],model:b.model||undefined,effort:b.effort||undefined};
  store.put('branch',b.id,branch);store.put('forkIntent',b.id,{id:b.id,status:'completed',threadId:r.thread.id});emit('branch',branch);
  await rpc.call('thread/name/set',{threadId:r.thread.id,name:`追问 · ${b.anchor.quote.replace(/\s+/g,' ').slice(0,45)}`}).catch(()=>{});
  const task=enqueueBranch(branch);
  return json(res,{branch,task});
 }
 if(p==='/api/stop'&&req.method==='POST')return json(res,await engine.stop((await body(req)).id));
 if(p==='/api/retry'&&req.method==='POST')return json(res,await engine.retry((await body(req)).id));
 if(p==='/api/file'){
  const settings=store.get('settings','main')||{};let requested=url.searchParams.get('path')||'';
  try{requested=decodeURIComponent(requested);}catch{}
  requested=requested.replace(/^\/([A-Za-z]:[\\/])/,'$1').replace(/^file:\/\/\//,'');
  const mappings=[...(settings.mappings||[])].sort((a,b)=>b.from.length-a.from.length);
  for(const m of mappings){const from=m.from.replaceAll('\\','/').replace(/\/$/,'');const normalized=requested.replaceAll('\\','/');if(normalized.toLowerCase()===from.toLowerCase()||normalized.toLowerCase().startsWith(from.toLowerCase()+'/')){requested=path.join(m.to,normalized.slice(from.length));break;}}
  const allowed=[settings.cwd,...mappings.map(m=>m.to)].filter(Boolean);
  const target=fs.realpathSync(path.resolve(requested));const inside=allowed.some(dir=>{const base=fs.realpathSync(dir),rel=path.relative(base,target);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));});
  if(!inside)return json(res,{error:'文件不在已选项目目录内。请在设置中选择项目或添加目录映射。'},403);
  if(!fs.statSync(target).isFile())throw new Error('不是文件');const ext=path.extname(target).toLowerCase();
  if(!mime[ext])return json(res,{error:'此文件类型不支持预览'},415);
  res.writeHead(200,{'Content-Type':mime[ext],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});fs.createReadStream(target).pipe(res);return;
 }
 json(res,{error:'接口不存在'},404);
}
let vite;
if(!fs.existsSync(path.join(root,'dist','index.html'))){const {createServer}=await import('vite');vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});}
const server=http.createServer(async(req,res)=>{
 const address=server.address();const origin=`http://127.0.0.1:${address.port}`;
 if(req.headers.host!==`127.0.0.1:${address.port}`&&req.headers.host!==`localhost:${address.port}`){res.writeHead(403);res.end('Invalid host');return;}
 if(req.headers.origin&&![origin,`http://localhost:${address.port}`].includes(req.headers.origin)){res.writeHead(403);res.end('Invalid origin');return;}
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','SAMEORIGIN');
 const url=new URL(req.url,origin);
 try{
  if(url.pathname.startsWith('/api/'))await route(req,res,url);
  else if(vite)vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
  else{let file=path.resolve(root,'dist','.'+decodeURIComponent(url.pathname));const base=path.join(root,'dist');if(!file.startsWith(base+path.sep))file=path.join(base,'index.html');if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(base,'index.html');res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);}
 }catch(e){if(!res.headersSent)json(res,{error:e.message},400);else res.end();}
});
server.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>{console.log(`枝间 Local: http://127.0.0.1:${server.address().port}`);connect();});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口被占用，请设置 PORT 后重启。':e.message);process.exitCode=1;clearInterval(engine.timer);rpc.close();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{rpc.close();for(const c of clients)c.end();server.close();store.close();process.exit(0);});
