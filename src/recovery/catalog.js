'use strict';
const {createHash}=require('node:crypto');
const ACTIONS=Object.freeze(['inbox_pre_effect','reconcile','projection_retry','notification_retry','followup_continue','handoff_assign','handoff_resolve']);
const STATES=Object.freeze(['running','succeeded','blocked','uncertain','failed']);
const REASONS=Object.freeze(['INVALID_ARGUMENT','ELIGIBLE','TARGET_MISSING','UNSUPPORTED_TARGET','SCHEMA_UNAVAILABLE','ALREADY_COMPLETE','NO_EFFECT_NOT_PROVEN','PERMANENT_FAILURE','RETRYABILITY_UNVERIFIED','OUTCOME_UNCERTAIN','OWNERSHIP_UNVERIFIED','ACTIVE_WORKER','STALE_PLAN','BOOKING_CHANGED','CONSENT_BLOCKED','ELIGIBILITY_CHANGED','BACKOFF','ATTEMPT_LIMIT','RECIPIENT_UNAVAILABLE','TARGET_BUSY','REQUEST_CONFLICT','AUTHORIZATION_REQUIRED','ISOLATION_UNVERIFIED','TRUSTED_WORKER_REQUIRED','INSUFFICIENT_EVIDENCE','PROVIDER_NO_EFFECT','AUDIT_UNAVAILABLE','RECOVERY_FAILED','INTERRUPTED','PERMITTED_TRANSITION_REQUIRED']);
class RecoveryError extends Error{constructor(code){super(REASONS.includes(code)?code:'RECOVERY_FAILED');this.code=this.message;}}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
module.exports={ACTIONS,STATES,REASONS,RecoveryError,digest};
