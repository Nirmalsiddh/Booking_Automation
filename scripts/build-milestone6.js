'use strict';
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');
const w=JSON.parse(fs.readFileSync(path.join(root,'workflows/milestone5.json'))),rules=require('../config/followups.json');
const edge=node=>({node,type:'main',index:0});
const node=(name,action)=>({id:name,name,type:'CUSTOM.outreach',typeVersion:1,position:[0,0],parameters:{action,database:'/inbox/inbox.sqlite',inboxDatabase:'/inbox/inbox.sqlite',adapter:'unconfigured',claim:"={{ $('Inbox - Claim').item.json._inbox }}",source:"={{ $('Normalizer - WHAPI Payload').item.json }}",activity:"={{ $('Outreach - Record Inbound').item.json._outreach }}",proposal:"={{ $('Code - Safe Parse & Prep').item.json }}",update:{},rules}});
for(const [name,action] of [['Outreach - Record Inbound','inbound'],['Outreach - Current Handoff','context'],['Outreach - Validated Engagement','engagement'],['Outreach - Schedule','schedule'],['Outreach - Process Due Job','tick']])w.nodes.push(node(name,action));
w.connections['IF - Real User Message'].main[0]=[edge('Outreach - Record Inbound')];w.connections['Outreach - Record Inbound']={main:[[edge('Merge - All Sources')]]};
w.connections['Booking - Authoritative Context'].main[0]=[edge('Outreach - Current Handoff')];w.connections['Outreach - Current Handoff']={main:[[edge('Code - Prepare Context')]]};
w.connections['Booking - Preserve Profile'].main[0]=[edge('Outreach - Validated Engagement')];w.connections['Outreach - Validated Engagement']={main:[[edge('Switch - Category Router')]]};
for(const name of ['Inbox Complete - WHAPI - Send Interested Reply','Inbox Complete - WHAPI - Send Info Reply'])w.connections[name].main[0]=[edge('Outreach - Schedule')];w.connections['Outreach - Schedule']={main:[[edge('Inbox - Finish')]]};
// Only this separate worker path dispatches promotions. No webhook-controlled operator updates.
const tick=w.nodes.find(n=>n.name==='Outreach - Process Due Job');tick.parameters.claim={};tick.parameters.source={};tick.parameters.activity={};tick.parameters.proposal={};
w.nodes.push({id:'Outreach - Scheduler Tick',name:'Outreach - Scheduler Tick',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,0],parameters:{rule:{interval:[{field:'minutes',minutesInterval:1}]}}});
w.connections['Outreach - Scheduler Tick']={main:[[edge(tick.name)]]};
// Retain historical nodes for comparison; disconnect all legacy delayed paths.
for(const n of w.nodes.filter(n=>/^(Wait -|WHAPI - Follow-up|Sheet - Flag Manual Call|Sheet - Flag Follow Up Required|Inbox (Begin|Complete) - (WHAPI - Follow-up|Sheet - Flag Manual Call|Sheet - Flag Follow Up Required))/.test(n.name)))delete w.connections[n.name];
// Exact consent commands receive truthful acknowledgements through the existing direct-reply path.
for(const name of ['WHAPI - Send Interested Reply','WHAPI - Send Info Reply','WHAPI - Send Closing Message','WHAPI - Send Fallback Reply','WHAPI - Send Clarification']){const n=w.nodes.find(n=>n.name===name),original=n.parameters.jsonBody.slice(3,-2).trim();n.parameters.jsonBody="={{ JSON.stringify({...JSON.parse("+original+"), body: $('Outreach - Record Inbound').item.json._consent_ack || JSON.parse("+original+").body}) }}";}
w.id='milestone6Candidate';w.name='Booking - Milestone 6 Candidate';w.active=false;w.settings={...w.settings,timezone:rules.timezone};const file=path.join(root,'workflows/milestone6.json'),out=JSON.stringify(w,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==out)throw Error('STALE_M6');}else fs.writeFileSync(file,out);
