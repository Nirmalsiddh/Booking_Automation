'use strict';
const {randomUUID}=require('node:crypto'),{AuditError}=require('../operations/events');
const OUTCOMES=Object.freeze(['transient_no_effect','permanent_no_effect','unclassified_no_effect','applied','uncertain']);
function record(store,kind,id,outcome){if(!OUTCOMES.includes(outcome)||store.db.isTransaction)throw new AuditError();try{
 const link=store.db.prepare('SELECT ref FROM ops_links WHERE kind=? AND source_key=?').get(kind,JSON.stringify([id]));if(!link)throw new AuditError();
 store.db.exec('BEGIN IMMEDIATE');store.db.prepare('INSERT INTO ops_recovery_evidence VALUES(?,?,?,?)').run(randomUUID(),link.ref,outcome,Date.now());store.db.exec('COMMIT');
 }catch{if(store.db.isTransaction)store.db.exec('ROLLBACK');throw new AuditError();}}
function classified(response,mode){return response?.rejected&&response?.noEffect?{...response,...(mode==='failed'?{retryable:true}:mode==='permanent'?{retryable:false}:{})}:response;}
function save(store,kind,context,response,type){const result=require('../booking/verify')[type](context,response);record(store,kind,context.id,result.status==='failed'?(response.retryable===true?'transient_no_effect':response.retryable===false?'permanent_no_effect':'unclassified_no_effect'):result.status==='succeeded'?'applied':'uncertain');}
function wrap(provider,store,faults,{promotion=false}={}){return new Proxy(provider,{get(target,name){const fn=target[name];if(!['project','notify'].includes(name)||typeof fn!=='function')return typeof fn==='function'?fn.bind(target):fn;return async context=>{
 const type=name==='project'?'projection':'notification',kind=name==='project'?'projection':promotion?'followup_notification':'booking_notification',field=name==='project'?'sheet':'outbound',mode=faults[field];let response;const original=target.faults?.[field];
 try{if(['permanent','unclassified'].includes(mode))target.faults[field]='failed';response=classified(await fn.call(target,context),mode);}catch(e){if(e.code==='OPS_AUDIT_FAILED')throw e;record(store,kind,context.id,'uncertain');throw e;}finally{if(target.faults)target.faults[field]=original;}
 save(store,kind,context,response,type);return response;
 };}});}
module.exports={OUTCOMES,record,classified,save,wrap};
