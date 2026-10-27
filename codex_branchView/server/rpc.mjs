import { spawn, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

export function findCodex() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  try { return execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], {encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).find(p=>/\.exe$/i.test(p)) || 'codex'; } catch {}
  const base = path.join(process.env.LOCALAPPDATA || '', 'OpenAI','Codex','bin');
  if (fs.existsSync(base)) for (const dir of fs.readdirSync(base).reverse()) {
    const p = path.join(base,dir,'codex.exe'); if(fs.existsSync(p)) return p;
  }
  throw new Error('没有找到 Codex。请安装 Codex，或在启动前设置 CODEX_BIN 为可执行文件路径。');
}
export class CodexRPC extends EventEmitter {
  pending=new Map(); seq=0; ready=false; mode=''; stderr='';
  async connect() {
    const bin=findCodex();
    // Share the desktop daemon when available: its busy state is authoritative.
    const modes=process.env.CODEX_STANDALONE === '1' ? ['standalone'] : ['shared','standalone'];
    for (const mode of modes) {
      this.mode=mode; this.stderr='';
      try {
        this.proc=spawn(bin,mode==='shared'?['app-server','proxy']:['app-server','--listen','stdio://'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
        const proc=this.proc;
        proc.on('error', e=>{if(this.proc===proc)this.disconnect(e);});
        proc.stderr.on('data', b=>{if(this.proc===proc)this.stderr=(this.stderr+b).slice(-3000);});
        proc.on('exit', ()=>{if(this.proc===proc)this.disconnect(new Error('Codex 连接已关闭'));});
        this.lines=createInterface({input:this.proc.stdout});
        this.lines.on('line', line=>{try{this.receive(JSON.parse(line));}catch{}});
        this.info=await this.call('initialize',{clientInfo:{name:'codex_branches',title:'枝间',version:'1.0.0'},capabilities:{experimentalApi:true}},15000);
        this.notify('initialized',{}); this.ready=true; return this;
      } catch(e) {this.close();this.lastError=e.message;}
    }
    throw new Error(this.lastError+' '+this.stderr);
  }
  receive(m) {
    if(m.id!==undefined && (m.result!==undefined||m.error)) {
      const p=this.pending.get(m.id); if(!p)return; clearTimeout(p.timer);this.pending.delete(m.id);
      m.error?p.reject(Object.assign(new Error(m.error.message),{code:m.error.code})):p.resolve(m.result);
    } else if(m.id!==undefined && m.method) {
      // Never auto-approve tools, edits, permissions, or external actions.
      const result=m.method.includes('requestApproval')?{decision:'decline'}:null;
      this.send(result?{id:m.id,result}:{id:m.id,error:{code:-32601,message:'本客户端只支持只读分析；此操作未获批准。'}});
      this.emit('notification',{method:'client/blocked',params:{request:m.method,threadId:m.params?.threadId,message:'只读模式阻止了工具或权限请求：'+m.method}});
    } else if(m.method)this.emit('notification',m);
  }
  send(m){if(!this.proc?.stdin.writable)throw new Error('Codex 未连接');this.proc.stdin.write(JSON.stringify(m)+'\n');}
  notify(method,params){this.send({method,params});}
  call(method,params={},timeout=45000){const id=++this.seq;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(method+' 超时；请先刷新核对状态，不要重复发送。'));},timeout);
    this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });}
  disconnect(e){this.ready=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();this.emit('offline',e.message);}
  close(){if(this.ready||this.pending.size)this.disconnect(new Error('Codex 连接正在重启'));this.ready=false;this.lines?.close();this.proc?.kill();}
}
