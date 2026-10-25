'use strict';
const crypto=require('node:crypto');
const verify=require('./verify');
class Coordinator {
 constructor(store,provider,policy){this.store=store;this.provider=provider;this.policy=policy;for(const r of policy.resources)store.resource(r.id,r.capacity);}
 async project(customer,expectedRevision){const s=this.store;const row=s.db.prepare('SELECT * FROM booking_projections WHERE customer=?').get(customer);if(expectedRevision!==undefined&&row?.revision!==expectedRevision)return 'stale';if(!row||row.status==='synced')return;
 let attempt;try{attempt=s.beginProjection(customer,row.revision);}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;return 'blocked';}
 let result;try{result=verify.projection(attempt,await s.observe('provider_sheets',['projection',attempt.id],()=>this.provider.project(attempt)));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;result={status:'uncertain'};}
 s.endProjection(attempt.id,result.status);return result.status;
 }
 async notify(booking,recipient,version){let n;try{n=this.store.beginNotification(booking,version);}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;return 'blocked';}
 const b=n.booking;const local=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:this.policy.timezone,dateStyle:'medium',timeStyle:'short'}).format(ms);
 const body=b.state==='cancelled'?`Cancellation confirmed for ${local(b.start)} (${this.policy.timezone}). Reference ${b.id}.`:`Appointment confirmed for ${local(b.start)} (${this.policy.timezone}), ${(b.end-b.start)/60000} minutes. Reference ${b.id}.`;
 const context={id:n.id,recipient,body};let result;try{result=verify.notification(context,await this.store.observe('provider_outbound',['notification',context.id],()=>this.provider.notify(context)));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;result={status:'uncertain'};}
 this.store.endNotification(n.id,result.status,result.receipt||null);return result.status;
 }
 async reportOutcome(operation,recipient){let notice;try{notice=this.store.beginOutcomeNotice(operation);}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;return 'blocked';}const body=notice.status==='uncertain'?'We could not verify your appointment request. Please contact staff before retrying.':'We could not confirm the requested appointment change. Please choose another time or contact staff.';let result;try{result=verify.notification({...notice,recipient},await this.store.observe('provider_outbound',['outcome_notice',notice.id],()=>this.provider.notify({...notice,recipient,body})));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;result={status:'uncertain'};}this.store.endNotification(notice.id,result.status,result.receipt||null);return result.status;}
 async execute(input,identity,snapshot={}){
  if(!input.authorized||!['Booking Pending','Reschedule','Cancel Booking'].includes(input.category))throw Error('NOT_AUTHORIZED');
  const s=this.store,customer=identity.channel+':'+input.Lead_Phone;
  const action={'Booking Pending':'create',Reschedule:'update','Cancel Booking':'delete'}[input.category];
  const id=crypto.createHash('sha256').update(JSON.stringify([identity.provider,identity.channel,identity.id,action])).digest('hex');
  const prior=s.operation(id);if(prior){const priorRequest=JSON.parse(prior.fingerprint);if(priorRequest[1]!==customer||prior.action!==action||(action!=='delete'&&(prior.start!==Date.parse(input.calendar_start)||prior.end!==Date.parse(input.calendar_end))))throw Error('OPERATION_ID_CONFLICT');return {outcome:prior.status,repeated:true,operation:id};}
  require('./profile').preserveProfile(s,customer,input);
  const existing=s.current(customer),booking=action==='create'?'b'+id:existing?.id;
  if(!booking) return {outcome:'failed',reason:'missing_booking'};
  if(action!=='create'&&(snapshot.id!==existing.id||snapshot.version!==existing.version))return {outcome:'failed',reason:'stale_authorization'};
  const start=Date.parse(input.calendar_start),end=Date.parse(input.calendar_end);
  if(action!=='delete'&&this.policy.validation){const slot=require('../action-authorization').authorizationRules(this.policy.validation).slot(input.booking_date,input.booking_time,Date.now());if(!slot.ok||Date.parse(slot.start)!==start||Date.parse(slot.end)!==end)return {outcome:'failed',reason:'invalid_business_slot'};}
  if(action!=='delete'&&(!Number.isFinite(start)||end-start!==this.policy.durationMinutes*60000))return {outcome:'failed',reason:'invalid_duration'};
  let op;try{op=s.prepare({id,booking,customer,resource:this.policy.defaultResource,action,start:action==='delete'?undefined:start,end:action==='delete'?undefined:end,version:action==='create'?0:snapshot.version});}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;return {outcome:'failed',reason:'reservation_conflict'};}
  const context={operation:id,booking,action,calendar:this.policy.defaultResource,eventId:action==='create'?'e'+id:existing.event,start:op.start,end:op.end};
  if(action!=='delete'){
   let available=false;try{available=await s.observe('provider_calendar',['availability',id],()=>this.provider.available(context));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;}
   if(!available){s.dispatch(id);s.settle(id,{status:'failed'});await this.reportOutcome(id,input.whapi_to);return {outcome:'failed',reason:'availability_unverified',operation:id};}
  }
  s.dispatch(id);let result;
  try{result=verify.calendar(context,await s.observe('provider_calendar',['mutation',id],()=>this.provider.mutate(context)));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;result={status:'uncertain'};}
  const b=s.settle(id,result);
  if(result.status==='succeeded'){const projection=await this.project(customer);const notification=await this.notify(b.id,input.whapi_to,b.version);return {outcome:'succeeded',booking:b,operation:id,projection,notification};}
  await this.reportOutcome(id,input.whapi_to);return {outcome:result.status,operation:id};
 }
 async reconcile(id){const op=this.store.operation(id);if(!op||!['uncertain','dispatched'].includes(op.status))return {outcome:op?.status||'missing'};
 const b=this.store.booking(op.booking);const c={operation:id,booking:b.id,action:op.action,calendar:b.resource,eventId:op.action==='create'?'e'+id:b.event,start:op.start,end:op.end};
 let verified;try{verified=verify.calendar(c,await this.store.observe('provider_calendar',['reconciliation',id],()=>this.provider.observe(c)));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;verified={status:'uncertain'};}
 // Absence by itself cannot establish that an in-flight mutation will never apply.
 if(verified.status!=='succeeded')return {outcome:'uncertain'};
 const updated=this.store.reconcile(id,verified);return {outcome:'succeeded',booking:updated};
 }
}
module.exports={Coordinator};
