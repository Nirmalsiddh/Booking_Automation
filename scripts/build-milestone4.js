'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),w=JSON.parse(fs.readFileSync(path.join(root,'workflows/milestone3.json')));
const edge=node=>({node,type:'main',index:0});
const original=[...w.nodes],webhook=w.nodes.find(n=>n.name==='Webhook - WHAPI Inbound');
webhook.type='CUSTOM.secureWebhook';webhook.typeVersion=1;webhook.parameters={path:'booking-inbox',channel:'fitness-studio',database:'/inbox/inbox.sqlite',maxBytes:65536};delete webhook.credentials;
const add=(name,action,operation='')=>{w.nodes.push({id:name,name,type:'CUSTOM.inbox',typeVersion:1,position:[0,0],parameters:{database:'/inbox/inbox.sqlite',action,operation,claim:action==='claim'?{}:"={{ $('Inbox - Claim').item.json._inbox }}"}});return name;};
add('Inbox - Claim','claim');add('Inbox - Finish','finish');
w.nodes.push({id:'loop-messages',name:'Loop - Messages',type:'n8n-nodes-base.splitInBatches',typeVersion:3,position:[0,0],parameters:{batchSize:1,options:{}}});
w.connections[webhook.name]={main:[[edge('Loop - Messages')]]};
w.connections['Loop - Messages']={main:[[],[edge('Inbox - Claim')]]};
w.connections['Inbox - Claim']={main:[[edge('Normalizer - WHAPI Payload')],[edge('Loop - Messages')]]};
w.connections['Inbox - Finish']={main:[[edge('Loop - Messages')]]};
// Identity persists in normalized items and remains linked to the immutable claim node.
const norm=w.nodes.find(n=>n.name==='Normalizer - WHAPI Payload');
norm.parameters.jsCode=norm.parameters.jsCode.replace('_skip: false,','_skip: false,\n  message_id:$input.item.json.envelope.id,\n  provider:$input.item.json.envelope.provider,\n  channel:$input.item.json.envelope.channel,');
// Wrap every externally executed main node, including AI and reads, before/after dispatch.
const effects=original.filter(n=>['n8n-nodes-base.googleSheets','n8n-nodes-base.googleCalendar','n8n-nodes-base.httpRequest','@n8n/n8n-nodes-langchain.agent'].includes(n.type));
for(const n of effects){
 const before=add('Inbox Begin - '+n.name,'begin',n.name),after=add('Inbox Complete - '+n.name,'complete',n.name);
 for(const outputs of Object.values(w.connections))for(const list of outputs.main||[])for(const e of list||[])if(e.node===n.name)e.node=before;
 const outgoing=w.connections[n.name]?.main||[];
 w.connections[before]={main:[[edge(n.name)],[]]};
 w.connections[n.name]={...(w.connections[n.name]||{}),main:[[edge(after)]]};
 w.connections[after]={main:[outgoing.flat().length?outgoing.flat():[edge('Inbox - Finish')],[edge('Loop - Messages')]]};
}
// Dormant demo inputs must not bypass authenticated entry/claim.
for(const name of ['Test - Meta Form','Test - Instagram'])delete w.connections[name];
w.name='Fitness Studio Booking - Milestone 4 Candidate';w.id='milestone4Candidate';w.active=false;
const out=JSON.stringify(w,null,2)+'\n',file=path.join(root,'workflows/milestone4.json');
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==out)throw Error('Stale M4 candidate');}else fs.writeFileSync(file,out);
