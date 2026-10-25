'use strict';
const fs=require('node:fs'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto'),http=require('node:http');
const {Inbox}=require('./inbox/sqlite');
const {handler}=require('./webhook-boundary');
const {scenarios,message,ai}=require('./scenarios-milestone6');
const variant='milestone6';
const N8N='/opt/runtime/node_modules/n8n/bin/n8n';
const env={PATH:'/usr/bin',HOME:'/data',N8N_CUSTOM_EXTENSIONS:'/harness/custom',N8N_DIAGNOSTICS_ENABLED:'false',N8N_VERSION_NOTIFICATIONS_ENABLED:'false',N8N_TEMPLATES_ENABLED:'false',N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS:'true',GENERIC_TIMEZONE:'Asia/Dubai',TZ:'Asia/Dubai',N8N_RUNNERS_BROKER_LISTEN_ADDRESS:'127.0.0.1'};
function generate() {
  if(!['milestone6'].includes(variant))throw new Error('Unknown workflow variant');
  const source=fs.readFileSync(variant==='baseline'?'/baseline/workflow.json':`/baseline/${variant}.json`);
  const w=JSON.parse(source);
  w.nodes=w.nodes.filter(n=>n.type!=='n8n-nodes-base.scheduleTrigger');delete w.connections['Outreach - Scheduler Tick'];
  const memory=w.nodes.find(n=>n.name==='Memory - Per Phone').parameters.sessionKey;
  const manifest=[];
  const kinds={'n8n-nodes-base.webhook':'inbound','n8n-nodes-base.googleSheets':'sheet',
    'n8n-nodes-base.googleCalendar':'calendar','n8n-nodes-base.httpRequest':'outbound',
    '@n8n/n8n-nodes-langchain.agent':'ai','n8n-nodes-base.wait':'wait'};
  const inert=['@n8n/n8n-nodes-langchain.lmChatGoogleGemini','@n8n/n8n-nodes-langchain.memoryBufferWindow'];
  const allowed=['n8n-nodes-base.code','n8n-nodes-base.set','n8n-nodes-base.merge','n8n-nodes-base.switch','n8n-nodes-base.if','n8n-nodes-base.noOp','n8n-nodes-base.splitInBatches','CUSTOM.inbox','CUSTOM.booking','CUSTOM.outreach'];
  for(const n of w.nodes){
    const old=n.type;
    delete n.credentials; delete n.webhookId;
    if(old==='CUSTOM.secureWebhook'){n.type='CUSTOM.harnessIngress';n.typeVersion=1;n.parameters={action:'receive'};} else if(kinds[old]) {
      n.parameters={kind:kinds[old],mockParams:n.parameters};
      if(kinds[old]==='ai')n.parameters.mockParams.harnessSessionKey=memory;
      n.type='CUSTOM.mock4'; n.typeVersion=1;
    } else if(inert.includes(old)) {n.type='n8n-nodes-base.noOp';n.typeVersion=1;n.parameters={};}
    else if(!allowed.includes(old)) throw new Error(`Unsafe/unrecognized node: ${old}`);
    if(old==='CUSTOM.outreach'){n.parameters.database="={{ '/inbox/booking-' + $('Inbox - Claim').item.json._inbox.channel + '.sqlite' }}";n.parameters.adapter='isolated-mock';}
    if(old==='CUSTOM.booking'){n.parameters.database="={{ '/inbox/booking-' + $('Inbox - Claim').item.json._inbox.channel + '.sqlite' }}";n.parameters.adapter='isolated-mock';}
    manifest.push({name:n.name,originalType:old,testType:n.type});
  }
  // Preserve all main edges; only model/memory wiring is deliberately replaced by scripted output.
  for(const outputs of Object.values(w.connections))
    for(const kind of Object.keys(outputs)) if(kind!=='main') delete outputs[kind];
  w.nodes.push({id:'harness-start',name:'Harness - Start',type:'n8n-nodes-base.manualTrigger',typeVersion:1,parameters:{},position:[0,0]});
  w.connections['Harness - Start']={main:[[{node:'Webhook - WHAPI Inbound',type:'main',index:0}]]};
  w.nodes.push({id:'fault-control',name:'Harness - Fault Control',type:'CUSTOM.harnessIngress',typeVersion:1,position:[0,0],parameters:{action:'control'}});
  w.connections['Inbox - Claim'].main[0]=[{node:'Harness - Fault Control',type:'main',index:0}];
  w.connections['Harness - Fault Control']={main:[[{node:'Normalizer - WHAPI Payload',type:'main',index:0}]]};
  require('./warm-runner').warmRunner(w);
  manifest.push({name:'Harness - Initialize JS Runner',originalType:null,testType:'n8n-nodes-base.code',reason:'Pinned CLI runtime initialization barrier'});
  w.id='offlineBaseline'; w.name='OFFLINE ONLY - Fitness Studio Baseline';w.active=false;
  w.pinData={};w.meta={};w.tags=[];
  fs.writeFileSync('/data/test-workflow.json',JSON.stringify(w,null,2));
  fs.writeFileSync('/data/transform-manifest.json',JSON.stringify({
    sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),nodes:manifest,
    unsupported:['Real webhook HTTP/authentication','Real Gemini generation and native agent execution',
      'Native conversation memory persistence','Provider SDK/HTTP behavior','Native Wait resume/restart behavior'],
  },null,2));
}
async function isolation() {
  const interfaces=Object.entries(os.networkInterfaces());
  if(interfaces.some(([name])=>name!=='lo'))throw new Error('Non-loopback network interface found');
  if(fs.readFileSync('/proc/net/route','utf8').trim().split('\n').length!==1)throw new Error('Network route exists');
  const credentials=Object.keys(process.env).filter(k=>/TOKEN|SECRET|API_KEY|GOOGLE|WHAPI|GEMINI/i.test(k));
  if(credentials.length)throw new Error('Unexpected credential-like environment names');
  const failures=[];
  for(const target of [{host:'198.51.100.1',port:443},{host:'2001:db8::1',port:443}]) {
    const error=await new Promise((resolve,reject)=>{
      const s=require('node:net').createConnection(target);
      s.setTimeout(1000,()=>{s.destroy();reject(new Error('Network probe inconclusive: timeout'));});
      s.on('connect',()=>{s.destroy();reject(new Error('Unexpected external connectivity'));});
      s.on('error',e=>resolve(e.code));
    });
    if(!['ENETUNREACH','EHOSTUNREACH','EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error))throw new Error(`Unexpected network error ${error}`);
    failures.push({...target,error});
  }
  fs.writeFileSync('/data/isolation.json',JSON.stringify({interfaces:interfaces.map(([n])=>n),noRoutes:true,probes:failures,credentialsPassed:false},null,2));
}
const initialized=new Set();let execId=0;const reports=[];
function command(args,slot,extra={}){return new Promise((resolve,reject)=>{
 const startedAt=Date.now();const child=cp.spawn('/usr/bin/node',[N8N,...args],{env:{...env,N8N_USER_FOLDER:'/data/n8n-'+slot,N8N_RUNNERS_BROKER_PORT:String(5700+slot),...extra}});
 let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
 child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);
 child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr,startedAt,finishedAt:Date.now()});});
});}
async function initialize(slot){if(initialized.has(slot))return;const r=await command(['import:workflow','--input=/data/test-workflow.json'],slot);if(r.code!==0)throw Error('IMPORT_FAILED');initialized.add(slot);}
function stateFor(s){return {rows:structuredClone(s.rows||{}),events:structuredClone(s.events||{}),eventSequence:0,messages:[],calls:[],clock:Date.parse('2030-06-01T08:00:00+04:00'),turn:0};}
async function submit(t,s,stateFile,slot,db){
 await initialize(slot);const id=++execId,dir=`/data/evidence/${s.id}`;fs.mkdirSync(dir,{recursive:true});
 const state=JSON.parse(fs.readFileSync(stateFile));if(t.at)state.clock=Date.parse(t.at);state.current={...t,database:'/inbox/booking-'+s.id+'.sqlite',customer:s.id+':15555550101'};delete state.current.auth;delete state.current.raw;delete state.current.contentType;state.turn=(state.turn||0)+1;state.injected=false;fs.writeFileSync(stateFile,JSON.stringify(state));
 let execution=null;
 const server=http.createServer(handler({secret:s.unconfigured?undefined:'synthetic-test-key-not-a-real-secret',channel:s.id},db,async items=>{
  const request=`/data/request-${id}.json`;fs.writeFileSync(request,JSON.stringify(items));
  if(t.operator)await operatorWorkflow(s.id,t,slot);
  const result=await command(['execute','--id='+ (t.operator?'offlineOperator':'offlineBaseline'),'--rawOutput'],slot,{HARNESS_STATE_PATH:stateFile,HARNESS_REQUEST_PATH:request});
  const found=result.stdout.match(/^\{/m);let output;
  if(found)try{output=JSON.parse(result.stdout.slice(found.index));}catch{}
  fs.writeFileSync(`${dir}/execution-${id}.log`,result.stdout+'\n'+result.stderr);
  execution={startedAt:result.startedAt,finishedAt:result.finishedAt,result:output?.data?.resultData?.runData?.['Operator - Outreach']?.[0]?.data?.main?.[0]?.[0]?.json,status:output?.status||'interrupted',exitCode:result.code,signal:result.signal,executedNodes:Object.keys(output?.data?.resultData?.runData||{})};
  fs.writeFileSync(`${dir}/execution-${id}.meta.json`,JSON.stringify(execution,null,2));
  if(t.outreachCrash){if(result.signal!=='SIGKILL')throw Error('EXPECTED_OUTREACH_INTERRUPTION');return;}
  if(t.crashBefore||t.crashAfter||t.m5Crash){
   if(result.signal!=='SIGKILL')throw Error('EXPECTED_WORKER_INTERRUPTION');
   // Child close above proves the worker was terminated and joined, not just lease expiry.
   const record=db.snapshot().messages.find(m=>m.channel===s.id&&m.status==='processing');
   if(!record)throw Error('MISSING_INTERRUPTED_CLAIM');
   db.recoverStoppedOwner({provider:record.provider,channel:record.channel,id:record.message_id,digest:record.digest,owner:record.owner},'worker_terminated_and_joined');
   return;
  }
  if(result.code!==0||output?.status!=='success')throw Error('N8N_EXECUTION_FAILED');
 }));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let response;
 try{
  const headers={'content-type':t.contentType||'application/json'};
  if(t.auth!==null)headers['x-booking-webhook-key']=t.auth||'synthetic-test-key-not-a-real-secret';
  response=await fetch(`http://127.0.0.1:${server.address().port}/`,{method:'POST',headers,body:t.raw??JSON.stringify(t.body)});
  await response.text();
 }finally{await new Promise(r=>server.close(r));}
 if(response.status===503&&!s.unconfigured)throw Error(`DISPATCH_FAILED ${s.id}; inspect ${dir}`);
 return {http:response.status,execution};
}
async function runScenario(s,db){
 if(s.seed)await seed(s);
 setup(s);
 const states=[];const dir=`/data/evidence/${s.id}`;fs.mkdirSync(dir,{recursive:true});
 const files=s.concurrent?s.turns.map((_,i)=>`/data/state-${s.id}-${i}.json`):[`/data/state-${s.id}.json`];
 for(const file of files)fs.writeFileSync(file,JSON.stringify(stateFor(s)));
 let outcomes;
 if(s.concurrent){await initialize(1);await initialize(2);outcomes=await Promise.all(s.turns.map((t,i)=>submit(t,s,files[i],i+1,db)));}
 else{outcomes=[];for(const t of s.turns){if(t.parallel){await initialize(1);await initialize(2);const pf=t.parallel.map((_,i)=>`/data/state-${s.id}-parallel-${i}.json`);for(const f of pf)fs.copyFileSync(files[0],f);outcomes.push(...await Promise.all(t.parallel.map((step,i)=>submit(step,s,pf[i],i+1,db))));}else outcomes.push(await submit(t,s,files[0],0,db));}}
 for(const file of files)states.push(JSON.parse(fs.readFileSync(file)));
 const final=states.length===1?states[0]:{...states[0],calls:states.flatMap(x=>x.calls),messages:states.flatMap(x=>x.messages),rows:Object.assign({},...states.map(x=>x.rows)),events:Object.assign({},...states.map(x=>x.events))};
 final.http=outcomes.map(x=>x.http);final.executions=outcomes.map(x=>x.execution).filter(Boolean);
 const snapshot=db.snapshot();final.inbox={messages:snapshot.messages.filter(m=>m.channel===s.id),operations:snapshot.operations.filter(m=>m.channel===s.id)};
 const {BookingStore}=require('./booking/store');const bs=new (require('./outreach/store').OutreachStore)('/inbox/booking-'+s.id+'.sqlite');final.booking=bs.snapshot();final.outreach=bs.snapshotOutreach();final.remoteOutreach=bs.db.prepare('SELECT * FROM mock_outreach_remote').all();
 final.provider=bs.db.prepare("SELECT name FROM sqlite_master WHERE name='mock_calls'").get()?bs.db.prepare('SELECT * FROM mock_calls').all():[];
 final.remoteEvents=bs.db.prepare("SELECT name FROM sqlite_master WHERE name='mock_events'").get()?bs.db.prepare('SELECT * FROM mock_events').all():[];final.remoteSheets=bs.db.prepare("SELECT name FROM sqlite_master WHERE name='mock_sheets'").get()?bs.db.prepare('SELECT * FROM mock_sheets').all():[];bs.close();
 const checks=s.checks.map(c=>({name:c.name,status:c.test(final,final.executions)?'PASS':'FAIL',knownBaselineDefect:!!c.known}));
 const report={scenario:s.id,status:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',checks,runs:final.executions};
 fs.writeFileSync(dir+'/state.json',JSON.stringify(final,null,2));fs.writeFileSync(dir+'/result.json',JSON.stringify(report,null,2));
 console.log(report.status+' '+s.id);return report;
}
async function main(){
 if(fs.readFileSync('/inbox/.harness-marker','utf8')!=='booking-inbox-disposable-v1')throw Error('UNOWNED_VOLUME');
 await isolation();generate();
 const db=new Inbox('/inbox/inbox.sqlite');
 try{
  const phaseFile='/inbox/phase.json';
  if(fs.existsSync(phaseFile)){
   const phase=JSON.parse(fs.readFileSync(phaseFile));
   if(phase.phase!==1)throw Error('INVALID_RESTART_PHASE');
   fs.cpSync('/inbox/evidence','/data/evidence',{recursive:true});
   const s={id:'restart-pending',turns:[{body:message('after-restart'),operator:'tick',at:'2030-06-03T10:00:00+04:00'}],checks:[{name:'Pending outreach survives real container restart and sends once',test:x=>x.outreach.outreach_notifications.length===1&&x.outreach.outreach_notifications[0].status==='accepted'&&x.provider.filter(c=>c.kind==='promotion').length===1}]};
   const after=await runScenario(s,db);after.scenario='restart-execution';reports.push(...phase.reports,after);
  }else{
   const selected=process.argv[2]&&process.argv[2]!=='all'?scenarios.filter(s=>s.id===process.argv[2]):scenarios;
   if(!selected.length)throw Error('UNKNOWN_SCENARIO');
   for(const s of selected)reports.push(await runScenario(s,db));
   if(!selected.some(s=>s.id==='restart-pending'))await runScenario(scenarios.find(s=>s.id==='restart-pending'),db);
   fs.cpSync('/data/evidence','/inbox/evidence',{recursive:true});
   fs.writeFileSync(phaseFile,JSON.stringify({phase:1,reports}));
   fs.writeFileSync('/data/completion.json',JSON.stringify({exitCode:0,restart:true}));return;
  }
  fs.writeFileSync('/data/summary.json',JSON.stringify({variant:'milestone6',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync('/baseline/milestone6.json')).digest('hex'),scenarios:reports},null,2));
  fs.writeFileSync('/data/inbox-ledger.json',JSON.stringify(db.snapshot(),null,2));
  fs.writeFileSync('/inbox/phase.json',JSON.stringify({phase:2}));
  fs.writeFileSync('/data/completion.json',JSON.stringify({exitCode:0,restart:false}));
 }finally{db.close();}
}
main().catch(e=>{console.error(e.message);fs.writeFileSync('/data/completion.json',JSON.stringify({exitCode:2,restart:false}));}).finally(()=>setInterval(()=>{},1000));
async function operatorWorkflow(channel,t,slot){
 const w=JSON.parse(fs.readFileSync('/data/test-workflow.json')),n=structuredClone(w.nodes.find(n=>n.name==='Outreach - Process Due Job'));
 n.name='Operator - Outreach';n.parameters.database='/inbox/booking-'+channel+'.sqlite';n.parameters.claim={};n.parameters.source={};n.parameters.activity={};n.parameters.proposal={};n.parameters.action=t.operator;n.parameters.update=t.update||{};
 if(t.recoverInterrupted){const store=new (require('./outreach/store').OutreachStore)(n.parameters.database);try{const job=store.db.prepare("SELECT * FROM outreach_jobs WHERE status='dispatched'").get();if(!job)throw Error('MISSING_INTERRUPTED_JOB');n.parameters.update={id:job.id,owner:job.owner,proof:'worker_terminated_and_joined'};}finally{store.close();}}
 const start=w.nodes.find(n=>n.name==='Harness - Start');const barrier={id:'barrier',name:'Harness - Revocation Barrier',type:'CUSTOM.outreachControl',typeVersion:1,parameters:{},position:[0,0]};w.nodes=[start,barrier,n];w.connections={[start.name]:{main:[[{node:barrier.name,type:'main',index:0}]]},[barrier.name]:{main:[[{node:n.name,type:'main',index:0}]]}};require('./warm-runner').warmRunner(w);w.id='offlineOperator';fs.writeFileSync('/data/operator-'+slot+'.json',JSON.stringify(w));
 const r=await command(['import:workflow','--input=/data/operator-'+slot+'.json'],slot);if(r.code!==0)throw Error('OPERATOR_IMPORT_FAILED');
}
async function seed(s){
 const {BookingStore}=require('./booking/store'),{BookingProvider}=require('./BookingProvider');const store=new BookingStore('/inbox/booking-'+s.id+'.sqlite');store.resource('synthetic-assessment-room');const provider=new BookingProvider(store);
 try{for(const [i,slot] of (s.seedConflict?['2030-06-10','2030-06-11']:['2030-06-10']).entries()){
 const id='seed'+i,booking=i?'seed-other':'seed-booking',start=Date.parse(slot+'T10:00:00+04:00'),end=start+3600000,customer=s.id+':'+(i?'15555550102':'15555550101');
 store.prepare({id,booking,customer,resource:'synthetic-assessment-room',action:'create',start,end,version:0});store.dispatch(id);const c={operation:id,booking,action:'create',calendar:'synthetic-assessment-room',eventId:'seed-event-'+i,start,end};await provider.mutate(c);store.settle(id,{status:'succeeded',eventId:c.eventId});
 }}finally{store.close();}
}

function setup(s){
 const {OutreachStore}=require('./outreach/store'),{Scheduler}=require('./outreach/scheduler');const store=new OutreachStore('/inbox/booking-'+s.id+'.sqlite');try{
  new (require('./OutreachProvider').OutreachProvider)(store);
  if(s.consent){store.ensure(s.id+':15555550101','15555550101@s.whatsapp.net');store.consent({id:'fixture-consent',customer:s.id+':15555550101',status:s.consent,source:'synthetic_fixture',actor:'synthetic-test',evidence:'explicit synthetic fixture',occurred:Date.parse('2030-06-01T08:00:00+04:00'),expectedVersion:0},Date.parse('2030-06-01T08:00:00+04:00'));}
 }finally{store.close();}
}
