'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
// Storage interface: receive, claim, begin, completeOperation, finish, failBeforeEffects,
// recoverStoppedOwner, snapshot, close. Workflow code never issues SQL.
class Inbox {
 constructor(file){
  if(!path.isAbsolute(file))throw Error('INBOX_PATH_REQUIRED');
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(file,{timeout:1500});
  this.db.exec('PRAGMA busy_timeout=1500; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  this.tx(()=>{
   const version=this.db.prepare('PRAGMA user_version').get().user_version;
   if(version>1)throw Error('UNSUPPORTED_INBOX_VERSION');
   if(version===0)this.db.exec(`
    CREATE TABLE messages (
     provider TEXT NOT NULL, channel TEXT NOT NULL, message_id TEXT NOT NULL, digest TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('received','processing','completed','retryable','uncertain','rejected')),
     owner TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     reason TEXT, PRIMARY KEY(provider,channel,message_id));
    CREATE TABLE operations (
     provider TEXT NOT NULL, channel TEXT NOT NULL, message_id TEXT NOT NULL, operation_key TEXT NOT NULL,
     status TEXT NOT NULL CHECK(status IN ('started','completed','uncertain')), owner TEXT NOT NULL,
     started_at INTEGER NOT NULL, finished_at INTEGER,
     PRIMARY KEY(provider,channel,message_id,operation_key),
     FOREIGN KEY(provider,channel,message_id) REFERENCES messages(provider,channel,message_id));
    PRAGMA user_version=1;`);
  });
 }
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 audit(m,status,code='NONE',operation){this.observer?.transition(operation?'inbox_operation':'message',operation?[...this.key(m),operation]:this.key(m),status,code);}
 key(m){if(!m||!['provider','channel','id'].every(k=>typeof m[k]==='string'&&/^[A-Za-z0-9._:@+-]{1,160}$/.test(m[k])))throw Error('INVALID_INBOX_KEY');return [m.provider,m.channel,m.id];}
 row(m){return this.db.prepare('SELECT * FROM messages WHERE provider=? AND channel=? AND message_id=?').get(...this.key(m));}
 receive(m){return this.tx(()=>this.receiveInTransaction(m));}
 receiveInTransaction(m){
  const k=this.key(m);if(!/^[a-f0-9]{64}$/.test(m.digest))throw Error('INVALID_DIGEST');
  const now=Date.now();this.db.prepare("INSERT OR IGNORE INTO messages(provider,channel,message_id,digest,status,created_at,updated_at) VALUES(?,?,?,?,'received',?,?)").run(...k,m.digest,now,now);if(this.row(m).digest===m.digest&&this.row(m).status==='received')this.audit(m,'received');
  const r=this.row(m);return r.digest===m.digest?{status:r.status}:{status:'conflict'};
 }
 claim(m){return this.tx(()=>{
  const received=this.receiveInTransaction(m);if(received.status==='conflict'){this.audit(m,'blocked','IDENTIFIER_CONFLICT');return received;}
  const r=this.row(m);if(!['received','retryable'].includes(r.status)){this.audit(m,'blocked');return {status:r.status};}
  if(r.attempts>=3){this.db.prepare("UPDATE messages SET status='rejected',reason='attempt_limit' WHERE provider=? AND channel=? AND message_id=?").run(...this.key(m));this.audit(m,'rejected','BUSINESS_RULE_BLOCKED');return {status:'rejected'};}
  const owner=randomUUID();this.db.prepare("UPDATE messages SET status='processing',owner=?,attempts=attempts+1,updated_at=? WHERE provider=? AND channel=? AND message_id=?").run(owner,Date.now(),...this.key(m));
  this.audit(m,'processing');if(this.observer&&process.env.BOOKING_RECOVERY_WORKER)require('../recovery/worker').bind(this.db,this.observer.link('message',this.key(m)),owner);return {status:'claimed',token:{...m,owner}};
 });}
 owned(token){const r=this.row(token);if(!r||r.owner!==token.owner||r.status!=='processing')throw Error('CLAIM_NOT_OWNED');return r;}
 begin(token,operation){return this.tx(()=>{
  this.owned(token);if(typeof operation!=='string'||operation.length>200)throw Error('INVALID_OPERATION_KEY');
  // Any repeated invocation is stopped, even completed ones: no cached PII results.
  const prior=this.db.prepare('SELECT status FROM operations WHERE provider=? AND channel=? AND message_id=? AND operation_key=?').get(...this.key(token),operation);
  if(prior)throw Error('OPERATION_ALREADY_RECORDED');
  this.db.prepare("INSERT INTO operations VALUES(?,?,?,?,'started',?,?,NULL)").run(...this.key(token),operation,token.owner,Date.now());this.audit(token,'started','NONE',operation);return true;
 });}
 completeOperation(token,operation,error=false){return this.tx(()=>{
  this.owned(token);
  const result=this.db.prepare("UPDATE operations SET status=?,finished_at=? WHERE provider=? AND channel=? AND message_id=? AND operation_key=? AND owner=? AND status='started'").run(error?'uncertain':'completed',Date.now(),...this.key(token),operation,token.owner);
  if(result.changes!==1)throw Error('OPERATION_NOT_OWNED');
  if(error)this.db.prepare("UPDATE messages SET status='uncertain',reason='operation_error',updated_at=? WHERE provider=? AND channel=? AND message_id=?").run(Date.now(),...this.key(token));
  this.audit(token,error?'uncertain':'completed',error?'EXTERNAL_OUTCOME_UNCERTAIN':'NONE',operation);return !error;
 });}
 finish(token){return this.tx(()=>{
  this.owned(token);const pending=this.db.prepare("SELECT count(*) AS n FROM operations WHERE provider=? AND channel=? AND message_id=? AND status!='completed'").get(...this.key(token)).n;
  if(pending)throw Error('UNFINISHED_OPERATIONS');
  this.db.prepare("UPDATE messages SET status='completed',updated_at=? WHERE provider=? AND channel=? AND message_id=?").run(Date.now(),...this.key(token));this.audit(token,'completed');
 });}
 failBeforeEffects(token){return this.tx(()=>{
  this.owned(token);const count=this.db.prepare('SELECT count(*) AS n FROM operations WHERE provider=? AND channel=? AND message_id=?').get(...this.key(token)).n;
  const status=count?'uncertain':'retryable';this.db.prepare('UPDATE messages SET status=?,owner=NULL,reason=?,updated_at=? WHERE provider=? AND channel=? AND message_id=?').run(status,'pre_effect_failure',Date.now(),...this.key(token));this.audit(token,status,'WORKER_INTERRUPTED');return status;
 });}
 // Operator-only API. Caller must stop/join the worker; expiry is NEVER sufficient.
 recoverStoppedOwner(token,proof){if(proof!=='worker_terminated_and_joined')throw Error('STOPPED_OWNER_REQUIRED');return this.failBeforeEffects(token);}
 snapshot(){return {messages:this.db.prepare('SELECT * FROM messages ORDER BY provider,channel,message_id').all(),operations:this.db.prepare('SELECT * FROM operations ORDER BY provider,channel,message_id,operation_key').all()};}
 close(){this.db.close();}
}
module.exports={Inbox};
