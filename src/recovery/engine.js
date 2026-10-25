'use strict';
const {randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');const {UUID,AuditError}=require('../operations/events');
const {authority}=require('./isolation'),worker=require('./worker'),{migrate}=require('./migrations'),{context,plan,schedule}=require('./plan'),{digest,RecoveryError}=require('./catalog'),verify=require('../booking/verify');
class Recovery {
 constructor(file){this.config=authority(file,{operator:true});this.db=new DatabaseSync(file);this.db.exec('PRAGMA busy_timeout=1500; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');migrate(this.db);this.now=Number.isSafeInteger(this.config.now)?this.config.now:Date.now();}
 tx(fn){try{this.db.exec('BEGIN IMMEDIATE');const r=fn();this.db.exec('COMMIT');return r;}catch(e){try{if(this.db.isTransaction)this.db.exec('ROLLBACK');}catch{}if(e instanceof RecoveryError)throw e;const safe=new AuditError();safe.storageCode=Number.isInteger(e?.errcode)?e.errcode:0;safe.diagnostic=['request_claim','inbox_state','inbox_audit','outcome'].includes(this.phase)?this.phase:'journal_storage';throw safe;}}
 event(id,phase,state,reason,evidence=null){if(evidence!==null&&!UUID.test(evidence))throw new AuditError();this.db.prepare('INSERT INTO ops_recovery_events VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,phase,state,reason,evidence,this.now);}
 result(id){const r=this.db.prepare('SELECT * FROM ops_recovery_requests WHERE id=?').get(id);return {request:r.id,target:r.target_ref,action:r.action,state:r.state,reason:r.reason,observed_state:r.observed_state,operation_version:r.operation_version,booking_version:Number.isSafeInteger(r.booking_version)?r.booking_version:null,eligibility:r.eligibility,effect_ref:r.effect_ref,dry_run:false};}
 own(id){const r=this.db.prepare("SELECT * FROM ops_recovery_requests WHERE id=? AND state='running'").get(id);if(!r||r.worker!==worker.current(this.db)||!this.db.prepare('SELECT 1 FROM ops_recovery_claims WHERE request=?').get(id))throw new RecoveryError('TRUSTED_WORKER_REQUIRED');return r;}
 finish(id,state,reason,evidence){this.phase='outcome';const r=this.own(id);if(evidence===undefined)evidence=this.db.prepare('SELECT event_ref FROM ops_events WHERE entity_ref=? ORDER BY rowid DESC LIMIT 1').get(r.effect_ref||r.target_ref)?.event_ref??null;this.db.prepare('UPDATE ops_recovery_requests SET state=?,reason=?,updated=? WHERE id=?').run(state,reason,this.now,id);this.event(id,'outcome',state,reason,evidence);this.db.prepare('DELETE FROM ops_recovery_claims WHERE request=?').run(id);}
 async apply({request,target,action,snapshot}){
  if(!UUID.test(request)||!UUID.test(target)||!/^[a-f0-9]{64}$/.test(snapshot))throw new RecoveryError('STALE_PLAN');const envelope=digest([target,action,snapshot]);let c,dispatch,repeat=false;
  this.tx(()=>{
   const prior=this.db.prepare('SELECT * FROM ops_recovery_requests WHERE id=?').get(request);if(prior){if(prior.fingerprint!==envelope)throw new RecoveryError('REQUEST_CONFLICT');repeat=true;return;}
   const current=plan(this.db,{target,action},this.now);c=context(this.db,target);const who=worker.current(this.db);
   let reason=current.snapshot!==snapshot?'STALE_PLAN':current.reason;
   this.db.prepare("INSERT INTO ops_recovery_requests(id,target_ref,logical_key,action,observed_state,operation_version,booking_version,eligibility,snapshot,fingerprint,state,reason,worker,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,'running','ELIGIBLE',?,?,?)").run(request,target,c.logical,action,current.current_state,current.operation_version,current.booking_version,reason,snapshot,envelope,who,this.now,this.now);
   const locked=this.db.prepare('SELECT c.*,r.worker FROM ops_recovery_claims c JOIN ops_recovery_requests r ON r.id=c.request WHERE c.lock_key=?').get(c.logical);
   if(reason==='ELIGIBLE'&&locked){
    const stopped=this.db.prepare("SELECT 1 FROM ops_recovery_workers WHERE id=? AND status='joined'").get(locked.worker);
    if(action==='reconcile'&&stopped&&worker.joined(this.db,locked.target_ref,locked.request)===locked.worker){this.db.prepare("UPDATE ops_recovery_requests SET state='uncertain',reason='INTERRUPTED',updated=? WHERE id=?").run(this.now,locked.request);this.event(locked.request,'interrupted','uncertain','INTERRUPTED',locked.worker);this.db.prepare('DELETE FROM ops_recovery_claims WHERE lock_key=?').run(c.logical);}
    else reason='TARGET_BUSY';
   }
   if(reason!=='ELIGIBLE'){this.db.prepare("UPDATE ops_recovery_requests SET state='blocked',reason=?,eligibility=? WHERE id=?").run(reason,reason,request);this.event(request,'blocked','blocked',reason,current.evidence_ref);return;}
   this.db.prepare('INSERT INTO ops_recovery_claims VALUES(?,?,?)').run(c.logical,target,request);worker.bind(this.db,target,request);this.phase='request_claim';this.event(request,'claimed','running','ELIGIBLE',current.evidence_ref);
   const {Observer}=require('../operations/store');c.s.observer=new Observer(this.db);c.s.observer.fallbackTrace=c.event?.trace_ref||target;c.s.observer.contextParent=target;
   if(action==='inbox_pre_effect'){
    this.phase='inbox_state';this.db.prepare("UPDATE messages SET status='retryable',owner=NULL,reason='verified_stopped_pre_effect',updated_at=? WHERE provider=? AND channel=? AND message_id=? AND owner=? AND status='processing'").run(this.now,...c.key,c.row.owner);
    this.phase='inbox_audit';c.s.audit('message',c.key,'retryable','WORKER_INTERRUPTED');this.phase='outcome';this.finish(request,'succeeded','ELIGIBLE');return;
   }
   if(action.startsWith('handoff_')){c.s.updateHandoff({id:'recovery:'+request,customer:c.row.customer,state:action==='handoff_assign'?'Assigned':'Resolved',reason:'operator_recovery',actor:'isolated_operator',expectedVersion:c.row.version,sequence:c.row.sequence},this.now);this.finish(request,'succeeded','ELIGIBLE');return;}
   dispatch=this.prepare(c,action,request);
  });
  if(repeat){const prior=this.result(request);return {...prior,repeated:true,reason:prior.state==='running'?'TARGET_BUSY':prior.reason};}if(!dispatch)return this.result(request);
  // A second authorization boundary catches consent/version changes committed
  // after planning. No SQL transaction is held while the provider runs.
  try{this.tx(()=>{this.own(request);const latest=context(this.db,target);if(c.booking&&latest.booking?.version!==c.booking.version)throw new RecoveryError('BOOKING_CHANGED');if(c.contact&&latest.contact?.recipient!==c.contact.recipient)throw new RecoveryError('RECIPIENT_UNAVAILABLE');if(c.job&&action!=='reconcile'){if(latest.contact?.consent!=='granted')throw new RecoveryError('CONSENT_BLOCKED');if(schedule(latest,this.now).eligible(latest.seq))throw new RecoveryError('ELIGIBILITY_CHANGED');}});}catch(e){if(e instanceof RecoveryError){this.tx(()=>this.finish(request,'uncertain',e.code,null));return this.result(request);}throw e;}
  const {MockRecoveryProvider}=require('./mock-provider');const provider=new MockRecoveryProvider(c.s,this.config.faults);let result;
  try{if(action==='reconcile')result=await c.s.observe(dispatch.kind,['reconciliation',dispatch.id],()=>provider.observe(dispatch));
   else result=await c.s.observe(dispatch.kind,['recovery',dispatch.id],()=>provider.send(dispatch));
  }catch(e){if(e?.code==='OPS_AUDIT_FAILED')throw e;result=null;}
  this.tx(()=>{this.own(request);this.settle(c,dispatch,result,request);});return this.result(request);
 }
 prepare(c,action,request){const {s,row:r,booking:b,job,contact}=c;let d;
  if(action==='reconcile'){
   if(c.link.kind==='booking_operation')d={type:'calendar',kind:'provider_calendar',id:r.id,operation:r.id,booking:b.id,action:r.action,calendar:b.resource,eventId:r.action==='create'?'e'+r.id:b.event,start:r.start,end:r.end};
   else if(c.link.kind==='projection')d={type:'projection',kind:'provider_sheets',id:r.id,...c.projection};
   else d={type:c.link.kind==='booking_notification'?'notification':'promotion',kind:'provider_outbound',id:r.id,recipient:contact?.recipient};
  }else if(action==='projection_retry'){
   const id=randomUUID();this.db.prepare("INSERT INTO booking_projection_attempts VALUES(?,?,?,'dispatched')").run(id,r.customer,r.revision);s.audit('projection',id,'dispatched');d={...c.projection,type:'projection',kind:'provider_sheets',id};
  }else if(action==='notification_retry'&&c.link.kind==='booking_notification'){
   const notice=this.db.prepare("SELECT status FROM booking_operations WHERE id||':outcome'=? AND booking=? AND status IN ('failed','uncertain')").get(r.id,b.id);if(r.version<1&&!notice)throw new RecoveryError('UNSUPPORTED_TARGET');const policy=require('../../config/reservations.json'),local=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:policy.timezone,dateStyle:'medium',timeStyle:'short'}).format(ms);
   const body=notice?(notice.status==='uncertain'?'We could not verify your appointment request. Please contact staff before retrying.':'We could not confirm the requested appointment change. Please choose another time or contact staff.'):b.state==='cancelled'?`Cancellation confirmed for ${local(b.start)} (${policy.timezone}). Reference ${b.id}.`:`Appointment confirmed for ${local(b.start)} (${policy.timezone}), ${(b.end-b.start)/60000} minutes. Reference ${b.id}.`;
   this.db.prepare("UPDATE booking_notifications SET status='dispatched',receipt=NULL WHERE id=? AND status='failed'").run(r.id);s.audit('booking_notification',r.id,'dispatched');d={type:'notification',kind:'provider_outbound',id:r.id,recipient:contact.recipient,body};
  }else{
   const scheduler=schedule(c,this.now),owner=randomUUID();
   this.db.prepare("UPDATE outreach_jobs SET status='dispatched',owner=?,updated=? WHERE id=?").run(owner,this.now,job.id);
   if(job.kind==='handoff'){s.updateHandoff({id:'recovery:'+request,customer:c.seq.customer,state:'Requested',reason:'eligible_followup_exhausted',actor:'scheduler',expectedVersion:c.handoff?.version??0,sequence:c.seq.id},this.now);this.db.prepare("UPDATE outreach_jobs SET status='completed' WHERE id=?").run(job.id);this.db.prepare("UPDATE outreach_sequences SET status='completed' WHERE id=?").run(c.seq.id);s.audit('followup_job',job.id,'completed');this.finish(request,'succeeded','ELIGIBLE');return null;}
   this.db.prepare("INSERT INTO outreach_notifications VALUES(?,'promotional','dispatched',NULL,?,NULL) ON CONFLICT(id) DO UPDATE SET status='dispatched',receipt=NULL,started=excluded.started,finished=NULL").run(job.id,this.now);s.audit('followup_job',job.id,'dispatched');s.audit('followup_notification',job.id,'dispatched');d={type:'promotion',kind:'provider_outbound',id:job.id,recipient:contact.recipient,body:scheduler.rules.message};
  }
  const kind={calendar:'booking_operation',projection:'projection',notification:'booking_notification',promotion:'followup_notification'}[d.type];const effect=s.observer.link(kind,d.id);this.db.prepare('UPDATE ops_recovery_requests SET effect_ref=? WHERE id=?').run(effect,request);
  this.event(request,action==='reconcile'?'read':'dispatch','running','ELIGIBLE');return d;
 }
 settle(c,d,response,request){const reconcile=this.db.prepare('SELECT action FROM ops_recovery_requests WHERE id=?').get(request).action==='reconcile';let result=d.type==='calendar'?verify.calendar(d,response):d.type==='projection'?verify.projection(d,response):verify.notification(d,response);
  const transport=this.db.prepare("SELECT e.event_ref FROM ops_events e JOIN ops_links l ON l.ref=e.entity_ref WHERE e.kind=? AND json_extract(l.source_key,'$[0]')=? AND json_extract(l.source_key,'$[1]')=? ORDER BY e.rowid DESC LIMIT 1").get(d.kind,reconcile?'reconciliation':'recovery',d.id)?.event_ref??null;
  if(reconcile&&result.status!=='succeeded'){this.finish(request,'uncertain','INSUFFICIENT_EVIDENCE',transport);return;}
  const latest=context(this.db,c.link.ref);if(c.booking&&latest.booking?.version!==c.booking.version){this.finish(request,'uncertain','BOOKING_CHANGED',transport);return;}
  const s=c.s,status=result.status,error=status==='uncertain'?'EXTERNAL_OUTCOME_UNCERTAIN':status==='failed'?'PROVIDER_REJECTED_NO_EFFECT':'NONE';
  if(d.type==='calendar'){this.db.prepare("UPDATE booking_operations SET status='dispatched' WHERE id=? AND status IN ('dispatched','uncertain')").run(d.id);s.applyOutcome(d.id,result);}
  else if(d.type==='projection'){
   if(latest.projection?.revision!==d.revision){this.finish(request,'uncertain','BOOKING_CHANGED',transport);return;}
   this.db.prepare('UPDATE booking_projection_attempts SET status=? WHERE id=?').run(status,d.id);this.db.prepare('UPDATE booking_projections SET status=? WHERE customer=? AND revision=?').run(status==='succeeded'?'synced':status,d.customer,d.revision);s.audit('projection',d.id,status,error);
  }else if(d.type==='notification'){this.db.prepare('UPDATE booking_notifications SET status=?,receipt=? WHERE id=?').run(status,result.receipt??null,d.id);s.audit('booking_notification',d.id,status==='succeeded'?'accepted':status,error);}
  else{
   const outcome=status==='succeeded'?'accepted':status;this.db.prepare('UPDATE outreach_notifications SET status=?,receipt=?,finished=? WHERE id=?').run(outcome,result.receipt??null,this.now,d.id);this.db.prepare('UPDATE outreach_jobs SET status=?,updated=? WHERE id=?').run(outcome,this.now,d.id);s.audit('followup_job',d.id,outcome,error);s.audit('followup_notification',d.id,outcome,error);
   if(status==='succeeded'&&!schedule(c,this.now).eligible(c.seq)){const scheduler=schedule(c,this.now),more=c.job.attempt<scheduler.rules.maxAttempts;scheduler.addJob(c.seq.id,more?'promotion':'handoff',more?c.job.attempt+1:c.job.attempt,this.now+(more?scheduler.rules.delayMinutes:scheduler.rules.handoffDelayMinutes)*60000,this.now);}
  }
  this.finish(request,status,status==='succeeded'?'ELIGIBLE':status==='failed'?'PROVIDER_NO_EFFECT':'INSUFFICIENT_EVIDENCE');
 }
 close(){this.db.close();}
}
module.exports={Recovery};
