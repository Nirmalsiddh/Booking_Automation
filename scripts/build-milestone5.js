'use strict';
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');const w=JSON.parse(fs.readFileSync(path.join(root,'workflows/milestone4.json')));const business=require('../config/validation.json'),resources=require('../config/reservations.json');
const policy={...resources,timezone:business.timezone,durationMinutes:business.durationMinutes,validation:business};const edge=node=>({node,type:'main',index:0});
function node(name,action){return {id:name,name,type:'CUSTOM.booking',typeVersion:1,position:[0,0],parameters:{action,database:'/inbox/inbox.sqlite',adapter:'unconfigured',revision:-1,httpConfig:{},snapshot:action==='execute'?"={{ $('Code - Prepare Context').item.json._booking_snapshot || {} }}":{},claim:"={{ $('Inbox - Claim').item.json._inbox }}",proposal:"={{ $('Code - Safe Parse & Prep').item.json }}",policy}};}
const hydrate=node('Booking - Authoritative Context','context');hydrate.parameters.proposal="={{ $('Merge - All Sources').item.json }}";w.nodes.push(hydrate,node('Booking - Verified Operation','execute'),node('Booking - Preserve Profile','profile'));
w.connections['IF - Authorized Proposal'].main[0]=[edge('Booking - Preserve Profile')];w.connections['Booking - Preserve Profile']={main:[[edge('Switch - Category Router')]]};
for(const outputs of Object.values(w.connections))for(const group of outputs.main||[])for(const e of group||[])if(e.node==='Code - Prepare Context')e.node=hydrate.name;
w.connections[hydrate.name]={main:[[edge('Code - Prepare Context')]]};
for(const index of [0,4,5])w.connections['Switch - Category Router'].main[index]=[edge('Booking - Verified Operation')];
w.connections['Booking - Verified Operation']={main:[[edge('Inbox - Finish')]]};
// Non-booking profile collection cannot overwrite the authoritative booking projection.
for(const n of w.nodes.filter(n=>n.name.startsWith('Sheet - Upsert'))){const values=n.parameters.columns?.value;if(values)for(const key of ['Booking_Status','Booking_Date','Booking_Time','Calendar_Event_ID'])delete values[key];}
w.id='milestone5Candidate';w.name='Booking - Milestone 5 Candidate';w.active=false;const file=path.join(root,'workflows/milestone5.json'),out=JSON.stringify(w,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==out)throw Error('STALE_M5');}else fs.writeFileSync(file,out);
