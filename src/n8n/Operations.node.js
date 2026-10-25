'use strict';
const {DatabaseSync}=require('node:sqlite');const {Observer}=require('../operations/store');
class Operations {
 constructor(){this.description={displayName:'Operational Observation',name:'operations',group:['transform'],version:1,defaults:{name:'Operational Observation'},inputs:['main'],outputs:['main'],properties:[{displayName:'Action',name:'action',type:'string',default:'validation'},{displayName:'Database',name:'database',type:'string',default:'/inbox/inbox.sqlite'},{displayName:'Claim',name:'claim',type:'json',default:{}}]};}
 async execute(){const output=[];for(let i=0;i<this.getInputData().length;i++){
  const item=this.getInputData()[i],claim=this.getNodeParameter('claim',i),action=this.getNodeParameter('action',i);const db=new DatabaseSync(this.getNodeParameter('database',i));db.exec('PRAGMA busy_timeout=1500; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');try{
   const observer=new Observer(db,{message:claim});let ref;
   if(action==='ai-start'||action==='ai-end'){observer.tx(()=>{ref=observer.transition('ai',[claim.provider,claim.channel,claim.id],action==='ai-start'?'started':item.json.error?'failed':'completed',action==='ai-end'&&item.json.error?'UNCLASSIFIED':'NONE');});}
   else if(action==='validation'){observer.tx(()=>{ref=observer.transition('validation',[claim.provider,claim.channel,claim.id],item.json.authorized===true?'completed':'rejected',item.json.authorized===true?'NONE':'VALIDATION_REJECTED');});}
   else if(action==='trace'){observer.tx(()=>{ref=observer.link('message',[claim.provider,claim.channel,claim.id]);});}
   else throw Error('OPS_ACTION_NOT_SUPPORTED');
   output.push({json:{...item.json,_ops:{ref}},pairedItem:{item:i}});
  }finally{db.close();}
 }return [output];}
}
module.exports={Operations};
