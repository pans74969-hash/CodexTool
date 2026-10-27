import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// Read only the desktop sidebar metadata. Never write desktop state or expose other keys.
export function desktopSidebar(home){
 try{return parseDesktop(JSON.parse(fs.readFileSync(path.join(home||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'.codex-global-state.json'),'utf8')));}catch{return {projects:[],assignments:{},projectless:[],aliases:{}};}
}
export function parseDesktop(d){
 const source=d['local-projects']||{},order=d['project-order']||[];
 const ids=[...new Set([...order,...Object.keys(source)])];
 const projects=ids.filter(id=>source[id]).map(id=>({id,name:source[id].name,paths:source[id].rootPaths||[]}));
 const aliases={};for(const mapping of Object.values(d['app-server-project-id-by-legacy-project-id-by-host']||{}))for(const [old,next] of Object.entries(mapping))aliases[next]=old;
 return {projects,selectedId:d['selected-project']?.projectId||null,assignments:d['thread-project-assignments']||{},projectless:d['projectless-thread-ids']||[],aliases};
}
export function projectFor(thread,sidebar){
 if(sidebar.projectless.includes(thread.id))return null;
 const assigned=sidebar.assignments[thread.id]?.projectId;
 if(assigned)return assigned;
 if(thread.projectId)return sidebar.aliases[thread.projectId]||thread.projectId;
 return null;
}
