'use strict';
const PHONE = '15555550101';
const response = (category, fields={}) => JSON.stringify({category, reply:'Synthetic studio reply.',
  booking_date:null, booking_time:null, collected_data:{}, ...fields});
const message = (text='Synthetic inquiry', id='synthetic-msg-1') => ({messages:[{
  id, from:PHONE, from_name:'Synthetic Customer', from_me:false, type:'text', text:{body:text},
}]});
const turn = (ai, extra={}) => ({body:message(), ai, ...extra});
const row = (extra={}) => ({Phone:PHONE, Name:'Synthetic Customer', Lead_Status:'Interested', ...extra});
const booked = row({Lead_Status:'Booking Confirmed', Booking_Status:'Confirmed - Calendar Created',
  Calendar_Event_ID:'seed-event', Booking_Date:'2030-06-10', Booking_Time:'10:00'});
const appointment = {booking_date:'2030-06-11', booking_time:'10:00'};
const seedEvent = {'seed-event':{id:'seed-event', start:'2030-06-10T10:00:00', end:'2030-06-10T11:00:00'}};
const sent = (s,node) => s.messages.some(m=>m.node===node);
const allSucceeded = (s, runs) => runs.every(r=>r.status==='success');
const check = (name, test, known=false) => ({name,test,known});
const scenarios = [
 {id:'new-inquiry', turns:[turn(response('Interested'))], checks:[
   check('Workflow completes',allSucceeded),
   check('Lead is created and initial reply is sent',s=>!!s.rows[PHONE] && sent(s,'WHAPI - Send Interested Reply')),
   check('No calendar event created',s=>Object.keys(s.events).length===0),
 ]},
 {id:'existing-inquiry', rows:{[PHONE]:row({Email:'customer@example.test',Goal:'Mobility'})},
  turns:[turn(response('Needs Info'))], checks:[check('Workflow completes',allSucceeded),
   check('Previously collected email and goal survive an inquiry',s=>s.rows[PHONE].Email==='customer@example.test' && s.rows[PHONE].Goal==='Mobility',true)]},
 {id:'multi-turn-qualification', turns:[
   turn(response('Interested',{collected_data:{email:'customer@example.test'}})),
   turn(response('Interested',{collected_data:{goal:'Strength'}}),{body:message('My goal is strength','synthetic-msg-2')}),
  ], checks:[check('Both turns complete',allSucceeded),
   check('Email survives subsequent qualification',s=>s.rows[PHONE]?.Email==='customer@example.test',true),
   check('Fresh and existing lead use the same memory session',s=>new Set(s.calls.filter(c=>c.kind==='ai').map(c=>c.parameters.harnessSessionKey)).size===1,true)]},
 {id:'new-booking', turns:[turn(response('Booking Pending',appointment))], checks:[
   check('Workflow completes',allSucceeded),
   check('One calendar event is created',s=>Object.keys(s.events).length===1),
   check('Confirmed state and event ID match calendar',s=>s.rows[PHONE]?.Booking_Status==='Confirmed - Calendar Created' && !!s.events[s.rows[PHONE].Calendar_Event_ID]),
   check('Booking confirmation is sent',s=>sent(s,'WHAPI - Send Booking Confirmation'))]},
 {id:'reschedule', rows:{[PHONE]:booked}, events:seedEvent,
  turns:[turn(response('Reschedule',appointment))], checks:[check('Workflow completes',allSucceeded),
   check('Existing event is updated without another event',s=>Object.keys(s.events).length===1 && s.events['seed-event'].start==='2030-06-11T10:00:00'),
   check('Rescheduled status and confirmation are recorded',s=>s.rows[PHONE]?.Booking_Status==='Rescheduled - Calendar Updated' && sent(s,'WHAPI - Send Reschedule Confirmation'))]},
 {id:'cancellation', rows:{[PHONE]:booked}, events:seedEvent,
  turns:[turn(response('Cancel Booking'))], checks:[check('Workflow completes',allSucceeded),
   check('Event removed and booking cancelled',s=>!s.events['seed-event'] && s.rows[PHONE]?.Booking_Status==='Cancelled'),
   check('Cancellation confirmation sent',s=>sent(s,'WHAPI - Send Cancellation Message'))]},
 {id:'decline', turns:[turn(response('Not Interested'))], checks:[check('Workflow completes',allSucceeded),
   check('Lead closes and receives only a closing reply',s=>s.rows[PHONE]?.Lead_Status==='Not Interested' && s.messages.length===1 && sent(s,'WHAPI - Send Closing Message'))]},
 {id:'invalid-ai', turns:[turn('This is not JSON')], checks:[check('Workflow completes',allSucceeded),
   check('Malformed JSON produces safe fallback and no booking',s=>sent(s,'WHAPI - Send Info Reply') && s.messages[0].body.includes('repeat') && Object.keys(s.events).length===0)]},
 {id:'calendar-failure', turns:[turn(response('Booking Pending',appointment),{faults:{calendar:'unavailable'}})], checks:[
   check('Injected calendar fault is exercised',s=>s.calls.some(c=>c.kind==='calendar'&&c.outcome==='error')),
   check('Failed calendar operation cannot mark booking confirmed',s=>s.rows[PHONE]?.Booking_Status!=='Confirmed - Calendar Created',true),
   check('Failed calendar operation cannot send success confirmation',s=>!sent(s,'WHAPI - Send Booking Confirmation'),true)]},
 {id:'duplicate-webhook', turns:[turn(response('Booking Pending',appointment)),turn(response('Booking Pending',appointment))], checks:[
   check('Turns execute',allSucceeded),
   check('Duplicate message is processed only once',s=>s.calls.filter(c=>c.kind==='ai').length===1 && s.messages.filter(m=>m.node!=='WHAPI - Follow-up 1 (Interested)').length===1,true)]},
 {id:'reply-during-follow-up', turns:[turn(response('Interested'),{duringWait:{
    body:message('Please book my assessment','synthetic-reply-during-wait'),
    ai:response('Booking Pending',appointment)}})], checks:[
   check('Reply executes through n8n and confirms a booking',s=>s.interleavedRuns?.[0]?.status==='success' && Object.keys(s.events).length===1),
   check('Stale follow-up is suppressed',s=>!sent(s,'WHAPI - Follow-up 1 (Interested)'),true),
   check('Later escalation does not overwrite newer lead state',s=>s.rows[PHONE]?.Lead_Status==='Booking Confirmed',true)]},
];
module.exports = {scenarios, PHONE};
