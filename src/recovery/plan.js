'use strict';
const {ACTIONS,digest,RecoveryError}=require('./catalog'),{UUID}=require('../operations/events');const worker=require('./worker');
const has=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
function context(db,ref){if(!UUID.test(ref))throw new RecoveryError('TARGET_MISSING');const link=db.prepare('SELECT * FROM ops_links WHERE ref=?').get(ref);if(!link)throw new RecoveryError('TARGET_MISSING');const key=JSON.parse(link.source_key);const spec={message:['messages','provider=? AND channel=? AND message_id=?'],booking_operation:['booking_operations','id=?'],projection:['booking_projection_attempts','id=?'],booking_notification:['booking_notifications','id=?'],followup_job:['outreach_jobs','id=?'],followup_notification:['outreach_notifications','id=?'],handoff:['outreach_handoffs','customer=?']}[link.kind];if(!spec||!has(db,spec[0]))throw new RecoveryError('UNSUPPORTED_TARGET');const row=db.prepare('SELECT * FROM '+spec[0]+' WHERE '+spec[1]).get(...key);if(!row)throw new RecoveryError('TARGET_MISSING');
 const {OutreachStore}=require('../outreach/store'),s=Object.create(OutreachStore.prototype);s.db=db;
 let booking=null,projection=null,job=null,seq=null,contact=null,handoff=null;
 if(link.kind==='booking_operation'||link.kind==='booking_notification')booking=s.booking(row.booking);
 if(link.kind==='projection'){projection=db.prepare('SELECT * FROM booking_projections WHERE customer=?').get(row.customer);booking=s.current(row.customer);}
 if(['followup_job','followup_notification'].includes(link.kind)){job=db.prepare('SELECT * FROM outreach_jobs WHERE id=?').get(key[0]);seq=job?db.prepare('SELECT * FROM outreach_sequences WHERE id=?').get(job.sequence):null;booking=seq?s.current(seq.customer):null;}
 const notice=link.kind==='booking_notification'?db.prepare("SELECT status FROM booking_operations WHERE id||':outcome'=? AND booking=? AND status IN ('failed','uncertain')").get(row.id,row.booking):null;
 const latestBooking=booking?s.current(booking.customer):null;
 const customer=booking?.customer||seq?.customer||(link.kind==='handoff'?row.customer:null);
 if(customer){contact=s.contact(customer);handoff=s.handoff(customer);}
 const event=db.prepare('SELECT * FROM ops_events WHERE entity_ref=? ORDER BY rowid DESC LIMIT 1').get(ref);
 let sourceMessage=null,messageRef=null;
 if(link.kind==='message'){sourceMessage=row;messageRef=ref;}else if(event){const m=db.prepare("SELECT * FROM ops_links WHERE ref=? AND kind='message'").get(event.trace_ref);if(m){messageRef=m.ref;sourceMessage=db.prepare('SELECT * FROM messages WHERE provider=? AND channel=? AND message_id=?').get(...JSON.parse(m.source_key));}}
 const runningRecovery=has(db,'ops_recovery_requests')?db.prepare("SELECT * FROM ops_recovery_requests WHERE effect_ref=? AND state='running'").get(ref):null;
 const termination=runningRecovery?db.prepare("SELECT id FROM ops_recovery_workers WHERE id=? AND status='joined'").get(runningRecovery.worker)?.id:sourceMessage?.status==='processing'&&has(db,'ops_recovery_workers')?worker.joined(db,messageRef,sourceMessage.owner):null;
 const oldOwnerActive=runningRecovery?!termination:sourceMessage?.status==='processing'&&!termination;
 const proof=db.prepare("SELECT event_ref,at FROM ops_events WHERE entity_ref=? AND status='failed' AND code='PROVIDER_REJECTED_NO_EFFECT' ORDER BY rowid DESC LIMIT 1").get(ref);
 const retryEvidence=has(db,'ops_recovery_evidence')?db.prepare('SELECT id,outcome,at FROM ops_recovery_evidence WHERE entity_ref=? ORDER BY rowid DESC LIMIT 1').get(ref):null;
 const notifications=link.kind==='followup_job'?db.prepare('SELECT * FROM outreach_notifications WHERE id=?').get(row.id):null;
 let count=link.kind==='booking_operation'?1:0,last=proof?.at??event?.at??0;
 if(link.kind==='projection')count=db.prepare('SELECT count(*) n FROM booking_projection_attempts WHERE customer=? AND revision=?').get(row.customer,row.revision).n;
 else if(['booking_notification','followup_notification','followup_job'].includes(link.kind))count=(link.kind==='followup_job'&&!notifications?0:1)+(has(db,'ops_recovery_events')?db.prepare("SELECT count(*) n,max(e.at) last FROM ops_recovery_events e JOIN ops_recovery_requests r ON r.id=e.request WHERE r.target_ref=? AND e.phase='dispatch'").get(ref).n:0);
 if(has(db,'ops_recovery_events'))last=Math.max(last,db.prepare("SELECT coalesce(max(e.at),0) at FROM ops_recovery_events e JOIN ops_recovery_requests r ON r.id=e.request WHERE r.target_ref=? AND e.phase='dispatch'").get(ref).at);
 const logical=digest([['followup_job','followup_notification'].includes(link.kind)?'followup':link.kind,link.kind==='projection'?[row.customer,row.revision]:key]);
 if(has(db,'ops_recovery_events')){const history=db.prepare("SELECT count(*) n,coalesce(max(e.at),0) last FROM ops_recovery_events e JOIN ops_recovery_requests r ON r.id=e.request WHERE r.logical_key=? AND e.phase IN ('dispatch','read')").get(logical);last=Math.max(last,history.last);if(link.kind==='projection'){const reads=db.prepare("SELECT count(*) n FROM ops_recovery_events e JOIN ops_recovery_requests r ON r.id=e.request WHERE r.logical_key=? AND e.phase='read'").get(logical).n;count+=reads;}else if(['booking_operation','booking_notification','followup_notification','followup_job'].includes(link.kind)){
   // A continuation can create the first notification. Its journal dispatch is
   // already the initial attempt, shared by both job and notification aliases.
   const followup=['followup_job','followup_notification'].includes(link.kind);
   const recoveryOrigin=followup&&db.prepare("SELECT 1 FROM ops_recovery_events e JOIN ops_recovery_requests r ON r.id=e.request WHERE r.logical_key=? AND r.action='followup_continue' AND e.phase='dispatch' LIMIT 1").get(logical);
   count=(recoveryOrigin||link.kind==='followup_job'&&!notifications?0:1)+history.n;
  }}
 const activeRules=has(db,'outreach_rules')?db.prepare('SELECT version,payload FROM outreach_rules ORDER BY version DESC LIMIT 1').get():null;
 const policy=require('../../config/recovery.json');if(policy.version!==1||policy.maxTransportAttempts!==3||policy.automaticWorker!==false||policy.mode!=='isolated-mock-only'||!Array.isArray(policy.backoffMs)||policy.backoffMs.length!==2||policy.backoffMs.some(n=>!Number.isSafeInteger(n)||n<0))throw new RecoveryError('RECOVERY_FAILED');
 const retryAt=count?last+policy.backoffMs[Math.min(count-1,1)]:0;
 return {retryEvidence,activeRules,latestBooking,notice,logical,s,link,key,row,booking,projection,job,seq,contact,handoff,event,sourceMessage,messageRef,oldOwnerActive,termination,proof,count,retryAt,runningRecovery,policy};
}
function eligibility(c,action,now){const {link:l,row:r,booking:b,job,seq,s,contact,projection:p}=c;
 if(c.booking&&c.latestBooking?.id!==c.booking.id)return 'BOOKING_CHANGED';
 if(c.oldOwnerActive)return 'OWNERSHIP_UNVERIFIED';
 if(action==='inbox_pre_effect'){
  if(l.kind!=='message')return 'UNSUPPORTED_TARGET';if(r.status!=='processing')return 'ALREADY_COMPLETE';if(!c.termination)return 'OWNERSHIP_UNVERIFIED';if(s.db.prepare('SELECT count(*) n FROM operations WHERE provider=? AND channel=? AND message_id=?').get(...c.key).n)return 'OUTCOME_UNCERTAIN';return r.attempts>=3?'ATTEMPT_LIMIT':'ELIGIBLE';
 }
 if(action==='reconcile'){
  if(!['booking_operation','projection','booking_notification','followup_notification'].includes(l.kind))return 'UNSUPPORTED_TARGET';
  if(!['uncertain','dispatched'].includes(r.status))return 'ALREADY_COMPLETE';
  if(l.kind==='booking_operation'&&b?.version!==JSON.parse(r.fingerprint)[6])return 'BOOKING_CHANGED';
  if(l.kind==='projection'&&p?.revision!==r.revision)return 'BOOKING_CHANGED';
  if(l.kind==='booking_notification'&&(!b||b.version!==r.version))return 'BOOKING_CHANGED';
  return c.count>=3?'ATTEMPT_LIMIT':now<c.retryAt?'BACKOFF':'ELIGIBLE';
 }
 if(['projection_retry','notification_retry','followup_continue'].includes(action)&&c.count>=3)return 'ATTEMPT_LIMIT';
 if(action==='projection_retry'){
  if(l.kind!=='projection')return 'UNSUPPORTED_TARGET';if(r.status!=='failed')return ['uncertain','dispatched'].includes(r.status)?'OUTCOME_UNCERTAIN':'ALREADY_COMPLETE';if(!c.proof)return 'NO_EFFECT_NOT_PROVEN';if(c.retryEvidence?.outcome!=='transient_no_effect')return c.retryEvidence?.outcome==='permanent_no_effect'?'PERMANENT_FAILURE':'RETRYABILITY_UNVERIFIED';if(p?.revision!==r.revision||p.status==='synced'||!b||!['confirmed','cancelled'].includes(b.state))return 'BOOKING_CHANGED';
  if(s.db.prepare("SELECT 1 FROM booking_projection_attempts WHERE customer=? AND status IN ('dispatched','uncertain')").get(r.customer))return 'OUTCOME_UNCERTAIN';
 }else if(action==='notification_retry'){
  if(!['booking_notification','followup_notification'].includes(l.kind))return 'UNSUPPORTED_TARGET';if(r.status!=='failed')return ['uncertain','dispatched'].includes(r.status)?'OUTCOME_UNCERTAIN':'ALREADY_COMPLETE';if(!c.proof)return 'NO_EFFECT_NOT_PROVEN';if(c.retryEvidence?.outcome!=='transient_no_effect')return c.retryEvidence?.outcome==='permanent_no_effect'?'PERMANENT_FAILURE':'RETRYABILITY_UNVERIFIED';if(!contact?.recipient)return 'RECIPIENT_UNAVAILABLE';
  if(l.kind==='booking_notification'&&(!b||b.version!==r.version||!['confirmed','cancelled'].includes(b.state)&&!c.notice))return 'BOOKING_CHANGED';
 }else if(action==='followup_continue'){
  if(l.kind!=='followup_job')return 'UNSUPPORTED_TARGET';if(!['pending','claimed'].includes(r.status))return ['uncertain','dispatched'].includes(r.status)?'OUTCOME_UNCERTAIN':'ALREADY_COMPLETE';
  if(r.status==='claimed'&&(!has(s.db,'ops_recovery_workers')||!worker.joined(s.db,l.ref,r.owner)))return 'OWNERSHIP_UNVERIFIED';
  if(r.due>now)return 'BACKOFF';
 }else if(action==='handoff_assign'||action==='handoff_resolve'){
  if(l.kind!=='handoff')return 'UNSUPPORTED_TARGET';return (action==='handoff_assign'?r.state==='Requested':['Requested','Assigned'].includes(r.state))?'ELIGIBLE':'PERMITTED_TRANSITION_REQUIRED';
 }else return 'UNSUPPORTED_TARGET';
 if(job){if(contact?.consent!=='granted')return 'CONSENT_BLOCKED';const scheduler=schedule(c,now);if(scheduler.eligible(seq))return 'ELIGIBILITY_CHANGED';if(job.attempt>scheduler.rules.maxAttempts)return 'ATTEMPT_LIMIT';if(!scheduler.permitted(now))return 'ELIGIBILITY_CHANGED';}
 if(c.count>=3)return 'ATTEMPT_LIMIT';if(now<c.retryAt)return 'BACKOFF';return 'ELIGIBLE';
}
function schedule(c,now){const {Scheduler,validateRules}=require('../outreach/scheduler'),scheduler=Object.create(Scheduler.prototype);const rule=c.s.db.prepare('SELECT payload FROM outreach_rules ORDER BY version DESC LIMIT 1').get();if(!rule)throw new RecoveryError('ELIGIBILITY_CHANGED');scheduler.s=c.s;scheduler.rules=validateRules(JSON.parse(rule.payload));scheduler.clock=()=>now;return scheduler;}
function plan(db,{target,action},now=Date.now()){
 if(has(db,'ops_recovery_migrations')&&db.prepare('SELECT max(version) v FROM ops_recovery_migrations').get().v!==1)throw new RecoveryError('SCHEMA_UNAVAILABLE');
 if(!ACTIONS.includes(action))throw new RecoveryError('UNSUPPORTED_TARGET');if(!has(db,'ops_links'))throw new RecoveryError('SCHEMA_UNAVAILABLE');const c=context(db,target),reason=eligibility(c,action,now);
 const history=has(db,'ops_recovery_requests')?db.prepare('SELECT id,action,observed_state,operation_version,booking_version,eligibility,state,reason,effect_ref,created,updated FROM ops_recovery_requests WHERE logical_key=? ORDER BY rowid DESC LIMIT 20').all(c.logical).map(r=>({...r,attempts:db.prepare('SELECT phase,state,reason,evidence_ref,at FROM ops_recovery_events WHERE request=? ORDER BY rowid LIMIT 20').all(r.id)})):[];
 const snapshot=digest([target,action,c.row,c.booking,c.latestBooking,c.notice,c.projection,c.job,c.seq,c.contact,c.handoff,c.sourceMessage,c.termination,c.proof,c.retryEvidence,c.count,c.retryAt,c.runningRecovery,c.activeRules,c.policy,require('../../config/reservations.json')]);
 return {target,action,snapshot,current_state:require('../operations/events').STATUSES.includes(c.row.status||c.row.state)?c.row.status||c.row.state:'unknown',operation_version:[c.row.version,c.row.revision,c.row.attempts,c.job?.attempt,c.booking?.version].find(n=>Number.isSafeInteger(n)&&n>=0)??null,booking_version:Number.isSafeInteger(c.booking?.version)?c.booking.version:null,eligible:reason==='ELIGIBLE',reason,evidence_ref:c.retryEvidence?.id??c.proof?.event_ref??c.termination??null,recovery_history:history,transport_attempts:c.count,retry_after:c.retryAt||null,dry_run:true};
}
module.exports={context,plan,schedule,has};
