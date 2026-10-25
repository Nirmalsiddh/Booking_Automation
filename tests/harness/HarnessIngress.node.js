'use strict';
const fs=require('node:fs');const {Inbox}=require('../inbox/sqlite');
class HarnessIngress {
 constructor(){this.description={displayName:'Sanitized test ingress',name:'harnessIngress',group:['transform'],version:1,defaults:{name:'Test ingress'},inputs:['main'],outputs:['main'],properties:[{displayName:'Action',name:'action',type:'string',default:'receive'}]};}
 async execute(){
  if(this.getNodeParameter('action',0)==='receive')return [JSON.parse(fs.readFileSync(process.env.HARNESS_REQUEST_PATH)).map(json=>({json,pairedItem:{item:0}}))];
  const state=JSON.parse(fs.readFileSync(process.env.HARNESS_STATE_PATH));
  if(state.current.crashBefore)process.kill(process.pid,'SIGKILL');
  if(state.current.failBefore){const db=new Inbox('/inbox/inbox.sqlite');try{db.failBeforeEffects(this.getInputData()[0].json._inbox);}finally{db.close();}return [[]];}
  return [this.getInputData()];
 }
}
module.exports={HarnessIngress};
