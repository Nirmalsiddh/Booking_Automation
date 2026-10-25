'use strict';
// Trusted local harness parent. Proof originates from this ChildProcess lifecycle,
// never a CLI proof argument, PID supplied by an operator, lease, or model response.
const fs=require('node:fs'),cp=require('node:child_process'),{randomUUID,randomBytes}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {isolated,AUTH}=require('./isolation'),{identity}=require('./worker'),{migrate}=require('./migrations');
class Supervisor {
 constructor(file){isolated(file);this.file=file;this.db=new DatabaseSync(file);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500');migrate(this.db);}
 launch(script,args,env,{operator=false}={}){
  if(!['/opt/runtime/node_modules/n8n/bin/n8n','/harness/operations/cli.js'].includes(script))throw Error('UNTRUSTED_WORKER_PROGRAM');
  const id=randomUUID(),secret=randomBytes(32).toString('hex');this.db.prepare("INSERT INTO ops_recovery_workers(id,secret,status,at) VALUES(?,?,'registered',?)").run(id,secret,Date.now());
  const child=cp.spawn('/usr/bin/node',[script,...args],{detached:true,env:{...env,BOOKING_RECOVERY_WORKER:id,BOOKING_WORKER_SECRET:secret,BOOKING_WORKER_DATABASE:this.file,...(operator?{BOOKING_RECOVERY_TOKEN:JSON.parse(fs.readFileSync(AUTH)).token}:{})}});
  const joined=new Promise((resolve,reject)=>{
   child.once('error',reject);
   child.once('spawn',()=>{try{const i=identity(child.pid);this.db.prepare("UPDATE ops_recovery_workers SET pid=?,start=?,boot=?,status='running' WHERE id=?").run(i.pid,i.start,i.boot,id);}catch{child.kill('SIGKILL');}});
   child.once('close',async()=>{try{
    // All provider mutations execute in the managed parent. Also stop its runner
    // group and refuse proof while any non-zombie member could still execute.
    try{process.kill(-child.pid,'SIGKILL');}catch{}
    let stopped=false;
    for(let attempt=0;attempt<30;attempt++){
     let unknown=false;const alive=fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n)).some(n=>{try{const v=identity(Number(n));return v.group===child.pid&&!['Z','X'].includes(v.state);}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))unknown=true;return false;}});
     if(!alive&&!unknown){stopped=true;break;}await new Promise(r=>setTimeout(r,10));
    }
    this.db.prepare('UPDATE ops_recovery_workers SET status=?,joined_at=? WHERE id=?').run(stopped?'joined':'unverified',stopped?Date.now():null,id);resolve({id,verified:stopped});
   }catch{reject(new (require('./catalog').RecoveryError)('AUDIT_UNAVAILABLE'));}});
  });
  return {child,joined,id};
 }
 close(){this.db.close();}
}
module.exports={Supervisor};
