export function cleanQuestion(raw:string){
 let text=raw.replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/g,'').replace(/<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/g,'').trim();
 // A branch may quote an older question containing "## My request:". Extract the
 // actual follow-up first, so quoted wrappers cannot replace the user's question.
 if(/^(关于「|我正在阅读这个对话中的一段回答)/.test(text)&&text.includes('\n\n我的问题：'))return text.slice(text.lastIndexOf('\n\n我的问题：')+'\n\n我的问题：'.length).split('\n\n请从基础解释')[0].trim();
 const marker=text.lastIndexOf('## My request:');if(marker>=0)text=text.slice(marker+'## My request:'.length).trim();
 if(/^(关于「|我正在阅读这个对话中的一段回答)/.test(text)&&text.includes('我的问题：')){text=text.split('我的问题：').slice(1).join('我的问题：').split('\n\n请从基础解释')[0].trim();}
 text=text.replace(/^PLEASE IMPLEMENT THIS PLAN:\s*/,'请实现以下方案：\n').replace(/<\/?proposed_plan>/g,'').trim();
 return text;
}
export function finalAnswer(item:{type:string;phase?:string}){return item.type==='agentMessage'&&item.phase!=='commentary';}
