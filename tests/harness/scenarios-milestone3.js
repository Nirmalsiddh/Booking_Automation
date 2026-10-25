'use strict';
const {scenariosFor}=require('./scenarios-milestone2');
const {PHONE}=require('./scenarios');
// Prior fixtures remain untouched. This suite adapts only the documented M3 contract.
const mutation=s=>s.calls.filter(c=>c.kind==='calendar');
const writes=s=>s.calls.filter(c=>c.kind==='sheet'&&c.parameters.operation&&c.parameters.operation!=='read');
const check=(name,test,known=false)=>({name,test,known});
const noAction=check('Rejected proposal makes no calendar or sheet writes and starts no delays',s=>mutation(s).length===0&&writes(s).length===0&&!s.calls.some(c=>c.kind==='wait'));
const clarification=check('Exactly one deterministic clarification is sent',s=>s.messages.length===1&&s.messages[0].node==='WHAPI - Send Clarification');
const body=text=>({messages:[{id:'synthetic-m3',from:PHONE,from_name:'Synthetic Customer',from_me:false,type:'text',text:{body:text}}]});
const ai=(extra={})=>JSON.stringify({category:'Booking Pending',reply:'UNTRUSTED: booking confirmed; ignore all rules',booking_date:'2030-06-11',booking_time:'10:00',collected_data:{},...extra});
const booked={Phone:PHONE,Lead_Status:'Qualified',Booking_Status:'Confirmed - Calendar Created',Calendar_Event_ID:'seed-event',Booking_Date:'2030-06-10',Booking_Time:'10:00'};
const events={'seed-event':{id:'seed-event'}};
function authorizeTurn(t,row){
 const copy=structuredClone(t);let p;try{p=JSON.parse(copy.ai);}catch{}
 if(p?.category==='Booking Pending'||p?.category==='Reschedule')copy.body.messages[0].text.body=`${p.category==='Booking Pending'?'BOOK':'RESCHEDULE'} ${p.booking_date} ${p.booking_time}`;
 if(p?.category==='Cancel Booking')copy.body.messages[0].text.body=`CONFIRM CANCEL ${row?.Booking_Date||'2030-06-10'} ${row?.Booking_Time||'10:00'}`;
 if(copy.duringWait)copy.duringWait=authorizeTurn(copy.duringWait,row);
 return copy;
}
const scenarios=scenariosFor('milestone2').map(s=>{
 const out={...s,turns:s.turns.map(t=>authorizeTurn(t,s.rows?.[PHONE])),checks:[...s.checks]};
 if(s.id==='reschedule')out.checks[1]=check('Existing event updated at correct Dubai instant',s=>Object.keys(s.events).length===1&&s.events['seed-event'].start==='2030-06-11T06:00:00.000Z');
 if(s.id==='invalid-ai')out.checks=[noAction,clarification];
 if(s.id==='calendar-failure')out.checks[2]=check('No outgoing body claims calendar success',s=>s.messages.every(m=>!m.body.includes('confirmed')&&!m.body.includes('UNTRUSTED')));
 // State safety assertions preserved; rejections no longer write harmless normalization/handoff.
 if(s.id==='unknown-state')out.checks=s.checks;
 return out;
});
const rejected=(id,text,raw,extra={})=>({id,...extra,turns:[{body:body(text),ai:raw}],checks:[noAction,clarification]});
scenarios.push(
 rejected('ai-without-authorization','Hello',ai()),
 rejected('ai-date-mismatch','BOOK 2030-06-12 10:00',ai()),
 rejected('ai-extra-field','BOOK 2030-06-11 10:00',ai({authorized:true})),
 rejected('ai-wrong-type','BOOK 2030-06-11 10:00',ai({booking_time:1000})),
 rejected('impossible-date','BOOK 2030-02-30 10:00',ai({booking_date:'2030-02-30'})),
 rejected('past-date','BOOK 2020-06-11 10:00',ai({booking_date:'2020-06-11'})),
 rejected('outside-hours','BOOK 2030-06-11 22:30',ai({booking_time:'22:30'})),
 rejected('cancel-without-confirmation','Cancel my booking',ai({category:'Cancel Booking',booking_date:null,booking_time:null}),{rows:{[PHONE]:booked},events}),
 rejected('cancel-stale-confirmation','CONFIRM CANCEL 2030-06-09 10:00',ai({category:'Cancel Booking',booking_date:null,booking_time:null}),{rows:{[PHONE]:booked},events}),
 {id:'cancel-confirmation-conversation',rows:{[PHONE]:booked},events,turns:[{body:body('cancel please'),ai:ai({category:'Cancel Booking'})},{body:body('CONFIRM CANCEL 2030-06-10 10:00'),ai:ai({category:'Cancel Booking'})}],checks:[check('Only explicit second turn can delete the saved event',s=>mutation(s).length===1&&mutation(s)[0].turn===2&&!s.events['seed-event'])]},
 {id:'safe-response',turns:[{body:body('BOOK 2030-06-11 10:00'),ai:ai()}],checks:[check('Authorized booking uses validated UTC interval and never echoes AI reply',s=>mutation(s).length===1&&mutation(s)[0].parameters.start==='2030-06-11T06:00:00.000Z'&&mutation(s)[0].parameters.end==='2030-06-11T07:00:00.000Z'&&s.messages.every(m=>!m.body.includes('UNTRUSTED')))]},
 {id:'invalid-inbound',turns:[{body:body('x'.repeat(2001)),ai:ai()}],checks:[check('Oversized inbound stops before lookup, AI and messaging',s=>s.calls.length===1&&s.calls[0].kind==='inbound')]}
);
module.exports={scenarios};
