'use strict';
const {randomUUID}=require('node:crypto');const {performance}=require('node:perf_hooks');const E=require('./events');const {migrate}=require('./migrations');
// Timers are keyed by persisted opaque attempt IDs, never by a global current customer.
const timers=new Map();const START=new Set(['received','processing','started','prepared','dispatched','claimed']);const END=new Set(['completed','succeeded','failed','uncertain','accepted','rejected','cancelled','suppressed','retryable']);
class Observer {
 constructor(db,{message=null,clock=Date.now,monotonic=()=>performance.now()}={}){try{migrate(db);}catch{throw new E.AuditError();}this.db=db;this.message=message;this.clock=clock;this.monotonic=monotonic;this.fallbackTrace=null;this.contextParent=null;}
 now(){const n=this.clock();if(!Number.isSafeInteger(n)||n<0)throw new E.AuditError();return n;}
 link(kind,key){if(!this.db.isTransaction||!E.KINDS.includes(kind))throw new E.AuditError();const parts=Array.isArray(key)?key:[key];if(!parts.length||parts.some(x=>typeof x!=='string'||!x.length||x.length>200||/[\x00-\x1f\x7f]/.test(x)))throw new E.AuditError();const source=JSON.stringify(parts);if(typeof source!=='string'||source.length>1024)throw new E.AuditError();const old=this.db.prepare('SELECT ref FROM ops_links WHERE kind=? AND source_key=?').get(kind,source);if(old)return old.ref;const ref=randomUUID();this.db.prepare('INSERT INTO ops_links VALUES(?,?,?,?)').run(ref,kind,source,this.now());return ref;}
 transition(kind,key,status,error='NONE'){
  try{
   if(!this.db.isTransaction||!E.KINDS.includes(kind)||!E.STATUSES.includes(status))throw new E.AuditError();
   const entity=this.link(kind,key),parts=Array.isArray(key)?key:[key];let related=null;
   const lookup=(k,v)=>this.db.prepare('SELECT l.ref,e.trace_ref FROM ops_links l JOIN ops_events e ON e.entity_ref=l.ref WHERE l.kind=? AND l.source_key=? ORDER BY e.rowid LIMIT 1').get(k,JSON.stringify([v]));
   if(kind==='followup_notification')related=lookup('followup_job',parts[0]);
   if(kind==='provider_calendar')related=lookup('booking_operation',parts[1]);
   if(kind==='provider_sheets')related=lookup('projection',parts[1]);
   if(kind==='provider_outbound')related=lookup(parts[0]==='promotion'?'followup_job':'booking_notification',parts[1]);
   const first=this.db.prepare('SELECT trace_ref FROM ops_events WHERE entity_ref=? ORDER BY rowid LIMIT 1').get(entity);
   const messageTrace=this.message?this.link('message',[this.message.provider,this.message.channel,this.message.id]):null;
   const trace=messageTrace||related?.trace_ref||first?.trace_ref||this.fallbackTrace||(kind==='message'?entity:this.link('execution',['detached',entity]));
   const parent=related?.ref||(kind==='message'?null:messageTrace||this.contextParent||trace);
   if(kind==='followup_job'){this.fallbackTrace=trace;this.contextParent=entity;}

   const safeCode=E.code(error),now=this.now();let attempt=this.db.prepare('SELECT * FROM ops_attempts WHERE entity_ref=? AND finished_at IS NULL').get(entity),duration=null;
   if(!attempt&&START.has(status)){attempt={ref:randomUUID(),entity_ref:entity,trace_ref:trace};this.db.prepare('INSERT INTO ops_attempts(ref,trace_ref,entity_ref,status,code,started_at) VALUES(?,?,?,?,?,?)').run(attempt.ref,trace,entity,status,safeCode,now);if(timers.size>=10000)timers.delete(timers.keys().next().value);timers.set(attempt.ref,this.monotonic());}
   if(attempt&&status!=='blocked'){const t=timers.get(attempt.ref);if(END.has(status)&&t!==undefined){duration=Math.max(0,this.monotonic()-t);timers.delete(attempt.ref);}this.db.prepare('UPDATE ops_attempts SET status=?,code=?,finished_at=?,duration_ms=? WHERE ref=?').run(status,safeCode,END.has(status)?now:null,duration,attempt.ref);}
   const event=E.validate({kind,status,code:safeCode,trace_ref:trace,entity_ref:entity,attempt_ref:attempt?.ref??null,parent_ref:parent,at:now,duration_ms:duration});
   this.db.prepare('INSERT INTO ops_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),event.trace_ref,event.entity_ref,event.attempt_ref,event.parent_ref,kind,status,safeCode,now,duration);return entity;
  }catch{throw new E.AuditError();}
 }
 tx(fn){if(this.db.isTransaction)throw new E.AuditError();try{this.db.exec('BEGIN IMMEDIATE');const r=fn();this.db.exec('COMMIT');return r;}catch{try{if(this.db.isTransaction)this.db.exec('ROLLBACK');}catch{}throw new E.AuditError();}}
 async run(kind,key,fn){const attemptKey=[...key,randomUUID()];this.tx(()=>this.transition(kind,attemptKey,'started'));if(this.db.isTransaction)throw new E.AuditError();let result;
  try{result=await fn();}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;const read=['availability','reconciliation','readback'].includes(key[0]);this.tx(()=>this.transition(kind,attemptKey,read?'failed':'uncertain',read?'PROVIDER_READ_FAILED':'EXTERNAL_OUTCOME_UNCERTAIN'));throw error;}
  const rejected=result?.rejected===true&&result?.noEffect===true;this.tx(()=>this.transition(kind,attemptKey,rejected?'failed':result===false?'failed':'completed',rejected?'PROVIDER_REJECTED_NO_EFFECT':result===false?'PROVIDER_READ_FAILED':'NONE'));return result;
 }
}
module.exports={Observer};
