'use strict';
const {scenarios:baseline,PHONE}=require('./scenarios');
const source=(text='Synthetic inquiry',id='m2-message')=>({messages:[{id,from:PHONE,from_name:'Synthetic Display',from_me:false,type:'text',text:{body:text}}]});
const turn=(category,collected={},extra={})=>({body:source(),ai:JSON.stringify({category,reply:'Synthetic response',collected_data:collected,...extra})});
const saved={Phone:PHONE,Name:'Synthetic Saved',Email:'saved@example.test',Goal:'Mobility',Experience:'beginner',Injuries:'None',Lead_Status:'Interested'};
const booked={...saved,Lead_Status:'Booking Confirmed',Booking_Status:'Confirmed - Calendar Created',Calendar_Event_ID:'seed-event',Booking_Date:'2030-06-10',Booking_Time:'10:00'};
const events={'seed-event':{id:'seed-event',start:'2030-06-10T10:00:00',end:'2030-06-10T11:00:00'}};
const mutationCalls=s=>s.calls.filter(c=>c.kind==='calendar');
function scenariosFor(variant) {
 const check=(name,test)=>({name,test,known:variant==='baseline'});
 const originals=baseline.map(s=>{
   const copy={...s,checks:s.checks.map(c=>({...c,known:c.known && !(variant==='milestone2' && ['existing-inquiry','multi-turn-qualification'].includes(s.id))}))};
   if(s.id==='reply-during-follow-up') {
     copy.checks[2]={...copy.checks[2],known:variant==='baseline',test:state=>['Qualified','Booking Confirmed'].includes(state.rows[PHONE]?.Lead_Status)};
     copy.checks.push({name:'Stale handoff is suppressed',known:true,test:state=>
       !state.rows[PHONE]?.Handoff_Status && !['Requires Manual Call','Required Manual Call'].includes(state.rows[PHONE]?.Lead_Status)});
   }
   return copy;
 });
 return [...originals,
  {id:'validated-partial-profile',rows:{[PHONE]:saved},turns:[turn('Interested',{email:'corrected@example.test',experience:'ADVANCED',full_name:'Synthetic Corrected'})],checks:[
   check('Valid partial patch updates supplied fields and preserves others',s=>{
    const r=s.rows[PHONE];return r.Email==='corrected@example.test' && r.Experience==='advanced' && r.Name==='Synthetic Corrected' && r.Goal==='Mobility' && r.Injuries==='None';})]},
  {id:'invalid-profile-patch',rows:{[PHONE]:saved},turns:[turn('Needs Info',{email:'bad-email',goal:[],experience:'expert',injuries:'x'.repeat(501),full_name:{bad:true}})],checks:[
   check('Invalid profile fields cannot replace valid saved values',s=>['Name','Email','Goal','Experience','Injuries'].every(k=>s.rows[PHONE][k]===saved[k]))]},
  {id:'null-profile-patch',rows:{[PHONE]:saved},turns:[turn('Interested',{email:null,goal:' ',experience:'null',injuries:''})],checks:[
   check('Null and empty updates preserve all saved profile values',s=>['Name','Email','Goal','Experience','Injuries'].every(k=>s.rows[PHONE][k]===saved[k]))]},
  {id:'confirmed-inquiries',rows:{[PHONE]:booked},events,turns:[turn('Interested'),turn('Needs Info'),turn('Booking Pending',{}, {booking_date:'2030-07-01',booking_time:'12:00'})],checks:[
   check('Inquiries cannot downgrade a confirmed booking or its slot',s=>s.rows[PHONE].Booking_Status===booked.Booking_Status && s.rows[PHONE].Booking_Date===booked.Booking_Date && s.rows[PHONE].Booking_Time===booked.Booking_Time && s.rows[PHONE].Calendar_Event_ID==='seed-event'),
   check('Qualified lead and handoff are separate fields',s=>s.rows[PHONE].Lead_Status==='Qualified' && s.rows[PHONE].Handoff_Status==='Requested'),
   check('Blocked rebooking performs no calendar mutation',s=>mutationCalls(s).length===0)]},
  {id:'decline-with-booking',rows:{[PHONE]:booked},events,turns:[turn('Not Interested')],checks:[
   check('Declining changes engagement without cancelling existing booking',s=>s.rows[PHONE].Lead_Status==='Not Interested' && s.rows[PHONE].Booking_Status===booked.Booking_Status && !!s.events['seed-event'])]},
  {id:'invalid-booking-transitions',rows:{[PHONE]:saved},turns:[turn('Reschedule',{}, {booking_date:'2030-07-01',booking_time:'12:00'}),turn('Cancel Booking')],checks:[
   check('Missing booking cannot be rescheduled or cancelled',s=>mutationCalls(s).length===0 && !['Cancelled','Reschedule Pending','Rescheduled - Calendar Updated'].includes(s.rows[PHONE].Booking_Status))]},
  {id:'unknown-state',rows:{[PHONE]:{...booked,Booking_Status:'Unknown legacy state'}},events,turns:[turn('Cancel Booking')],checks:[
   check('Unknown state is preserved and blocks destructive actions',s=>s.rows[PHONE].Booking_Status==='Unknown legacy state' && mutationCalls(s).length===0)]},
  {id:'reengage',rows:{[PHONE]:{...saved,Lead_Status:'Not Interested',Booking_Status:'Closed'}},turns:[turn('Interested')],checks:[
   check('Customer-initiated inquiry can reengage closed lead',s=>s.calls.some(c=>c.kind==='ai') && s.messages.length>0 && s.rows[PHONE].Lead_Status==='Interested' && s.rows[PHONE].Booking_Status==='Closed')]},
  {id:'cancelled-rebooking',rows:{[PHONE]:{...saved,Lead_Status:'Cancelled',Booking_Status:'Cancelled',Calendar_Event_ID:''}},turns:[turn('Booking Pending',{}, {booking_date:'2030-07-01',booking_time:'12:00'})],checks:[
   check('Previously cancelled booking can be replaced by a new request',s=>Object.keys(s.events).length===1 && s.rows[PHONE].Booking_Status==='Confirmed - Calendar Created')]},
 ];
}
module.exports={scenariosFor};
