'use strict';
const {AuditError,KINDS,STATUSES,CODES}=require('./events');
const quoted=xs=>xs.map(x=>"'"+x+"'").join(',');
function version(db){const row=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ops_migrations'").get();return row?db.prepare('SELECT max(version) AS version FROM ops_migrations').get().version:0;}
function migrate(db){
 const v=version(db);if(v!==0&&v!==1)throw new AuditError();if(v===1)return;
 if(db.isTransaction)throw new AuditError();db.exec('BEGIN IMMEDIATE');
 try{const locked=version(db);if(locked!==0){if(locked!==1)throw new AuditError();db.exec('COMMIT');return;}
 db.exec(`
 CREATE TABLE ops_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
 CREATE TABLE ops_links(ref TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN (${quoted(KINDS)})),source_key TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(kind,source_key));
 CREATE TABLE ops_attempts(ref TEXT PRIMARY KEY,trace_ref TEXT NOT NULL REFERENCES ops_links(ref),entity_ref TEXT NOT NULL REFERENCES ops_links(ref),status TEXT NOT NULL CHECK(status IN (${quoted(STATUSES)})),code TEXT NOT NULL CHECK(code IN (${quoted(CODES)})),started_at INTEGER NOT NULL,finished_at INTEGER,duration_ms REAL);
 CREATE TABLE ops_events(event_ref TEXT PRIMARY KEY,trace_ref TEXT NOT NULL REFERENCES ops_links(ref),entity_ref TEXT NOT NULL REFERENCES ops_links(ref),attempt_ref TEXT REFERENCES ops_attempts(ref),parent_ref TEXT REFERENCES ops_links(ref),kind TEXT NOT NULL CHECK(kind IN (${quoted(KINDS)})),status TEXT NOT NULL CHECK(status IN (${quoted(STATUSES)})),code TEXT NOT NULL CHECK(code IN (${quoted(CODES)})),at INTEGER NOT NULL,duration_ms REAL);
 CREATE UNIQUE INDEX ops_one_active_attempt ON ops_attempts(entity_ref) WHERE finished_at IS NULL;
 CREATE INDEX ops_events_trace ON ops_events(trace_ref,at);
 CREATE INDEX ops_events_entity ON ops_events(entity_ref,at);
 CREATE INDEX ops_attempts_status ON ops_attempts(status,started_at);
 CREATE TRIGGER ops_events_no_update BEFORE UPDATE ON ops_events BEGIN SELECT RAISE(ABORT,'OPS_APPEND_ONLY'); END;
 CREATE TRIGGER ops_events_no_delete BEFORE DELETE ON ops_events BEGIN SELECT RAISE(ABORT,'OPS_APPEND_ONLY'); END;
 `);db.prepare('INSERT INTO ops_migrations VALUES(1,?)').run(Date.now());db.exec('COMMIT');
 }catch{db.exec('ROLLBACK');throw new AuditError();}
}
module.exports={migrate,version};
