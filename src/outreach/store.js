'use strict';
const {BookingStore}=require('../booking/store');
const {createHash,randomUUID}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validText=(x,n=160)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\x00-\x1f\x7f]/.test(x);
class OutreachStore extends BookingStore {
 constructor(file){super(file);this.tx(()=>{
  const exists=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='outreach_migrations'").get();
  if(exists&&this.db.prepare('SELECT max(version) AS v FROM outreach_migrations').get().v!==1)throw Error('UNSUPPORTED_OUTREACH_SCHEMA');
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS outreach_migrations(version INTEGER PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS outreach_contacts(customer TEXT PRIMARY KEY,recipient TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 0,last_inbound INTEGER,engagement TEXT NOT NULL DEFAULT 'Unknown',declined INTEGER NOT NULL DEFAULT 0 CHECK(declined IN (0,1)),consent TEXT NOT NULL DEFAULT 'unknown' CHECK(consent IN ('unknown','granted','revoked')),consent_source TEXT,consent_at INTEGER,consent_updated INTEGER,consent_version INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS outreach_inbound(id TEXT PRIMARY KEY,customer TEXT NOT NULL REFERENCES outreach_contacts(customer),fingerprint TEXT NOT NULL,generation INTEGER NOT NULL,received INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS outreach_consent_events(id TEXT PRIMARY KEY,customer TEXT NOT NULL REFERENCES outreach_contacts(customer),fingerprint TEXT NOT NULL,status TEXT NOT NULL,source TEXT NOT NULL,actor TEXT NOT NULL,evidence TEXT NOT NULL,occurred INTEGER NOT NULL,recorded INTEGER NOT NULL,version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS outreach_sequences(id TEXT PRIMARY KEY,customer TEXT NOT NULL REFERENCES outreach_contacts(customer),generation INTEGER NOT NULL,rule_version INTEGER NOT NULL,booking_snapshot TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(customer,generation));
   CREATE TABLE IF NOT EXISTS outreach_jobs(id TEXT PRIMARY KEY,sequence TEXT NOT NULL REFERENCES outreach_sequences(id),kind TEXT NOT NULL CHECK(kind IN ('promotion','handoff')),attempt INTEGER NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','claimed','dispatched','accepted','failed','uncertain','suppressed','cancelled','completed')),owner TEXT,reason TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(sequence,kind,attempt));
   CREATE INDEX IF NOT EXISTS outreach_jobs_due ON outreach_jobs(due,id) WHERE status='pending';
   CREATE TABLE IF NOT EXISTS outreach_notifications(id TEXT PRIMARY KEY REFERENCES outreach_jobs(id),category TEXT NOT NULL CHECK(category='promotional'),status TEXT NOT NULL,receipt TEXT,started INTEGER NOT NULL,finished INTEGER);
   CREATE TABLE IF NOT EXISTS outreach_handoffs(customer TEXT PRIMARY KEY REFERENCES outreach_contacts(customer),state TEXT NOT NULL CHECK(state IN ('None','Requested','Assigned','Resolved')),sequence TEXT,booking_ref TEXT,reason TEXT,requested INTEGER,assigned INTEGER,resolved INTEGER,updated INTEGER NOT NULL,version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS outreach_handoff_events(id TEXT PRIMARY KEY,customer TEXT NOT NULL,fingerprint TEXT NOT NULL,previous TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,at INTEGER NOT NULL,version INTEGER NOT NULL);
   INSERT OR IGNORE INTO outreach_migrations VALUES(1);
  `);
 });}
 contact(customer){return this.db.prepare('SELECT * FROM outreach_contacts WHERE customer=?').get(customer);}
 ensure(customer,recipient){if(!validText(customer)||!/^\d{7,15}@s\.whatsapp\.net$/.test(recipient)||!customer.endsWith(':'+recipient.split('@')[0]))throw Error('INVALID_CUSTOMER_IDENTITY');this.db.prepare('INSERT OR IGNORE INTO outreach_contacts(customer,recipient) VALUES(?,?)').run(customer,recipient);if(this.contact(customer).recipient!==recipient)throw Error('RECIPIENT_CONFLICT');}
 cancel(customer,now,reason){this.db.prepare("UPDATE outreach_jobs SET status='cancelled',reason=?,updated=? WHERE status IN ('pending','claimed') AND sequence IN (SELECT id FROM outreach_sequences WHERE customer=?)").run(reason,now,customer);this.db.prepare("UPDATE outreach_sequences SET status='superseded' WHERE customer=? AND status='active'").run(customer);const h=this.handoff(customer);if(h?.state==='Requested')this.updateHandoff({id:'invalidate:'+h.version+':'+hash([customer,reason,now]),customer,state:'Resolved',reason:'eligibility_invalidated:'+reason,actor:'application',expectedVersion:h.version,sequence:h.sequence},now);}
 inbound({id,customer,recipient,text},now,consentStatus){if(!validText(id)||typeof text!=='string'||text.length>2000||!Number.isSafeInteger(now))throw Error('INVALID_INBOUND');return this.tx(()=>{
  this.ensure(customer,recipient);const fingerprint=hash([customer,recipient,text]),prior=this.db.prepare('SELECT * FROM outreach_inbound WHERE id=?').get(id);if(prior){if(prior.fingerprint!==fingerprint)throw Error('INBOUND_ID_CONFLICT');return prior;}
  this.cancel(customer,now,'new_inbound');this.db.prepare("UPDATE outreach_contacts SET generation=generation+1,last_inbound=?,engagement='Unknown' WHERE customer=?").run(now,customer);const c=this.contact(customer);
  this.db.prepare('INSERT INTO outreach_inbound VALUES(?,?,?,?,?)').run(id,customer,fingerprint,c.generation,now);if(consentStatus)this.applyConsent({id:'consent:'+id,customer,status:consentStatus,source:'authenticated_inbound',actor:customer,evidence:'exact_command:'+consentStatus,occurred:now,expectedVersion:c.consent_version},now);return {id,customer,generation:c.generation,received:now};
 });}
 consent(update,now){return this.tx(()=>this.applyConsent(update,now));}
 applyConsent(update,now){const {id,customer,status,source,actor,evidence,occurred,expectedVersion}=update;
  if(!validText(id)||!validText(customer)||!['unknown','granted','revoked'].includes(status)||!['authenticated_inbound','staff_verified','synthetic_fixture'].includes(source)||!validText(actor)||!validText(evidence,300)||!Number.isSafeInteger(occurred)||occurred>now||occurred<0||!Number.isSafeInteger(now)||!Number.isInteger(expectedVersion)||expectedVersion<0)throw Error('INVALID_CONSENT_UPDATE');
  const c=this.contact(customer);if(!c)throw Error('UNKNOWN_CUSTOMER');const fingerprint=hash(update),old=this.db.prepare('SELECT * FROM outreach_consent_events WHERE id=?').get(id);if(old){if(old.fingerprint!==fingerprint)throw Error('CONSENT_EVENT_CONFLICT');return old;}
   if(c.consent_version!==expectedVersion||occurred<(c.consent_at??0))throw Error('STALE_CONSENT');
   const version=c.consent_version+1;
   this.db.prepare(`UPDATE outreach_contacts SET consent=?,consent_source=?,consent_at=?,consent_updated=?,consent_version=?,declined=CASE WHEN ?='granted' THEN 0 ELSE declined END WHERE customer=?`).run(status,source,occurred,now,version,status,customer);
   this.db.prepare('INSERT INTO outreach_consent_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,customer,fingerprint,status,source,actor,evidence,occurred,now,version);
   this.cancel(customer,now,'consent_'+status);return {status,version};
 }
 engagement(customer,generation,value){if(!['Interested','Needs Info','Qualified','Not Interested'].includes(value))value='Unknown';return this.tx(()=>this.db.prepare(`UPDATE outreach_contacts SET engagement=?,declined=CASE WHEN ?='Not Interested' THEN 1 ELSE declined END WHERE customer=? AND generation=?`).run(value,value,customer,generation).changes===1);}
 snapshotBooking(customer){const b=this.current(customer);return JSON.stringify(b?[b.id,b.version,b.state]:null);}
 handoff(customer){return this.db.prepare('SELECT * FROM outreach_handoffs WHERE customer=?').get(customer);}
 handoffUpdate({id,customer,state,reason,actor,expectedVersion,sequence=null},now){if(!validText(id)||!validText(reason,300)||!validText(actor)||!['None','Requested','Assigned','Resolved'].includes(state)||!Number.isInteger(expectedVersion))throw Error('INVALID_HANDOFF');return this.tx(()=>this.updateHandoff({id,customer,state,reason,actor,expectedVersion,sequence},now));}
 updateHandoff(p,now){const fingerprint=hash(p),prior=this.db.prepare('SELECT * FROM outreach_handoff_events WHERE id=?').get(p.id);if(prior){if(prior.fingerprint!==fingerprint)throw Error('HANDOFF_EVENT_CONFLICT');return prior;}
  if(!this.contact(p.customer))throw Error('UNKNOWN_CUSTOMER');const h=this.handoff(p.customer)||{state:'None',version:0};if(h.version!==p.expectedVersion)throw Error('STALE_HANDOFF');
  if(!({None:['Requested'],Requested:['Assigned','Resolved'],Assigned:['Resolved'],Resolved:[]}[h.state]||[]).includes(p.state))throw Error('INVALID_HANDOFF_TRANSITION');
  const b=this.current(p.customer),version=h.version+1;
  this.db.prepare('INSERT INTO outreach_handoffs(customer,state,sequence,booking_ref,reason,requested,assigned,resolved,updated,version) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(customer) DO UPDATE SET state=excluded.state,sequence=excluded.sequence,booking_ref=excluded.booking_ref,reason=excluded.reason,assigned=excluded.assigned,resolved=excluded.resolved,updated=excluded.updated,version=excluded.version').run(p.customer,p.state,p.sequence??h.sequence??null,h.version>0?(h.booking_ref??null):(b?.id??null),p.reason,h.requested??(p.state==='Requested'?now:null),p.state==='Assigned'?now:h.assigned??null,p.state==='Resolved'?now:null,now,version);
  this.db.prepare('INSERT INTO outreach_handoff_events VALUES(?,?,?,?,?,?,?,?,?)').run(p.id,p.customer,fingerprint,h.state,p.state,p.reason,p.actor,now,version);return this.handoff(p.customer);
 }
 snapshotOutreach(){return Object.fromEntries(['outreach_contacts','outreach_consent_events','outreach_inbound','outreach_sequences','outreach_jobs','outreach_notifications','outreach_handoffs','outreach_handoff_events'].map(t=>[t,this.db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));}
}
module.exports={OutreachStore,hash,randomUUID};
