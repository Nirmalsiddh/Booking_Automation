'use strict';
// Test adapter: provider evidence is derived from a separate durable mock remote-state table.
class BookingProvider {
 constructor(store,faults={}){this.s=store;this.faults=faults;store.db.exec(`CREATE TABLE IF NOT EXISTS mock_receipts(operation TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS mock_events(id TEXT PRIMARY KEY,start INTEGER,end INTEGER,operation TEXT,calendar TEXT);CREATE TABLE IF NOT EXISTS mock_calls(kind TEXT,operation TEXT,body TEXT);CREATE TABLE IF NOT EXISTS mock_sheets(customer TEXT PRIMARY KEY,revision INTEGER,payload TEXT);`);}
 log(kind,id,body={}){this.s.db.prepare('INSERT INTO mock_calls VALUES(?,?,?)').run(kind,id,JSON.stringify(body));}
 async available(c){this.log('availability',c.operation);return !this.s.db.prepare('SELECT 1 FROM mock_events WHERE calendar=? AND id!=? AND start<? AND end>?').get(c.calendar,c.eventId,c.end,c.start);}
 evidence(c){const e=this.s.db.prepare('SELECT * FROM mock_events WHERE id=?').get(c.eventId);
 if(c.action==='delete')return {requestId:c.operation,calendar:c.calendar,deletedId:c.eventId,absenceVerified:!e&&!!this.s.db.prepare('SELECT 1 FROM mock_receipts WHERE operation=?').get(c.operation)};
 return {requestId:c.operation,calendar:c.calendar,event:e?{id:e.id,start:new Date(e.start).toISOString(),end:new Date(e.end).toISOString(),status:e.operation===c.operation?'confirmed':'unverified'}:null};}
 async mutate(c){this.log(c.action,c.operation,c);if(this.faults.calendar==='failed')return {requestId:c.operation,rejected:true,noEffect:true};if(this.faults.calendar==='timeout-before')throw Error('SYNTHETIC_TIMEOUT');
 if(c.action==='delete')this.s.db.prepare('DELETE FROM mock_events WHERE id=?').run(c.eventId);else this.s.db.prepare('INSERT INTO mock_events VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET start=excluded.start,end=excluded.end,operation=excluded.operation').run(c.eventId,c.start,c.end,c.operation,c.calendar);
 this.s.db.prepare('INSERT OR IGNORE INTO mock_receipts VALUES(?)').run(c.operation);
 if(this.faults.crash)process.kill(process.pid,'SIGKILL');
 if(this.faults.calendar==='timeout')throw Error('SYNTHETIC_TIMEOUT');
 const evidence=this.evidence(c);if(this.faults.calendar==='wrong-id')evidence.event.id='unexpected';return evidence;}
 async observe(c){this.log('observe',c.operation);return this.evidence(c);}
 async project(c){this.log('sheet',c.id);if(this.faults.sheet==='failed')return {requestId:c.id,rejected:true,noEffect:true};if(this.faults.sheet==='timeout')throw Error('SYNTHETIC_TIMEOUT');this.s.db.prepare('INSERT INTO mock_sheets VALUES(?,?,?) ON CONFLICT(customer) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(c.customer,c.revision,c.payload);return {requestId:c.id,customer:c.customer,revision:c.revision,verifiedPayload:c.payload};}
 async notify(c){this.log('outbound',c.id,c);if(this.faults.outbound==='failed')return {requestId:c.id,rejected:true,noEffect:true};return {requestId:c.id,accepted:true,messageId:'synthetic-'+c.id,recipient:c.recipient};}
}
module.exports={BookingProvider};
