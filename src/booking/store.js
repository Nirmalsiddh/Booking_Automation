'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
class BookingStore {
 constructor(file){this.db=new DatabaseSync(file);this.db.exec('PRAGMA busy_timeout=1500; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');this.tx(()=>{const exists=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='booking_migrations'").get();if(exists&&![1,2].includes(this.db.prepare('SELECT max(version) AS v FROM booking_migrations').get().v))throw Error('UNSUPPORTED_BOOKING_SCHEMA');this.db.exec(`
 CREATE TABLE IF NOT EXISTS booking_migrations(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS booking_resources(id TEXT PRIMARY KEY, capacity INTEGER NOT NULL CHECK(capacity=1));
 CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,customer TEXT NOT NULL,resource TEXT NOT NULL REFERENCES booking_resources(id),start INTEGER,end INTEGER,event TEXT,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS booking_operations(id TEXT PRIMARY KEY,booking TEXT NOT NULL REFERENCES bookings(id),action TEXT NOT NULL,fingerprint TEXT NOT NULL,start INTEGER,end INTEGER,status TEXT NOT NULL,result TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS booking_one_mutation ON booking_operations(booking) WHERE status IN ('prepared','dispatched','uncertain');
 CREATE TABLE IF NOT EXISTS booking_holds(operation TEXT PRIMARY KEY REFERENCES booking_operations(id),booking TEXT NOT NULL,resource TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,CHECK(end>start));
 CREATE TRIGGER IF NOT EXISTS booking_overlap BEFORE INSERT ON booking_holds BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM booking_holds WHERE resource=NEW.resource AND booking!=NEW.booking AND start<NEW.end AND end>NEW.start) THEN RAISE(ABORT,'RESERVATION_CONFLICT') END;
 END;
 CREATE TABLE IF NOT EXISTS booking_projections(customer TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS booking_projection_attempts(id TEXT PRIMARY KEY,customer TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS booking_projection_owner ON booking_projection_attempts(customer) WHERE status IN ('dispatched','uncertain');
 CREATE TABLE IF NOT EXISTS booking_notifications(id TEXT PRIMARY KEY,booking TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL,receipt TEXT);
 INSERT OR IGNORE INTO booking_migrations VALUES(1);
 CREATE TABLE IF NOT EXISTS booking_profiles(customer TEXT PRIMARY KEY,payload TEXT NOT NULL);
 INSERT OR IGNORE INTO booking_migrations VALUES(2);
 `);});if(this.db.prepare('SELECT max(version) AS version FROM booking_migrations').get().version!==2){this.close();throw Error('UNSUPPORTED_BOOKING_SCHEMA');}}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const x=fn();this.db.exec('COMMIT');return x;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 audit(kind,key,status,code='NONE'){this.observer?.transition(kind,key,status,code);}
 observe(kind,key,fn){return this.observer?this.observer.run(kind,key,fn):fn();}
 resource(id,capacity=1){if(capacity!==1)throw Error('UNSUPPORTED_CAPACITY');this.db.prepare('INSERT OR IGNORE INTO booking_resources VALUES(?,?)').run(id,capacity);}
 booking(id){return this.db.prepare('SELECT * FROM bookings WHERE id=?').get(id);}
 operation(id){return this.db.prepare('SELECT * FROM booking_operations WHERE id=?').get(id);}
 prepare(p){return this.tx(()=>{
  const fingerprint=JSON.stringify([p.booking,p.customer,p.resource,p.action,p.start,p.end,p.version]);const prior=this.operation(p.id);
  if(prior){if(prior.fingerprint!==fingerprint)throw Error('OPERATION_ID_CONFLICT');return prior;}
  if(!['create','update','delete'].includes(p.action))throw Error('INVALID_ACTION');
  if(p.action!=='delete'&&(!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.end<=p.start))throw Error('INVALID_INTERVAL');
  let b=this.booking(p.booking);
  if(p.action==='create'){
   if(b)throw Error('BOOKING_EXISTS');
   if(this.db.prepare("SELECT 1 FROM bookings WHERE customer=? AND state!='cancelled'").get(p.customer))throw Error('CUSTOMER_HAS_BOOKING');
   this.db.prepare("INSERT INTO bookings(id,customer,resource,state) VALUES(?,?,?,'pending')").run(p.booking,p.customer,p.resource);b=this.booking(p.booking);
  }else if(!b||b.state!=='confirmed'||b.version!==p.version||b.customer!==p.customer||b.resource!==p.resource)throw Error('STALE_BOOKING');
  this.db.prepare("INSERT INTO booking_operations VALUES(?,?,?,?,?,?,'prepared',NULL)").run(p.id,p.booking,p.action,fingerprint,p.start??b.start,p.end??b.end);
  if(p.action!=='delete')this.db.prepare('INSERT INTO booking_holds VALUES(?,?,?,?,?)').run(p.id,p.booking,p.resource,p.start,p.end);
  this.audit('booking_operation',p.id,'prepared');return this.operation(p.id);
 });}
 dispatch(id){return this.tx(()=>{if(this.db.prepare("UPDATE booking_operations SET status='dispatched' WHERE id=? AND status='prepared'").run(id).changes!==1)throw Error('MUTATION_NOT_DISPATCHABLE');this.audit('booking_operation',id,'dispatched');return this.operation(id);});}
 settle(id,outcome){return this.tx(()=>this.applyOutcome(id,outcome));}
 applyOutcome(id,outcome){
  const op=this.operation(id);if(!op||op.status!=='dispatched')throw Error('NOT_DISPATCHED');
  if(!['succeeded','failed','uncertain'].includes(outcome.status))throw Error('INVALID_OUTCOME');
  if(outcome.status==='succeeded'&&op.action!=='delete'&&(typeof outcome.eventId!=='string'||!outcome.eventId))throw Error('MISSING_VERIFIED_EVENT_ID');
  this.db.prepare('UPDATE booking_operations SET status=?,result=? WHERE id=?').run(outcome.status,JSON.stringify(outcome),id);this.audit('booking_operation',id,outcome.status,outcome.status==='uncertain'?'EXTERNAL_OUTCOME_UNCERTAIN':outcome.status==='failed'?'PROVIDER_REJECTED_NO_EFFECT':'NONE');
  const b=this.booking(op.booking);
  if(outcome.status==='uncertain'){this.db.prepare("UPDATE bookings SET state='uncertain' WHERE id=?").run(b.id);return this.booking(b.id);}
  if(outcome.status==='failed'){
   this.db.prepare('DELETE FROM booking_holds WHERE operation=?').run(id);
   this.db.prepare('UPDATE bookings SET state=? WHERE id=?').run(op.action==='create'?'cancelled':'confirmed',b.id);return this.booking(b.id);
  }
  if(op.action==='delete'){this.db.prepare('DELETE FROM booking_holds WHERE booking=?').run(b.id);this.db.prepare("UPDATE bookings SET state='cancelled',version=version+1 WHERE id=?").run(b.id);}
  else{
   this.db.prepare('DELETE FROM booking_holds WHERE booking=? AND operation!=?').run(b.id,id);
   this.db.prepare("UPDATE bookings SET start=?,end=?,event=?,state='confirmed',version=version+1 WHERE id=?").run(op.start,op.end,outcome.eventId,b.id);
  }
  const updated=this.booking(b.id),payload=JSON.stringify(updated);
  this.db.prepare("INSERT INTO booking_projections VALUES(?,1,?,'pending') ON CONFLICT(customer) DO UPDATE SET revision=revision+1,payload=excluded.payload,status='pending'").run(b.customer,payload);
  return updated;
 }
 reconcile(id,outcome){return this.tx(()=>{const op=this.operation(id);if(!op||!['uncertain','dispatched'].includes(op.status))throw Error('NOT_RECONCILABLE');this.db.prepare("UPDATE booking_operations SET status='dispatched' WHERE id=?").run(id);return this.applyOutcome(id,outcome);});}
 profile(customer){const row=this.db.prepare('SELECT payload FROM booking_profiles WHERE customer=?').get(customer);return row?JSON.parse(row.payload):{};}
 saveProfile(customer,profile){if(!profile||typeof profile!=='object'||Array.isArray(profile))throw Error('INVALID_PROFILE_DOCUMENT');return this.tx(()=>{this.db.prepare('INSERT INTO booking_profiles VALUES(?,?) ON CONFLICT(customer) DO UPDATE SET payload=excluded.payload').run(customer,JSON.stringify(profile));return profile;});}
 current(customer){return this.db.prepare("SELECT * FROM bookings WHERE customer=? ORDER BY rowid DESC LIMIT 1").get(customer);}
 snapshot(){return Object.fromEntries(['bookings','booking_operations','booking_holds','booking_projections','booking_projection_attempts','booking_notifications','booking_profiles'].map(t=>[t,this.db.prepare('SELECT * FROM '+t).all()]));}
 beginProjection(customer,revision){return this.tx(()=>{const p=this.db.prepare('SELECT * FROM booking_projections WHERE customer=?').get(customer);if(!p||p.revision!==revision||p.status==='synced')throw Error('STALE_PROJECTION');const id=randomUUID();this.db.prepare("INSERT INTO booking_projection_attempts VALUES(?,?,?,'dispatched')").run(id,customer,revision);this.audit('projection',id,'dispatched');return {...p,id};});}
 endProjection(id,status){return this.tx(()=>{if(!['succeeded','failed','uncertain'].includes(status))throw Error('INVALID_OUTCOME');const p=this.db.prepare("SELECT * FROM booking_projection_attempts WHERE id=? AND status='dispatched'").get(id);if(!p)throw Error('PROJECTION_NOT_OWNED');this.db.prepare('UPDATE booking_projection_attempts SET status=? WHERE id=?').run(status,id);this.db.prepare('UPDATE booking_projections SET status=? WHERE customer=? AND revision=?').run(status==='succeeded'?'synced':status,p.customer,p.revision);this.audit('projection',id,status,status==='uncertain'?'EXTERNAL_OUTCOME_UNCERTAIN':status==='failed'?'PROVIDER_REJECTED_NO_EFFECT':'NONE');});}
 beginNotification(booking,expectedVersion){return this.tx(()=>{const b=this.booking(booking);if(!b||!['confirmed','cancelled'].includes(b.state)||b.version<1)throw Error('UNVERIFIED_BOOKING');if(expectedVersion!==undefined&&b.version!==expectedVersion)throw Error('STALE_NOTIFICATION');const id=b.id+':'+b.version;if(this.db.prepare('SELECT 1 FROM booking_notifications WHERE id=?').get(id))throw Error('NOTIFICATION_ALREADY_RECORDED');this.db.prepare("INSERT INTO booking_notifications VALUES(?,?,?,'dispatched',NULL)").run(id,b.id,b.version);this.audit('booking_notification',id,'dispatched');return {id,booking:b};});}
 beginOutcomeNotice(operation){return this.tx(()=>{const op=this.operation(operation);if(!op||!['failed','uncertain'].includes(op.status))throw Error('OUTCOME_NOT_REPORTABLE');const b=this.booking(op.booking),id=operation+':outcome';this.db.prepare("INSERT INTO booking_notifications VALUES(?,?,?,'dispatched',NULL)").run(id,b.id,b.version);this.audit('booking_notification',id,'dispatched');return {id,status:op.status};});}
 endNotification(id,status,receipt=null){return this.tx(()=>{if(!['succeeded','failed','uncertain'].includes(status))throw Error('INVALID_OUTCOME');if(this.db.prepare("UPDATE booking_notifications SET status=?,receipt=? WHERE id=? AND status='dispatched'").run(status,receipt,id).changes!==1)throw Error('NOTIFICATION_NOT_OWNED');this.audit('booking_notification',id,status==='succeeded'?'accepted':status,status==='uncertain'?'EXTERNAL_OUTCOME_UNCERTAIN':status==='failed'?'PROVIDER_REJECTED_NO_EFFECT':'NONE');});}
 close(){this.db.close();}
}
module.exports={BookingStore};
