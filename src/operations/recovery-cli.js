'use strict';
const {parseArgs}=require('node:util'),{Reader}=require('./reader'),{REASONS}=require('../recovery/catalog');
async function main(args=process.argv.slice(3),out=process.stdout,err=process.stderr){let reader,engine,supervisor;try{
 const {values:v,positionals:p}=parseArgs({args,allowPositionals:true,options:{db:{type:'string'},target:{type:'string'},action:{type:'string'},snapshot:{type:'string'},'request-id':{type:'string'},execute:{type:'boolean',default:false}}});
 if(p.length!==1||!['plan','apply'].includes(p[0])||!v.db||!v.target||!v.action||p[0]==='plan'&&v.execute)throw Error('INVALID_ARGUMENT');
 if(p[0]==='plan'||!v.execute){reader=new Reader(v.db);let now=Date.now();try{now=require('../recovery/isolation').authority(v.db).now??now;}catch{}const result=require('../recovery/plan').plan(reader.db,{target:v.target,action:v.action},now);out.write(JSON.stringify(result)+'\n');return 0;}
 if(!require('../operations/events').UUID.test(v['request-id'])||!require('../operations/events').UUID.test(v.target)||!require('../recovery/catalog').ACTIONS.includes(v.action)||!/^[a-f0-9]{64}$/.test(v.snapshot||''))throw Error('INVALID_ARGUMENT');
 require('../recovery/isolation').authority(v.db,{operator:true});
 if(!process.env.BOOKING_RECOVERY_WORKER){
  supervisor=new (require('../recovery/supervisor').Supervisor)(v.db);const h=supervisor.launch('/harness/operations/cli.js',['recovery',...args],{...process.env},{operator:true});let stdout='',stderr='';h.child.stdout.on('data',x=>stdout+=x);h.child.stderr.on('data',x=>stderr+=x);const result=await h.joined;
  if(!result.verified)throw Error('OWNERSHIP_UNVERIFIED');try{const parsed=JSON.parse(stdout);out.write(JSON.stringify(parsed)+'\n');return parsed.state==='succeeded'?0:3;}catch{const line=stderr.split('\n').find(x=>x.startsWith('{'));let code;try{code=JSON.parse(line).error;}catch{}throw Error(REASONS.includes(code)?code:'INTERRUPTED');}
 }
 engine=new (require('../recovery/engine').Recovery)(v.db);const result=await engine.apply({request:v['request-id'],target:v.target,action:v.action,snapshot:v.snapshot});out.write(JSON.stringify(result)+'\n');return result.state==='succeeded'?0:3;
 }catch(e){const code=REASONS.includes(e?.code)?e.code:REASONS.includes(e?.message)?e.message:e?.code==='OPS_AUDIT_FAILED'?'AUDIT_UNAVAILABLE':'RECOVERY_FAILED';err.write(JSON.stringify({error:code,...(code==='AUDIT_UNAVAILABLE'?{storageCode:Number.isInteger(e.storageCode)?e.storageCode:0,diagnostic:['request_claim','inbox_state','inbox_audit','outcome','journal_storage'].includes(e.diagnostic)?e.diagnostic:'journal_storage'}:{})})+'\n');return 2;}finally{reader?.close();engine?.close();supervisor?.close();}}
module.exports={main};
