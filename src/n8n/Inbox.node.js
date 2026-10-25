'use strict';
const {Inbox}=require('../inbox/sqlite');
class InboxNode {
 constructor(){this.description={displayName:'Durable Inbox',name:'inbox',group:['transform'],version:1,defaults:{name:'Durable Inbox'},inputs:['main'],outputs:['main','main'],properties:[
  {displayName:'Database Path',name:'database',type:'string',default:'/inbox/inbox.sqlite'},
  {displayName:'Action',name:'action',type:'string',default:'claim'},
  {displayName:'Claim',name:'claim',type:'json',default:{}},
  {displayName:'Operation',name:'operation',type:'string',default:''},
 ]};}
 async execute(){const accepted=[],blocked=[];
  for(let i=0;i<this.getInputData().length;i++){
   const item=this.getInputData()[i],action=this.getNodeParameter('action',i),db=new Inbox(this.getNodeParameter('database',i));
   try{
    if(action==='claim'){
     const result=db.claim(item.json.envelope);
     if(result.status==='claimed')accepted.push({json:{...item.json,_inbox:result.token},pairedItem:{item:i}});
     else blocked.push({json:{inbox_outcome:result.status},pairedItem:{item:i}});
    }else{
     const token=this.getNodeParameter('claim',i),op=this.getNodeParameter('operation',i);
     if(action==='begin')db.begin(token,op);
     else if(action==='complete'){
      if(!db.completeOperation(token,op,!!item.json.error)){blocked.push({json:{inbox_outcome:'uncertain'},pairedItem:{item:i}});continue;}
     }else if(action==='finish')db.finish(token);
     else throw Error('UNSUPPORTED_INBOX_ACTION');
     accepted.push({json:item.json,pairedItem:{item:i}});
    }
   }finally{db.close();}
  }
  return [accepted,blocked];
 }
}
module.exports={Inbox:InboxNode};
