'use strict';
const {STATUSES}=require('../operations/events');
const {ACTIONS,STATES,REASONS,RecoveryError}=require('./catalog');
const q=xs=>xs.map(x=>"'"+x+"'").join(',');
function version(db){return db.prepare("SELECT 1 FROM sqlite_master WHERE name='ops_recovery_migrations'").get()?db.prepare('SELECT max(version) v FROM ops_recovery_migrations').get().v:0;}
function migrate(db){if(version(db)===1)return;if(version(db)!==0)throw new RecoveryError('SCHEMA_UNAVAILABLE');db.exec('BEGIN IMMEDIATE');try{
 if(version(db)===1){db.exec('COMMIT');return;}
 db.exec(`CREATE TABLE ops_recovery_migrations(version INTEGER PRIMARY KEY,at INTEGER NOT NULL);
 CREATE TABLE ops_recovery_workers(id TEXT PRIMARY KEY,secret TEXT NOT NULL,pid INTEGER,start TEXT,boot TEXT,status TEXT NOT NULL CHECK(status IN ('registered','running','joined','unverified')),at INTEGER NOT NULL,joined_at INTEGER);
 CREATE TABLE ops_recovery_bindings(worker TEXT NOT NULL REFERENCES ops_recovery_workers(id),target_ref TEXT NOT NULL REFERENCES ops_links(ref),owner TEXT NOT NULL,PRIMARY KEY(worker,target_ref,owner));
 CREATE TABLE ops_recovery_requests(id TEXT PRIMARY KEY,target_ref TEXT NOT NULL REFERENCES ops_links(ref),logical_key TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN (${q(ACTIONS)})),observed_state TEXT NOT NULL DEFAULT 'unknown' CHECK(observed_state IN (${q(STATUSES)})),operation_version INTEGER,booking_version INTEGER,eligibility TEXT NOT NULL DEFAULT 'ELIGIBLE' CHECK(eligibility IN (${q(REASONS)})),snapshot TEXT NOT NULL,fingerprint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (${q(STATES)})),reason TEXT NOT NULL CHECK(reason IN (${q(REASONS)})),worker TEXT REFERENCES ops_recovery_workers(id),effect_ref TEXT REFERENCES ops_links(ref),created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE ops_recovery_evidence(id TEXT PRIMARY KEY,entity_ref TEXT NOT NULL REFERENCES ops_links(ref),outcome TEXT NOT NULL CHECK(outcome IN ('transient_no_effect','permanent_no_effect','unclassified_no_effect','applied','uncertain')),at INTEGER NOT NULL);
 CREATE INDEX ops_recovery_evidence_entity ON ops_recovery_evidence(entity_ref,at);
 CREATE TRIGGER ops_recovery_evidence_no_update BEFORE UPDATE ON ops_recovery_evidence BEGIN SELECT RAISE(ABORT,'OPS_APPEND_ONLY'); END;
 CREATE TRIGGER ops_recovery_evidence_no_delete BEFORE DELETE ON ops_recovery_evidence BEGIN SELECT RAISE(ABORT,'OPS_APPEND_ONLY'); END;
 CREATE TABLE ops_recovery_claims(lock_key TEXT PRIMARY KEY,target_ref TEXT NOT NULL REFERENCES ops_links(ref),request TEXT NOT NULL UNIQUE REFERENCES ops_recovery_requests(id));
 CREATE TABLE ops_recovery_events(id TEXT PRIMARY KEY,request TEXT NOT NULL REFERENCES ops_recovery_requests(id),phase TEXT NOT NULL CHECK(phase IN ('claimed','dispatch','read','outcome','blocked','interrupted')),state TEXT NOT NULL CHECK(state IN (${q(STATES)})),reason TEXT NOT NULL CHECK(reason IN (${q(REASONS)})),evidence_ref TEXT,at INTEGER NOT NULL);
 CREATE INDEX ops_recovery_events_request ON ops_recovery_events(request,at);
 CREATE TRIGGER ops_recovery_events_no_update BEFORE UPDATE ON ops_recovery_events BEGIN SELECT RAISE(ABORT,'OPS_APPEND_ONLY'); END;
 CREATE TRIGGER ops_recovery_events_no_delete BEFORE DELETE ON ops_recovery_events BEGIN SELECT RAISE(ABORT,'OPS_APPEND_ONLY'); END;
 CREATE TRIGGER ops_recovery_request_identity BEFORE UPDATE OF id,target_ref,logical_key,action,observed_state,operation_version,booking_version,snapshot,fingerprint,created ON ops_recovery_requests BEGIN SELECT RAISE(ABORT,'OPS_IMMUTABLE_REQUEST'); END;
 `);db.prepare('INSERT INTO ops_recovery_migrations VALUES(1,?)').run(Date.now());db.exec('COMMIT');
 }catch{if(db.isTransaction)db.exec('ROLLBACK');throw new RecoveryError('AUDIT_UNAVAILABLE');}}
module.exports={migrate,version};
