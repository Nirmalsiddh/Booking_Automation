'use strict';
// Durable synthetic provider. No HTTP, SDK, network, credentials, or personal data.
class OutreachProvider {
 constructor(store,faults={}){this.s=store;this.faults=faults;store.db.exec('CREATE TABLE IF NOT EXISTS mock_calls(kind TEXT,operation TEXT,body TEXT); CREATE TABLE IF NOT EXISTS mock_outreach_remote(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,receipt TEXT NOT NULL);');}
 async notify(c){this.s.db.prepare("INSERT INTO mock_calls VALUES('promotion',?,?)").run(c.id,JSON.stringify(c));if(this.faults.outbound==='failed')return {requestId:c.id,rejected:true,noEffect:true};
  const receipt='synthetic-'+c.id;this.s.db.prepare('INSERT INTO mock_outreach_remote VALUES(?,?,?)').run(c.id,c.recipient,receipt);
  if(this.faults.crash)process.kill(process.pid,'SIGKILL');
  if(this.faults.outbound==='timeout')throw Error('SYNTHETIC_TIMEOUT_AFTER_ACCEPTANCE');
  return {requestId:c.id,accepted:true,messageId:receipt,recipient:c.recipient};
 }
}
module.exports={OutreachProvider};
