import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['server/index.mjs'],{stdio:['inherit','pipe','inherit'],windowsHide:true});
let opened=false;
child.stdout.on('data',chunk=>{process.stdout.write(chunk);const match=chunk.toString().match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);if(match&&!opened){opened=true;if(process.platform==='win32')spawn('cmd.exe',['/c','start','',match[1]],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});}});
child.on('exit',code=>{process.exitCode=code||0;});child.on('error',e=>{console.error(e.message);process.exitCode=1;});
process.on('SIGINT',()=>child.kill());
