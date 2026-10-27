import { CodexRPC } from './rpc.mjs';
const rpc=await new CodexRPC().connect();
try {
 console.log('transport',rpc.mode,'initialize',JSON.stringify(rpc.info));
 const list=await rpc.call('thread/list',{limit:2,sortKey:'updated_at',modelProviders:[]});
 console.log('list',JSON.stringify(list).slice(0,5000));
 if(list.data?.[0]) {
 const id=list.data[0].id;
 const turns=await rpc.call('thread/turns/list',{threadId:id,limit:2,itemsView:'full',sortDirection:'desc'});
 console.log('turns',JSON.stringify(turns).slice(0,6000));
 }
 const a=await rpc.call('account/read',{});console.log('account',JSON.stringify({signedIn:!!a.account,type:a.account?.type,planType:a.account?.planType}));
} finally {rpc.close();}
