'use strict';
const fs = require('node:fs');
const os = require('node:os');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {scenarios} = require('./scenarios');
const {scenariosFor} = require('./scenarios-milestone2');
const variant=process.argv[3] || 'baseline';
const N8N='/opt/runtime/node_modules/n8n/bin/n8n';
const env = {PATH:'/usr/bin', HOME:'/data', N8N_USER_FOLDER:'/data/n8n',
  N8N_CUSTOM_EXTENSIONS:'/harness/custom', N8N_DIAGNOSTICS_ENABLED:'false',
  N8N_VERSION_NOTIFICATIONS_ENABLED:'false', N8N_TEMPLATES_ENABLED:'false',
  N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS:'true', GENERIC_TIMEZONE:'Asia/Dubai', TZ:'Asia/Dubai',
  N8N_RUNNERS_BROKER_LISTEN_ADDRESS:'127.0.0.1',
};
function command(args, label) {
  const r=cp.spawnSync('/usr/bin/node',[N8N,...args],{env,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
  fs.writeFileSync(`/data/${label}.log`,r.stdout+'\n'+r.stderr);
  if(r.error) throw r.error;
  return r;
}
function generate() {
  if(!['baseline','milestone2','milestone3'].includes(variant))throw new Error('Unknown workflow variant');
  const source=fs.readFileSync(variant==='baseline'?'/baseline/workflow.json':`/baseline/${variant}.json`);
  const w=JSON.parse(source);
  const memory=w.nodes.find(n=>n.name==='Memory - Per Phone').parameters.sessionKey;
  const manifest=[];
  const kinds={'n8n-nodes-base.webhook':'inbound','n8n-nodes-base.googleSheets':'sheet',
    'n8n-nodes-base.googleCalendar':'calendar','n8n-nodes-base.httpRequest':'outbound',
    '@n8n/n8n-nodes-langchain.agent':'ai','n8n-nodes-base.wait':'wait'};
  const inert=['@n8n/n8n-nodes-langchain.lmChatGoogleGemini','@n8n/n8n-nodes-langchain.memoryBufferWindow'];
  const allowed=['n8n-nodes-base.code','n8n-nodes-base.set','n8n-nodes-base.merge','n8n-nodes-base.switch','n8n-nodes-base.if','n8n-nodes-base.noOp'];
  for(const n of w.nodes){
    const old=n.type;
    delete n.credentials; delete n.webhookId;
    if(kinds[old]) {
      n.parameters={kind:kinds[old],mockParams:n.parameters};
      if(kinds[old]==='ai')n.parameters.mockParams.harnessSessionKey=memory;
      n.type='CUSTOM.mock'; n.typeVersion=1;
    } else if(inert.includes(old)) {n.type='n8n-nodes-base.noOp';n.typeVersion=1;n.parameters={};}
    else if(!allowed.includes(old)) throw new Error(`Unsafe/unrecognized node: ${old}`);
    manifest.push({name:n.name,originalType:old,testType:n.type});
  }
  // Preserve all main edges; only model/memory wiring is deliberately replaced by scripted output.
  for(const outputs of Object.values(w.connections))
    for(const kind of Object.keys(outputs)) if(kind!=='main') delete outputs[kind];
  w.nodes.push({id:'harness-start',name:'Harness - Start',type:'n8n-nodes-base.manualTrigger',typeVersion:1,parameters:{},position:[0,0]});
  w.connections['Harness - Start']={main:[[{node:'Webhook - WHAPI Inbound',type:'main',index:0}]]};
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
function runScenario(scenario){
  const state={rows:structuredClone(scenario.rows||{}),events:structuredClone(scenario.events||{}),
    eventSequence:0,messages:[],calls:[],clock:Date.parse('2030-06-01T08:00:00+04:00'),turn:0};
  fs.writeFileSync('/data/state.json',JSON.stringify(state));
  const runs=[];
  for(const [i,t] of scenario.turns.entries()){
    const s=JSON.parse(fs.readFileSync('/data/state.json'));s.current=t;s.turn=i+1;s.injected=false;
    fs.writeFileSync('/data/state.json',JSON.stringify(s));
    const r=command(['execute','--id=offlineBaseline','--rawOutput'],`turn-${i+1}`);
    const match=r.stdout.match(/^\{/m);let execution;
    try {execution=JSON.parse(r.stdout.slice(match.index));} catch {throw new Error(`Missing execution result for turn ${i+1}`);}
    fs.writeFileSync(`/data/execution-${i+1}.json`,JSON.stringify(execution,null,2));
    const run={turn:i+1,exitCode:r.status,status:execution.status,
      executedNodes:Object.keys(execution.data?.resultData?.runData||{})};
    runs.push(run);
    if(execution.status!=='success')throw new Error(`Unexpected workflow execution failure in turn ${i+1}`);
  }
  const final=JSON.parse(fs.readFileSync('/data/state.json'));
  const checks=scenario.checks.map(c=>({name:c.name,status:c.test(final,runs)?'PASS':'FAIL',knownBaselineDefect:c.known}));
  const report={scenario:scenario.id,status:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',checks,runs};
  fs.writeFileSync('/data/result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  return report;
}
async function main(){
  if(fs.readdirSync('/data').length)throw new Error('Test data volume must start empty');
  fs.writeFileSync('/data/.harness-marker','booking-harness-disposable-v1',{flag:'wx'});
  await isolation(); // Must pass before workflow import or execution.
  const cases=variant==='milestone3'?require('./scenarios-milestone3').scenarios:process.argv[4]==='extended'?scenariosFor(variant):scenarios;
  const selected=process.argv[2]==='all'?cases:cases.filter(s=>s.id===process.argv[2]);
  if(!selected.length)throw new Error('Unknown scenario');
  generate();
  const imported=command(['import:workflow','--input=/data/test-workflow.json'],'import');
  if(imported.status!==0 || !imported.stdout.includes('Successfully imported 1 workflow'))throw new Error('Workflow import failed; inspect import.log');
  const reports=[];
  for(const scenario of selected){
    // Mock stores are reset for each scenario; n8n execution history is disposable and retained.
    for(const file of fs.readdirSync('/data'))
      if(/^(turn-|execution-|interleaved)/.test(file))fs.unlinkSync('/data/'+file);
    const report=runScenario(scenario);reports.push(report);
    const archive='/data/scenarios/'+scenario.id;
    fs.mkdirSync(archive,{recursive:true});
    for(const file of fs.readdirSync('/data'))
      if(fs.statSync('/data/'+file).isFile())fs.copyFileSync('/data/'+file,archive+'/'+file);
  }
  fs.writeFileSync('/data/result.json',JSON.stringify({scenarios:reports},null,2));
}
main().then(()=>{
  fs.writeFileSync('/data/completion.json',JSON.stringify({exitCode:0}));
}).catch(e=>{
  console.error(e.stack);
  fs.writeFileSync('/data/completion.json',JSON.stringify({exitCode:2}));
}).finally(()=>{
  // Keep tmpfs alive only until the host copies artifacts and removes this container.
  setInterval(()=>{},1000);
});
