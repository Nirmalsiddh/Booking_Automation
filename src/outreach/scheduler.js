'use strict';
const {hash,randomUUID}=require('./store');
const {notification}=require('../booking/verify');
function validateRules(r){
 const hm=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
 if(!r||!Number.isInteger(r.version)||r.version<1||!Number.isInteger(r.delayMinutes)||r.delayMinutes<1||!Number.isInteger(r.maxAttempts)||r.maxAttempts<1||r.maxAttempts>10||!Number.isInteger(r.handoffDelayMinutes)||r.handoffDelayMinutes<1||!hm(r.sendingHours?.start)||!hm(r.sendingHours?.end)||r.sendingHours.start>=r.sendingHours.end||r.requireExplicitOptIn!==true||r.suppressOptOut!==true||!Array.isArray(r.allowedWeekdays)||!r.allowedWeekdays.length||r.allowedWeekdays.some(x=>!Number.isInteger(x)||x<0||x>6)||!Array.isArray(r.eligibleEngagement)||!r.eligibleEngagement.length||r.eligibleEngagement.some(x=>!['Interested','Needs Info'].includes(x))||typeof r.message!=='string'||!r.message.length||r.message.length>2000||typeof r.grantCommand!=='string'||!r.grantCommand.length||!Array.isArray(r.revokeCommands)||!r.revokeCommands.length||r.revokeCommands.some(x=>typeof x!=='string'||!x.length)||r.revokeCommands.includes(r.grantCommand))throw Error('INVALID_FOLLOWUP_RULES');
 try{new Intl.DateTimeFormat('en',{timeZone:r.timezone}).format(0);}catch{throw Error('INVALID_BUSINESS_TIMEZONE');}return structuredClone(r);
}
class Scheduler {
 constructor(store,provider,rules,clock=Date.now){this.s=store;this.provider=provider;this.rules=validateRules(rules);this.clock=clock;
  store.tx(()=>{store.db.exec('CREATE TABLE IF NOT EXISTS outreach_rules(version INTEGER PRIMARY KEY,payload TEXT NOT NULL)');const payload=JSON.stringify(this.rules),p=store.db.prepare('SELECT payload FROM outreach_rules WHERE version=?').get(rules.version);if(p&&p.payload!==payload)throw Error('RULE_VERSION_REUSED');store.db.prepare('INSERT OR IGNORE INTO outreach_rules VALUES(?,?)').run(rules.version,payload);});
 }
 now(){const n=this.clock();if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_CLOCK');return n;}
 inbound(input){const now=this.now(),text=input.text.trim().toUpperCase();let status;
  if(text===this.rules.grantCommand)status='granted';if(this.rules.revokeCommands.includes(text))status='revoked';
  return this.s.inbound(input,now,status);
 }
 eligible(sequence){const c=this.s.contact(sequence.customer);if(!c)return 'unknown_customer';if(c.consent!=='granted')return 'consent_'+c.consent;
  if(c.declined)return 'declined';if(c.generation!==sequence.generation)return 'new_inbound';if(sequence.status!=='active')return 'superseded';if(sequence.rule_version!==this.rules.version)return 'rules_changed';if(!this.rules.eligibleEngagement.includes(c.engagement))return 'engagement';
  if(this.s.snapshotBooking(c.customer)!==sequence.booking_snapshot)return 'booking_changed';const b=this.s.current(c.customer);if(b&&b.state!=='cancelled')return 'booking_'+b.state;
  const h=this.s.handoff(c.customer);if(h&&h.state!=='None')return 'handoff_'+h.state;
  return null;
 }
 schedule(customer,generation){const now=this.now();return this.s.tx(()=>{
  const c=this.s.contact(customer);if(!c||c.generation!==generation)return {outcome:'stale'};
  const prior=this.s.db.prepare('SELECT * FROM outreach_sequences WHERE customer=? AND generation=?').get(customer,generation);if(prior)return {outcome:'duplicate',sequence:prior.id};
  const seq={id:hash(['outreach',customer,generation]),customer,generation,rule_version:this.rules.version,booking_snapshot:this.s.snapshotBooking(customer),status:'active'};
  const reason=this.eligible(seq);if(reason)return {outcome:'suppressed',reason};
  this.s.db.prepare('INSERT INTO outreach_sequences VALUES(?,?,?,?,?,?,?)').run(seq.id,customer,generation,seq.rule_version,seq.booking_snapshot,'active',now);
  const id=this.addJob(seq.id,'promotion',1,now+this.rules.delayMinutes*60000,now);return {outcome:'scheduled',sequence:seq.id,id};
 });}
 addJob(sequence,kind,attempt,due,now){const id=hash([sequence,kind,attempt]);this.s.db.prepare("INSERT OR IGNORE INTO outreach_jobs(id,sequence,kind,attempt,due,status,created,updated) VALUES(?,?,?,?,?,'pending',?,?)").run(id,sequence,kind,attempt,due,now,now);this.s.audit('followup_job',id,'pending');return id;}
 claim(){const now=this.now();return this.s.tx(()=>{const job=this.s.db.prepare("SELECT * FROM outreach_jobs WHERE status='pending' AND due<=? ORDER BY due,id LIMIT 1").get(now);if(!job)return null;const owner=randomUUID();this.s.db.prepare("UPDATE outreach_jobs SET status='claimed',owner=?,updated=? WHERE id=? AND status='pending'").run(owner,now,job.id);this.s.audit('followup_job',job.id,'claimed');if(this.s.observer&&process.env.BOOKING_RECOVERY_WORKER)require('../recovery/worker').bind(this.s.db,this.s.observer.link('followup_job',job.id),owner);return {...job,status:'claimed',owner};});}
 permitted(now){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:this.rules.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));return this.rules.allowedWeekdays.includes(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday))&&`${p.hour}:${p.minute}`>=this.rules.sendingHours.start&&`${p.hour}:${p.minute}`<this.rules.sendingHours.end;}
 nextOpening(now){let n=Math.floor(now/60000)*60000+60000;for(let i=0;i<8*1440;i++,n+=60000)if(this.permitted(n))return n;throw Error('NO_ALLOWED_SENDING_TIME');}
 authorize(job){const now=this.now();return this.s.tx(()=>{
  const current=this.s.db.prepare('SELECT * FROM outreach_jobs WHERE id=?').get(job.id);if(current?.status!=='claimed'||current.owner!==job.owner)return {outcome:'not_owned'};
  const seq=this.s.db.prepare('SELECT * FROM outreach_sequences WHERE id=?').get(current.sequence),reason=this.eligible(seq);
  if(reason){this.s.db.prepare("UPDATE outreach_jobs SET status='suppressed',reason=?,updated=? WHERE id=?").run(reason,now,job.id);this.s.audit('followup_job',job.id,'suppressed','BUSINESS_RULE_BLOCKED');return {outcome:'suppressed',reason};}
  if(current.kind==='handoff'){
   const h=this.s.handoff(seq.customer);this.s.updateHandoff({id:'job:'+job.id,customer:seq.customer,state:'Requested',reason:'eligible_followup_exhausted',actor:'scheduler',expectedVersion:h?.version??0,sequence:seq.id},now);
   this.s.db.prepare("UPDATE outreach_jobs SET status='completed',updated=? WHERE id=?").run(now,job.id);this.s.db.prepare("UPDATE outreach_sequences SET status='completed' WHERE id=?").run(seq.id);this.s.audit('followup_job',job.id,'completed');return {outcome:'handoff_requested'};
  }
  if(current.attempt>this.rules.maxAttempts){this.s.db.prepare("UPDATE outreach_jobs SET status='suppressed',reason='max_attempts',updated=? WHERE id=?").run(now,job.id);this.s.audit('followup_job',job.id,'suppressed','BUSINESS_RULE_BLOCKED');return {outcome:'suppressed',reason:'max_attempts'};}
  if(!this.permitted(now)){this.s.db.prepare("UPDATE outreach_jobs SET status='pending',owner=NULL,due=?,reason='sending_hours',updated=? WHERE id=?").run(this.nextOpening(now),now,job.id);this.s.audit('followup_job',job.id,'pending','SENDING_HOURS');return {outcome:'deferred'};}
  const c=this.s.contact(seq.customer);
  // This transaction is the dispatch authorization boundary. A committed revocation
  // or inbound before it suppresses the send. After it, the request is in flight and
  // must never be replayed merely because a worker or provider response is lost.
  this.s.db.prepare("INSERT INTO outreach_notifications VALUES(?,'promotional','dispatched',NULL,?,NULL)").run(job.id,now);
  this.s.db.prepare("UPDATE outreach_jobs SET status='dispatched',updated=? WHERE id=?").run(now,job.id);
  this.s.audit('followup_job',job.id,'dispatched');this.s.audit('followup_notification',job.id,'dispatched');return {outcome:'dispatch',context:{id:job.id,recipient:c.recipient,body:this.rules.message,category:'promotional'}};
 });}
 async process(job){const auth=this.authorize(job);if(auth.outcome!=='dispatch')return auth;let response;try{response=await this.s.observe('provider_outbound',['promotion',job.id],()=>this.provider.notify(auth.context));}catch(error){if(error?.code==='OPS_AUDIT_FAILED')throw error;}
  const result=notification(auth.context,response),now=this.now();
  this.s.tx(()=>{
   const jobNow=this.s.db.prepare('SELECT * FROM outreach_jobs WHERE id=?').get(job.id);if(jobNow.status!=='dispatched')throw Error('OUTREACH_NOT_DISPATCHED');
   const status=result.status==='succeeded'?'accepted':result.status;
   this.s.db.prepare('UPDATE outreach_notifications SET status=?,receipt=?,finished=? WHERE id=?').run(status,result.receipt??null,now,job.id);
   this.s.db.prepare('UPDATE outreach_jobs SET status=?,updated=? WHERE id=?').run(status,now,job.id);this.s.audit('followup_job',job.id,status,result.status==='uncertain'?'EXTERNAL_OUTCOME_UNCERTAIN':result.status==='failed'?'PROVIDER_REJECTED_NO_EFFECT':'NONE');this.s.audit('followup_notification',job.id,status,result.status==='uncertain'?'EXTERNAL_OUTCOME_UNCERTAIN':result.status==='failed'?'PROVIDER_REJECTED_NO_EFFECT':'NONE');
   if(status==='accepted'){
    const seq=this.s.db.prepare('SELECT * FROM outreach_sequences WHERE id=?').get(job.sequence);
    if(!this.eligible(seq)){const more=job.attempt<this.rules.maxAttempts;this.addJob(seq.id,more?'promotion':'handoff',more?job.attempt+1:job.attempt,now+(more?this.rules.delayMinutes:this.rules.handoffDelayMinutes)*60000,now);}
   }
  });return {outcome:result.status==='succeeded'?'accepted':result.status};
 }
 async tick(){const job=this.claim();return job?this.process(job):{outcome:'idle'};}
 recoverStoppedOwner(id,owner,proof){if(proof!=='worker_terminated_and_joined')throw Error('STOPPED_OWNER_REQUIRED');return this.s.tx(()=>{const job=this.s.db.prepare('SELECT * FROM outreach_jobs WHERE id=? AND owner=?').get(id,owner);if(!job)throw Error('JOB_NOT_OWNED');const now=this.now();if(job.status==='claimed'){this.s.db.prepare("UPDATE outreach_jobs SET status='pending',owner=NULL,updated=? WHERE id=?").run(now,id);return 'pending';}if(job.status==='dispatched'){this.s.db.prepare("UPDATE outreach_jobs SET status='uncertain',reason='worker_interrupted',updated=? WHERE id=?").run(now,id);this.s.db.prepare("UPDATE outreach_notifications SET status='uncertain',finished=? WHERE id=?").run(now,id);return 'uncertain';}return job.status;});}
 reschedule(id,expectedDue,due){const now=this.now();if(!Number.isSafeInteger(due)||due<now)throw Error('INVALID_DUE_TIME');return this.s.tx(()=>this.s.db.prepare("UPDATE outreach_jobs SET due=?,updated=? WHERE id=? AND status='pending' AND due=?").run(due,now,id,expectedDue).changes===1);}
}
module.exports={Scheduler,validateRules};
