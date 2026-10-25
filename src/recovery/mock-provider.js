'use strict';
// The recovery executor has no HTTP/SDK adapter or caller-selectable module path.
// Separate durable mock remote records supply evidence; absence is inconclusive.
class MockRecoveryProvider {
 constructor(store,faults={}){this.s=store;this.faults=faults;store.db.exec('CREATE TABLE IF NOT EXISTS mock_recovery_receipts(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,receipt TEXT NOT NULL)');}
 async send(d){if(this.s.db.isTransaction)throw Error('PROVIDER_TRANSACTION_OPEN');const {BookingProvider}=require('../../tests/harness/BookingProvider');const p=new BookingProvider(this.s,this.faults);let result;
  if(this.faults.delayMs)await new Promise(r=>setTimeout(r,Math.min(1000,this.faults.delayMs)));
  if(d.type==='projection'){p.log('sheet',d.id);if(['failed','permanent','unclassified'].includes(this.faults.sheet))result={requestId:d.id,rejected:true,noEffect:true};else{if(this.faults.sheet==='timeout')throw Error('SYNTHETIC_TIMEOUT');const changed=this.s.db.prepare('INSERT INTO mock_sheets VALUES(?,?,?) ON CONFLICT(customer) DO UPDATE SET revision=excluded.revision,payload=excluded.payload WHERE mock_sheets.revision<=excluded.revision').run(d.customer,d.revision,d.payload).changes;result=changed?{requestId:d.id,customer:d.customer,revision:d.revision,verifiedPayload:d.payload}:{requestId:d.id,rejected:true,noEffect:true};}}else{const mode=this.faults.outbound;if(['permanent','unclassified'].includes(mode))p.faults={...p.faults,outbound:'failed'};result=await p.notify(d);}
  const evidence=require('./evidence');result=evidence.classified(result,this.faults[d.type==='projection'?'sheet':'outbound']);evidence.save(this.s,{projection:'projection',notification:'booking_notification',promotion:'followup_notification'}[d.type],d,result,d.type==='projection'?'projection':'notification');
  if(result?.accepted)this.s.db.prepare('INSERT OR REPLACE INTO mock_recovery_receipts VALUES(?,?,?)').run(d.id,d.recipient,result.messageId);
  if(this.faults.crashAfterEffect)process.kill(process.pid,'SIGKILL');if(this.faults.timeoutAfterEffect)throw Error('SYNTHETIC_TIMEOUT');return result;
 }
 async observe(d){if(this.s.db.isTransaction)throw Error('PROVIDER_TRANSACTION_OPEN');const {BookingProvider}=require('../../tests/harness/BookingProvider');const p=new BookingProvider(this.s);if(d.type==='calendar')return p.observe(d);
  if(d.type==='projection'){p.log('observe_sheet',d.id);const row=this.s.db.prepare('SELECT * FROM mock_sheets WHERE customer=?').get(d.customer);return row?{requestId:d.id,...row,verifiedPayload:row.payload}:null;}
  p.log('observe_outbound',d.id);let r=this.s.db.prepare('SELECT * FROM mock_recovery_receipts WHERE id=?').get(d.id);if(!r&&d.type==='promotion'&&this.s.db.prepare("SELECT 1 FROM sqlite_master WHERE name='mock_outreach_remote'").get())r=this.s.db.prepare('SELECT recipient,receipt FROM mock_outreach_remote WHERE id=?').get(d.id);return r?{requestId:d.id,accepted:true,messageId:r.receipt,recipient:r.recipient}:null;
 }
}
module.exports={MockRecoveryProvider};
