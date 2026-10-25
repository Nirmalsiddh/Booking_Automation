'use strict';
// This boundary runs INSIDE the container. No artifact bytes leave until the
// entire selection has passed; failures return only a constant diagnostic.
const fs=require('node:fs'),path=require('node:path');
const names=['privacy.json','failure.json','evidence','completion.json','summary.json','isolation.json','transform-manifest.json'];
const forbidden=/CANARY|1555555|example\.test|source_key/;
const failure={validated:false,files:{'failure.json':Buffer.from('{"error":"EXPORT_PRIVACY_FAILURE"}\n').toString('base64')}};
function collect(root='/data',inbox='/inbox'){
 const {DatabaseSync}=require('node:sqlite');
 const secrets=[JSON.parse(fs.readFileSync(path.join(inbox,'.recovery-authority.json'),'utf8')).token];
 for(const name of fs.readdirSync(inbox).filter(n=>/^booking-.*\.sqlite$/.test(n))){
  const db=new DatabaseSync(path.join(inbox,name),{readOnly:true});
  try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ops_recovery_workers'").get())secrets.push(...db.prepare('SELECT secret FROM ops_recovery_workers').all().map(r=>r.secret));}finally{db.close();}
 }
 if(secrets.some(s=>typeof s!=='string'||!s.length))throw Error('EXPORT_PRIVACY_FAILURE');
 const files={};let total=0;
 function walk(file){
  const stat=fs.lstatSync(file);
  if(stat.isDirectory()){for(const n of fs.readdirSync(file))walk(path.join(file,n));return;}
  if(!stat.isFile())throw Error('EXPORT_PRIVACY_FAILURE');
  if(stat.size>128*1024*1024-total)throw Error('EXPORT_PRIVACY_FAILURE');
  const relative=path.relative(root,file);
  if(!relative.endsWith('.json')||forbidden.test(relative)||secrets.some(s=>relative.includes(s)))throw Error('EXPORT_PRIVACY_FAILURE');
  const data=fs.readFileSync(file);total+=data.length;
  const text=data.toString('utf8');
  if(total>128*1024*1024||forbidden.test(text)||secrets.some(s=>text.includes(s)))throw Error('EXPORT_PRIVACY_FAILURE');
  JSON.parse(text); // No raw logs, databases or other binary runtime artifacts.
  files[relative]=data.toString('base64');
 }
 for(const name of names){const file=path.join(root,name);if(fs.existsSync(file))walk(file);}
 return {validated:true,files};
}
function envelope(root,inbox){try{return collect(root,inbox);}catch{return failure;}}
if(require.main===module)process.stdout.write(JSON.stringify(envelope()));
module.exports={collect,envelope};
