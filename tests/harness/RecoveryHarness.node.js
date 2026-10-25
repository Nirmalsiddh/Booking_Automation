'use strict';
const fs=require('node:fs'),{createHash}=require('node:crypto');
const uuid=value=>{const h=createHash('sha256').update(value).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
class RecoveryHarness {
 constructor(){this.description={displayName:'Isolated operator recovery test',name:'recoveryHarness',group:['transform'],version:1,defaults:{name:'Operator - Recovery'},inputs:['main'],outputs:['main'],properties:[]};}
 async execute(){const stateFile=process.env.HARNESS_STATE_PATH,state=JSON.parse(fs.readFileSync(stateFile)),t=state.current,r=t.recovery||{},file=t.database;
  const {OutreachStore}=require('../outreach/store'),{Observer}=require('../operations/store'),s=new OutreachStore(file);s.observer=new Observer(s.db);
  if(r.control==='interrupt_followup'||r.control==='unverified_claim'){
   const {Scheduler}=require('../outreach/scheduler'),scheduler=new Scheduler(s,{},JSON.parse(s.db.prepare('SELECT payload FROM outreach_rules ORDER BY version DESC LIMIT 1').get().payload),()=>state.clock);
   const saved=process.env.BOOKING_RECOVERY_WORKER;if(r.control==='unverified_claim')delete process.env.BOOKING_RECOVERY_WORKER;const job=scheduler.claim();if(saved)process.env.BOOKING_RECOVERY_WORKER=saved;s.close();if(!job)throw Error('NO_DUE_JOB');if(r.control==='interrupt_followup')process.kill(process.pid,'SIGKILL');return [[{json:{control:'claimed_without_trusted_binding'}}]];
  }
  s.close();
  const {Reader}=require('../operations/reader');const reader=new Reader(file);let target;
  try{target=r.useEffect?state.lastRecovery?.effect_ref:r.targetSaved?state.recoveryTarget:reader.list({kind:r.kind||'projection',state:r.targetState||undefined}).at(-1)?.ref;}finally{reader.close();}
  if(!target)throw Error('RECOVERY_TARGET_MISSING');state.recoveryTarget=target;
  const base=['--db',file,'--target',target,'--action',r.action||'projection_retry'];let stdout='',stderr='';const capture={write:x=>{stdout+=x;return true;}},errors={write:x=>{stderr+=x;return true;}};
  const cli=require('../operations/recovery-cli');let exit=await cli.main(['plan',...base],capture,errors),planned;try{planned=JSON.parse(stdout);}catch{throw Error('RECOVERY_PLAN_FAILED');}
  state.recoveryPlans=state.recoveryPlans||{};if(r.savePlan)state.recoveryPlans[r.savePlan]=planned;
  if(r.planOnly){fs.writeFileSync(stateFile,JSON.stringify(state));return [[{json:{...planned,_cliExit:exit}}]];}
  if(r.savedPlan)planned=state.recoveryPlans[r.savedPlan];
  state.recoveryRequests=state.recoveryRequests||{};const label=r.request||String(state.turn);let args={request:uuid(file+':'+label),target:planned.target,action:planned.action,snapshot:planned.snapshot};
  if(r.reuse)args=state.recoveryRequests[label];if(r.conflict)args={...args,snapshot:'0'.repeat(64)};state.recoveryRequests[label]=args;
  const command=['apply','--db',file,'--target',args.target,'--action',args.action,'--request-id',args.request,'--snapshot',args.snapshot,...(r.dryRun?[]:['--execute'])];stdout='';stderr='';exit=await cli.main(command,capture,errors);
  const result=JSON.parse(stdout||stderr);
  const accounting=new Reader(file);try{const p=require('../recovery/plan').plan(accounting.db,{target:args.target,action:args.action},state.clock);state.recoveryAccounting=[...(state.recoveryAccounting||[]),{attempts:p.transport_attempts,reason:p.reason}];}finally{accounting.close();}
  state.lastRecovery=result;state.recoveryResults=[...(state.recoveryResults||[]),result];fs.writeFileSync(stateFile,JSON.stringify(state));
  if(result.error==='AUDIT_UNAVAILABLE'){const dir='/data/evidence/'+require('path').basename(file).slice(8,-7);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/recovery-diagnostic.json',JSON.stringify(result));}if(result.error==='AUDIT_UNAVAILABLE')throw Error('OPS_AUDIT_FAILED');
  return [[{json:{...result,_cliExit:exit}}]];
 }
}
module.exports={RecoveryHarness};
