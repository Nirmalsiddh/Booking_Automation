'use strict';
const {scenarios:previous}=require('./scenarios-milestone3');
const {PHONE}=require('./scenarios');
const test=(name,fn,known=false)=>({name,test:fn,known});
const message=(id='security-message',text='BOOK 2030-06-11 10:00',phone=PHONE)=>({messages:[{id,from:phone,from_me:false,type:'text',text:{body:text}}]});
const ai=JSON.stringify({category:'Booking Pending',reply:'Synthetic request',booking_date:'2030-06-11',booking_time:'10:00',collected_data:{}});
const turn=(extra={})=>({body:message(),ai,...extra});
const calls=(s,kind)=>s.calls.filter(c=>c.kind===kind).length;
const noBusiness=test('No AI, booking or outbound operations',s=>calls(s,'ai')===0&&calls(s,'calendar')===0&&s.messages.length===0);
const once=test('One AI, calendar operation and notification',s=>calls(s,'ai')===1&&calls(s,'calendar')===1&&s.messages.length===1);
const status=n=>test('HTTP status '+n,s=>s.http.every(x=>x===n));
const inherited=previous.map(s=>{
 const copy={...s,turns:s.turns.map((t,i)=>{const out=structuredClone(t);out.body.messages[0].id=s.id==='duplicate-webhook'?'same-message':s.id+'-'+i;if(out.duringWait)out.duringWait.body.messages[0].id=s.id+'-reply';return out;}),checks:[...s.checks]};
 if(s.id==='invalid-inbound')copy.checks=[noBusiness,status(422)];
 if(s.id==='calendar-failure')copy.checks=copy.checks.map(c=>({...c,known:false}));
 if(s.id==='duplicate-webhook')copy.checks=copy.checks.map(c=>({...c,known:false}));
 return copy;
});
const security=[
 {id:'valid-authentication',turns:[turn()],checks:[status(202),once]},
 {id:'missing-authentication',turns:[turn({auth:null})],checks:[status(401),noBusiness]},
 {id:'invalid-authentication',turns:[turn({auth:'invalid-synthetic-key'})],checks:[status(401),noBusiness]},
 {id:'malformed-payload',turns:[turn({raw:'not JSON'})],checks:[status(400),noBusiness]},
 {id:'unsupported-type',turns:[turn({body:{messages:[{...message().messages[0],type:'image'}]}})],checks:[status(422),noBusiness]},
 {id:'delivery-receipt',turns:[turn({body:{statuses:[{id:'receipt',status:'read'}]}})],checks:[status(200),noBusiness]},
 {id:'bot-echo',turns:[turn({body:{messages:[{...message().messages[0],from_me:true}]}})],checks:[status(200),noBusiness]},
 {id:'sequential-duplicate',turns:[turn(),turn()],checks:[once]},
 {id:'concurrent-duplicate',concurrent:true,turns:[turn(),turn()],checks:[once,test('Both real n8n executions complete',s=>s.executions.length===2&&s.executions.every(x=>x.status==='success'))]},
 {id:'multiple-messages',turns:[turn({body:{messages:[message('batch-1').messages[0],message('batch-2','BOOK 2030-06-11 10:00','15555550102').messages[0]]}})],checks:[test('Two messages independently reach AI, booking and messaging',s=>calls(s,'ai')===2&&calls(s,'calendar')===2&&s.messages.length===2),test('Two inbox identities complete',s=>s.inbox.messages.filter(m=>m.status==='completed').length===2)]},
 {id:'interrupted-before-effects',turns:[turn({crashBefore:true}),turn()],checks:[once,test('Killed owner without operations is safely retried',s=>s.inbox.messages[0].attempts===2&&s.inbox.messages[0].status==='completed')]},
 {id:'recoverable-failure',turns:[turn({failBefore:true}),turn()],checks:[once,test('Pre-effect retry uses a new claim',s=>s.inbox.messages[0].attempts===2)]},
 {id:'replayed-event',turns:[turn(),turn(),turn()],checks:[once]},
 {id:'missing-message-id',turns:[turn({body:message('')})],checks:[status(422),noBusiness]},
 {id:'valid-existing-booking',rows:{[PHONE]:{Phone:PHONE,Lead_Status:'Qualified',Booking_Status:'Confirmed - Calendar Created',Calendar_Event_ID:'existing',Booking_Date:'2030-06-10',Booking_Time:'10:00'}},events:{existing:{id:'existing'}},turns:[turn({body:message('existing','RESCHEDULE 2030-06-11 10:00'),ai:JSON.stringify({...JSON.parse(ai),category:'Reschedule'})})],checks:[once,test('Existing event identity retained',s=>Object.keys(s.events).length===1&&!!s.events.existing)]},
 {id:'interrupted-after-effect',turns:[turn({crashAfter:'calendar'}),turn()],checks:[test('Uncertain calendar effect is not repeated or notified',s=>calls(s,'ai')===1&&calls(s,'calendar')===1&&s.messages.length===0&&s.inbox.messages[0].status==='uncertain')]},
 {id:'changed-payload-id',turns:[turn(),turn({body:message('security-message','BOOK 2030-06-12 10:00')})],checks:[once,test('Changed immutable content rejected',s=>s.http[1]===409)]},
 {id:'concurrent-distinct',concurrent:true,turns:[turn({body:message('different-1')}),turn({body:message('different-2','BOOK 2030-06-11 10:00','15555550102')})],checks:[test('Different IDs progress independently',s=>calls(s,'ai')===2&&calls(s,'calendar')===2&&s.messages.length===2&&s.inbox.messages.every(m=>m.status==='completed'))]},
 {id:'invalid-content-type',turns:[turn({contentType:'text/plain'})],checks:[status(415),noBusiness]},
 {id:'oversized-payload',turns:[turn({raw:' '.repeat(65537)})],checks:[status(413),noBusiness]},
 {id:'unconfigured-authentication',unconfigured:true,turns:[turn()],checks:[status(503),noBusiness]},
 {id:'mixed-batch',turns:[turn({body:{messages:[message('valid-batch').messages[0],{...message('invalid-batch').messages[0],from:'bad'}, {...message('echo-batch').messages[0],from_me:true}]}})],checks:[once,test('Only the valid item enters inbox',s=>s.inbox.messages.length===1)]},
];
module.exports={scenarios:[...inherited,...security],message,ai};
