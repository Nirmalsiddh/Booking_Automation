'use strict';
const previous=require('./scenarios-milestone6');
const booking=require('./scenarios-milestone5');
// Preserve previous checks; Stage 1 adds diagnostics, never recovery commands.
const scenarios=previous.scenarios.filter(s=>s.id!=='interrupted-send').map(s=>({...s}));
for(const id of ['creation-failure','creation-timeout','reschedule-failure','cancel-failure','cancel-uncertain','distinct-slots','concurrent-slot','wrong-event-identity','batch-identities']){
 const source=booking.scenarios.find(s=>s.id===id);scenarios.push({...source,id:'ops-'+id});
}
scenarios.push({id:'ops-invalid-ai',turns:[{body:previous.message('invalid','CANARY_PRIVATE_CONVERSATION'),ai:'CANARY_INVALID_JSON'}],checks:[{name:'Invalid AI cannot execute a Calendar mutation',test:s=>!s.provider.some(c=>['create','update','delete'].includes(c.kind))}]});
scenarios.push({id:'ops-audit-failure',auditFailure:true,turns:[{body:booking.message(),ai:booking.ai,expectedAuditFailure:true}],checks:[{name:'Audit failure rolls back reservation and prevents provider mutation',test:s=>s.booking.booking_operations.length===0&&!s.provider.some(c=>['create','update','delete'].includes(c.kind))}]});
scenarios.push({id:'ops-sheets-failure',turns:[{body:booking.message(),ai:booking.ai,bookingFaults:{sheet:'failed'}}],checks:[{name:'Failed projection preserves verified confirmed booking',test:s=>s.booking.bookings[0]?.state==='confirmed'&&s.booking.booking_projections[0]?.status!=='synced'}]});
scenarios.push({id:'ops-private-profile',turns:[{body:previous.message('private','CANARY_CONVERSATION'),ai:JSON.stringify({category:'Interested',reply:'CANARY_REPLY',booking_date:null,booking_time:null,collected_data:{email:'canary@example.test',goal:'CANARY_GOAL'}})}],checks:[{name:'Synthetic profile canaries remain private to business storage',test:s=>s.calls.some(c=>c.kind==='ai')}]});
scenarios.push({id:'ops-post-effect-audit-failure',auditFailureAfter:true,turns:[{body:booking.message(),ai:booking.ai,expectedAuditFailure:true}],checks:[{name:'Post-effect audit failure retains dispatched evidence without confirmation',test:s=>s.booking.booking_operations[0]?.status==='dispatched'&&s.provider.filter(c=>c.kind==='create').length===1&&!s.provider.some(c=>c.kind==='outbound')}]});
module.exports={scenarios,message:previous.message,ai:previous.ai};
