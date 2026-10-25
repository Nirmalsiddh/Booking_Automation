'use strict';
// A closed vocabulary prevents caller-controlled strings from becoming diagnostics.
const KINDS=Object.freeze(['ai','message','activity','inbox_operation','booking_operation','projection','booking_notification','followup_job','followup_notification','consent','handoff','provider_calendar','provider_sheets','provider_outbound','validation','execution']);
const STATUSES=Object.freeze(['received','processing','completed','retryable','uncertain','rejected','started','prepared','dispatched','succeeded','failed','pending','claimed','accepted','suppressed','cancelled','blocked','None','Requested','Assigned','Resolved','unknown','granted','revoked']);
const CODES=Object.freeze(['NONE','UNCLASSIFIED','AUTH_REJECTED','INPUT_REJECTED','IDENTIFIER_CONFLICT','PROVIDER_REJECTED_NO_EFFECT','PROVIDER_READ_FAILED','EXTERNAL_OUTCOME_UNCERTAIN','VALIDATION_REJECTED','STATE_CONFLICT','STALE_STATE','BUSINESS_RULE_BLOCKED','NEW_ACTIVITY','CONSENT_BLOCKED','SENDING_HOURS','WORKER_INTERRUPTED','AUDIT_UNAVAILABLE','STORAGE_BUSY','STORAGE_CONSTRAINT','LOOKUP_FAILED']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
class AuditError extends Error {constructor(){super('OPS_AUDIT_FAILED');this.code='OPS_AUDIT_FAILED';}}
function code(error){const key=typeof error==='string'?error:error?.code;return CODES.includes(key)?key:key==='SQLITE_BUSY'||error?.errcode===5?'STORAGE_BUSY':error?.errcode===19?'STORAGE_CONSTRAINT':'UNCLASSIFIED';}
function validate(event){
 const allowed=['kind','status','code','trace_ref','entity_ref','attempt_ref','parent_ref','at','duration_ms'];
 if(!event||Object.keys(event).some(k=>!allowed.includes(k))||!KINDS.includes(event.kind)||!STATUSES.includes(event.status)||!CODES.includes(event.code)||!UUID.test(event.trace_ref)||!UUID.test(event.entity_ref)||(event.attempt_ref!==null&&!UUID.test(event.attempt_ref))||(event.parent_ref!==null&&!UUID.test(event.parent_ref))||!Number.isSafeInteger(event.at)||event.at<0||(event.duration_ms!==null&&(!Number.isFinite(event.duration_ms)||event.duration_ms<0)))throw new AuditError();
 return event;
}
const denyBuckets=new Map();
function ingressDiagnostic(value){const safe=['AUTH_REJECTED','INPUT_REJECTED','IDENTIFIER_CONFLICT'].includes(value)?value:'INPUT_REJECTED';const now=Date.now(),last=denyBuckets.get(safe)||0;if(now-last<60000)return;denyBuckets.set(safe,now);process.stderr.write(JSON.stringify({kind:'ingress',code:safe,at:now})+'\n');}
module.exports={KINDS,STATUSES,CODES,UUID,AuditError,code,validate,ingressDiagnostic};
