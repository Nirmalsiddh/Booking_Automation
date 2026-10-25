'use strict';
const PHONE='15555550101';
const message=(id='inquiry',text='Tell me about assessments')=>({messages:[{id,from:PHONE,from_me:false,type:'text',text:{body:text}}]});
const ai=(category='Interested')=>JSON.stringify({category,reply:'untrusted text',booking_date:null,booking_time:null,collected_data:{}});
const inquiry=(id='inquiry',text,category='Interested',at)=>({body:message(id,text),ai:ai(category),at});
const tick=(at='2030-06-02T10:00:00+04:00',extra={})=>({body:message('operator-'+at),operator:'tick',at,...extra});
const checks=(name,test)=>[{name,test}];
const promos=s=>s.provider.filter(c=>c.kind==='promotion');
const none=s=>promos(s).length===0&&s.outreach.outreach_notifications.length===0;
const overlapping=s=>{const r=s.executions.filter(e=>e.executedNodes.includes('Operator - Outreach')).slice(-2);return r.length===2&&Math.max(r[0].startedAt,r[1].startedAt)<Math.min(r[0].finishedAt,r[1].finishedAt);};
const accepted=s=>promos(s).length===1&&s.outreach.outreach_notifications.filter(n=>n.status==='accepted').length===1;
const base=(id,turns,test,name='Eligibility, durable state and message count are correct',extra={})=>({id,consent:'granted',turns,checks:checks(name,test),...extra});
const staff=(channel,state,version,id=state)=>({body:message('staff-'+id),operator:'handoff',at:'2030-06-04T11:00:00+04:00',update:{id,customer:channel+':'+PHONE,state,expectedVersion:version,reason:'synthetic staff action',actor:'synthetic-staff'}});
const consent=(channel,status,version,id='consent-change')=>({body:message(id),operator:'consent',at:'2030-06-01T12:00:00+04:00',update:{id,customer:channel+':'+PHONE,status,source:'staff_verified',actor:'synthetic-staff',evidence:'synthetic explicit choice',occurred:Date.parse('2030-06-01T12:00:00+04:00'),expectedVersion:version}});
const scenarios=[
 base('eligible-followup',[inquiry(),tick()],accepted),
 base('reply-before-followup',[inquiry(),inquiry('reply','I have another question','Needs Info','2030-06-02T09:00:00+04:00'),tick()],s=>none(s)&&s.outreach.outreach_jobs.some(j=>j.status==='cancelled')),
 base('booking-before-followup',[inquiry(),{body:message('book','BOOK 2030-06-11 10:00'),ai:JSON.stringify({category:'Booking Pending',reply:'untrusted',booking_date:'2030-06-11',booking_time:'10:00',collected_data:{}})},tick()],s=>none(s)&&s.booking.bookings[0].state==='confirmed'&&s.booking.booking_notifications[0].status==='succeeded'),
 base('optout-before-followup',[inquiry(),inquiry('stop','STOP','Needs Info'),tick()],s=>none(s)&&s.outreach.outreach_contacts[0].consent==='revoked'&&s.messages.at(-1).body.includes('Promotional follow-ups are disabled')),
 base('declined-contact',[inquiry(),inquiry('decline','No thanks','Not Interested'),tick()],s=>none(s)&&s.outreach.outreach_contacts[0].engagement==='Not Interested'),
 base('duplicate-job',[inquiry(),inquiry(),tick(),tick()],s=>accepted(s)&&s.outreach.outreach_sequences.length===1),
 base('concurrent-workers',[inquiry(),{parallel:[tick(),tick()]}],s=>accepted(s)&&overlapping(s)),
 base('restart-pending',[inquiry()],s=>none(s)&&s.outreach.outreach_jobs[0].status==='pending'),
 base('outbound-failure',[inquiry(),tick(undefined,{outreachFaults:{outbound:'failed'}}),tick()],s=>promos(s).length===1&&s.outreach.outreach_notifications[0].status==='failed'),
 base('outbound-uncertain',[inquiry(),tick(undefined,{outreachFaults:{outbound:'timeout'}}),tick()],s=>promos(s).length===1&&s.outreach.outreach_notifications[0].status==='uncertain'),
 base('superseded-sequence',[inquiry(),inquiry('new','Could you explain pricing?','Interested','2030-06-02T09:00:00+04:00'),tick()],s=>none(s)&&s.outreach.outreach_sequences.length===2&&s.outreach.outreach_sequences[0].status==='superseded'),
 base('new-sequence-eligible',[inquiry(),inquiry('new','I am still interested','Interested','2030-06-02T09:00:00+04:00'),tick('2030-06-03T10:00:00+04:00')],s=>accepted(s)&&s.outreach.outreach_sequences.length===2),
 base('handoff-due',[inquiry(),tick(),tick('2030-06-04T10:00:00+04:00')],s=>accepted(s)&&s.outreach.outreach_handoffs[0].state==='Requested'),
 base('duplicate-handoff',[inquiry(),tick(),tick('2030-06-04T10:00:00+04:00'),tick('2030-06-04T10:00:00+04:00')],s=>s.outreach.outreach_handoff_events.length===1&&s.outreach.outreach_handoffs[0].state==='Requested'),
 base('assigned-handoff',[inquiry(),tick(),tick('2030-06-04T10:00:00+04:00'),staff('assigned-handoff','Assigned',1),inquiry('new','Please help'),tick('2030-06-06T10:00:00+04:00')],s=>accepted(s)&&s.outreach.outreach_handoffs[0].state==='Assigned'),
 base('resolved-handoff',[inquiry(),tick(),tick('2030-06-04T10:00:00+04:00'),staff('resolved-handoff','Resolved',1),inquiry('new','Please help'),tick('2030-06-06T10:00:00+04:00')],s=>accepted(s)&&s.outreach.outreach_handoffs[0].state==='Resolved'),
 base('timezone-boundary',[inquiry(),tick('2030-06-02T04:59:00Z'),tick('2030-06-02T05:00:00Z')],s=>accepted(s)&&s.executions.some(e=>e.result?.outcome==='deferred')),
 base('outside-sending-hours',[inquiry(),tick('2030-06-02T18:00:00+04:00')],s=>none(s)&&s.outreach.outreach_jobs[0].due===Date.parse('2030-06-03T09:00:00+04:00')),
 base('maximum-attempts',[inquiry(),tick(),tick('2030-06-03T10:00:00+04:00'),tick('2030-06-04T10:00:00+04:00'),tick('2030-06-05T10:00:00+04:00')],s=>accepted(s)&&s.outreach.outreach_handoffs[0].state==='Requested'&&s.outreach.outreach_jobs.filter(j=>j.kind==='promotion').length===1),
 base('booking-state-preserved',[inquiry(),staff('booking-state-preserved','Requested',0),staff('booking-state-preserved','Assigned',1),staff('booking-state-preserved','Resolved',2),tick()],s=>none(s)&&s.booking.bookings[0].state==='confirmed'&&s.booking.bookings[0].version===1&&s.booking.bookings[0].event==='seed-event-0'&&s.outreach.outreach_handoffs[0].booking_ref==='seed-booking',undefined,{seed:true})
];
// Additional approved consent cases. Direct and transactional messages stay independent.
scenarios.push(
 base('interrupted-send',[inquiry(),tick(undefined,{outreachFaults:{crash:true},outreachCrash:true}),{body:message('recover'),operator:'recover',recoverInterrupted:true},tick()],s=>promos(s).length===1&&s.outreach.outreach_notifications[0].status==='uncertain'&&s.outreach.outreach_jobs[0].status==='uncertain'),
 base('legacy-assigned-handoff',[inquiry(),tick()],s=>none(s)&&s.outreach.outreach_handoffs[0].state==='Assigned',undefined,{rows:{[PHONE]:{Phone:PHONE,Lead_Status:'Interested',Handoff_Status:'Assigned'}}}),
 base('legacy-resolved-handoff',[inquiry(),tick()],s=>none(s)&&s.outreach.outreach_handoffs[0].state==='Resolved',undefined,{rows:{[PHONE]:{Phone:PHONE,Lead_Status:'Interested',Handoff_Status:'Resolved'}}}),
 base('decline-survives-inquiry',[inquiry(),inquiry('decline','No further contact','Not Interested'),inquiry('question','What are your opening hours?'),tick()],s=>none(s)&&s.outreach.outreach_contacts[0].declined===1),
 base('explicit-reoptin-after-decline',[inquiry(),inquiry('decline','No further contact','Not Interested'),inquiry('grant','OPT IN FOLLOWUPS'),tick()],s=>accepted(s)&&s.outreach.outreach_contacts[0].declined===0),
 base('unknown-consent',[inquiry(),tick()],s=>none(s)&&s.outreach.outreach_contacts[0].consent==='unknown'&&s.messages.length===1,undefined,{consent:null}),
 base('revoked-consent',[inquiry(),tick()],s=>none(s)&&s.outreach.outreach_contacts[0].consent==='revoked',undefined,{consent:'revoked'}),
 base('revocation-invalidates-jobs',[inquiry(),consent('revocation-invalidates-jobs','revoked',1),tick()],s=>none(s)&&s.outreach.outreach_jobs[0].status==='cancelled'),
 base('inquiry-no-consent',[inquiry(),tick()],s=>none(s)&&s.outreach.outreach_consent_events.length===0&&s.messages.length===1,undefined,{consent:null}),
 base('explicit-customer-optin',[inquiry('grant','OPT IN FOLLOWUPS'),tick()],s=>accepted(s)&&s.outreach.outreach_consent_events[0].source==='authenticated_inbound',undefined,{consent:null}),
 base('duplicate-consent-update',[inquiry(),consent('duplicate-consent-update','granted',0),consent('duplicate-consent-update','granted',0)],s=>s.outreach.outreach_consent_events.length===1&&s.outreach.outreach_contacts[0].consent_version===1,undefined,{consent:null}),
 base('revocation-versus-dispatch',[inquiry(),{parallel:[consent('revocation-versus-dispatch','revoked',1),tick(undefined,{waitForRevocation:true})]}],s=>none(s)&&overlapping(s)&&s.outreach.outreach_contacts[0].consent==='revoked'),
 base('no-consent-booking-confirmation',[{body:message('book','BOOK 2030-06-11 10:00'),ai:JSON.stringify({category:'Booking Pending',reply:'untrusted',booking_date:'2030-06-11',booking_time:'10:00',collected_data:{}})},tick()],s=>none(s)&&s.booking.bookings[0].state==='confirmed'&&s.booking.booking_notifications[0].status==='succeeded',undefined,{consent:null}),
 base('outdated-handoff-suppressed',[inquiry(),tick(),inquiry('reply','Thanks, I will ask later','Needs Info','2030-06-03T10:00:00+04:00'),tick('2030-06-04T10:00:00+04:00')],s=>s.outreach.outreach_handoffs.length===0&&s.outreach.outreach_jobs.some(j=>j.kind==='handoff'&&j.status==='cancelled'))
);
module.exports={scenarios,message,ai:ai()};
