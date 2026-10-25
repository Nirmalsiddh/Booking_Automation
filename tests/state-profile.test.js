'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const candidate=require('../workflows/milestone2.json');
const {stateProfileRules}=require('../src/state-profile');
const rules=stateProfileRules();
const source={Lead_Phone:'15555550101',Lead_Name:'Synthetic Display',Lead_Source:'Whatsapp'};
const row={Phone:'15555550101',Name:'Synthetic Saved',Email:'saved@example.test',Goal:'Mobility',Experience:'beginner',Injuries:'None',
 Lead_Status:'Booking Confirmed',Booking_Status:'Confirmed - Calendar Created',Calendar_Event_ID:'synthetic-event',Booking_Date:'2030-06-10',Booking_Time:'10:00'};
function prep(category,data={}) {return rules.prepare(row,source,JSON.stringify({category,reply:'Synthetic reply',...data}));}
test('null, empty, omitted and string-null values preserve prior customer information',()=>{
 const p=rules.profile(row,{email:null,goal:' ',experience:'null',injuries:undefined},'Other display name');
 assert.deepEqual(p.merged,{Name:row.Name,Email:row.Email,Goal:row.Goal,Experience:row.Experience,Injuries:row.Injuries});
 assert.deepEqual(p.patch,{});
});
test('valid partial updates are normalized and merged',()=>{
 const p=rules.profile(row,{email:' new@example.test ',experience:'ADVANCED',full_name:'Synthetic Corrected'},'Other');
 assert.equal(p.merged.Email,'new@example.test');assert.equal(p.merged.Experience,'advanced');
 assert.equal(p.merged.Name,'Synthetic Corrected');assert.equal(p.merged.Goal,row.Goal);
});
test('invalid types, oversized strings and invalid enums do not replace saved fields',()=>{
 const p=rules.profile(row,{email:'invalid',goal:[],experience:'expert',injuries:'x'.repeat(501),full_name:{bad:true}},'Other');
 assert.equal(p.rejected.length,5);assert.equal(p.merged.Email,row.Email);assert.deepEqual(p.patch,{});
});
test('inquiries and declines cannot change confirmed booking details',()=>{
 for(const category of ['Interested','Needs Info','Not Interested','Booking Pending']) {
  const p=prep(category,{booking_date:'2030-07-01',booking_time:'11:00'});
  assert.equal(p.next_booking_status,row.Booking_Status);assert.equal(p.stored_booking_date,row.Booking_Date);
  assert.equal(p.stored_booking_time,row.Booking_Time);assert.equal(p.existing_calendar_event_id,row.Calendar_Event_ID);
 }
});
test('qualified lead cannot be downgraded by an inquiry',()=>{
 assert.equal(prep('Needs Info').next_lead_status,'Qualified');
 assert.equal(prep('Interested').next_lead_status,'Qualified');
 assert.equal(prep('Not Interested').next_lead_status,'Not Interested');
});
test('reschedule and cancel require confirmed state and event identity',()=>{
 for(const category of ['Reschedule','Cancel Booking']) {
  const p=rules.prepare({Lead_Status:'Interested'},source,JSON.stringify({category,booking_date:'2030-07-01',booking_time:'11:00'}));
  assert.equal(p.category,'Needs Info');assert.equal(p.next_booking_status,'Not Started');
 }
 assert.equal(prep('Cancel Booking').category,'Cancel Booking');
});
test('reschedule requires both date and time',()=>assert.equal(prep('Reschedule',{booking_date:'2030-07-01'}).category,'Needs Info'));
test('unknown states are preserved and block booking mutations',()=>{
 for(const bad of [{Booking_Status:'Unknown booking'},{Lead_Status:'Unknown lead'}]) {
  const p=rules.prepare({...row,...bad},source,JSON.stringify({category:'Cancel Booking'}));
  assert.equal(p.category,'Needs Info');assert.equal(p.next_booking_status,bad.Booking_Status||row.Booking_Status);
  if(bad.Lead_Status)assert.equal(p.next_lead_status,bad.Lead_Status);
 }
});
test('explicit transition matrix rejects confirmed downgrades and invalid states',()=>{
 assert.equal(rules.allowed('booking','confirmed','none'),false);
 assert.equal(rules.allowed('booking','confirmed','pending'),false);
 assert.equal(rules.allowed('booking','confirmed','rescheduling'),true);
 assert.equal(rules.allowed('booking','cancelled','pending'),true);
 assert.equal(rules.allowed('lead','Not Interested','Interested'),true);
 assert.equal(rules.allowed('lead','Qualified','Needs Info'),false);
 assert.equal(rules.allowed('booking',null,'pending'),false);
});
test('legacy statuses normalize without treating unknown values as fresh state',()=>{
 assert.equal(rules.leadState('Requires Manual Call'),'Interested');
 assert.equal(rules.leadState('Booking Confirmed'),'Qualified');
 assert.equal(rules.bookingState('Awaiting Date','synthetic-event'),'confirmed');
 assert.equal(rules.bookingState('Unknown'),null);
});
test('legacy manual-call flags migrate to handoff without losing the request',()=>{
 for(const Lead_Status of ['Requires Manual Call','Required Manual Call']) {
  const p=rules.prepare({...row,Lead_Status},source,JSON.stringify({category:'Needs Info'}));
  assert.equal(p.next_lead_status,'Needs Info');assert.equal(p.handoff_status,'Requested');
  assert.equal(p.next_booking_status,row.Booking_Status);
 }
 assert.equal(rules.prepare({...row,Handoff_Status:'Assigned'},source,'{}').handoff_status,'Assigned');
});
test('malformed or non-object AI output cannot crash profile handling',()=>{
 for(const raw of ['null','[]','not-json','42']) {
  const p=rules.prepare(row,source,raw);assert.equal(p.category,'Needs Info');assert.equal(p.collected_email,row.Email);
 }
});
const contextCode=candidate.nodes.find(n=>n.name==='Code - Prepare Context').parameters.jsCode;
function context(existing,phone=source.Lead_Phone,name=source.Lead_Name) {
 return vm.runInNewContext(`(function(){${contextCode}\n})()`,{
  $input:{item:{json:existing}}, $:()=>({item:{json:{...source,Lead_Phone:phone,Lead_Name:name}}}),
 });
}
test('conversation identity is stable across record creation, names and statuses',()=>{
 const initial=context({}).conversation_id;
 assert.equal(initial,context({...row,Phone:source.Lead_Phone}).conversation_id);
 assert.equal(initial,context({...row,Lead_Status:'Not Interested'},source.Lead_Phone,'Changed display').conversation_id);
 assert.equal(initial,'fitness-studio:whatsapp:'+source.Lead_Phone);
});
test('different phone identities cannot share a conversation key',()=>{
 assert.notEqual(context({},'15555550101').conversation_id,context({},'15555550102').conversation_id);
});
test('empty identity or lookup failure cannot become a shared fresh-customer session',()=>{
 assert.throws(()=>context({},''),/Invalid conversation identity/);
 assert.throws(()=>context({error:'Synthetic lookup failure'}),/Customer lookup failed/);
 assert.throws(()=>context({Name:'Unidentified saved row'}),/Customer record has no identity/);
 assert.throws(()=>context({...row,Phone:'15555550102'}),/Customer identity mismatch/);
});
