'use strict';
const {boundary,authenticate}=require('../webhook-boundary');
const {Inbox}=require('../inbox/sqlite');
class SecureWebhook {
 constructor(){this.description={displayName:'Authenticated Booking Webhook',name:'secureWebhook',group:['trigger'],version:1,defaults:{name:'Webhook - WHAPI Inbound'},inputs:[],outputs:['main'],credentials:[{name:'httpHeaderAuth',required:true}],webhooks:[{name:'default',httpMethod:'POST',responseMode:'onReceived',path:'={{$parameter.path}}'}],properties:[
  {displayName:'Path',name:'path',type:'string',default:'booking-inbox'},
  {displayName:'Trusted Channel',name:'channel',type:'string',default:'fitness-studio'},
  {displayName:'Inbox Database',name:'database',type:'string',default:'/inbox/inbox.sqlite'},
  {displayName:'Maximum Bytes',name:'maxBytes',type:'number',default:65536},
 ]};}
 async webhook(context=this){
  const req=context.getRequestObject(),res=context.getResponseObject();let credentials;
  try{credentials=await context.getCredentials('httpHeaderAuth');}catch{}
  const config={secret:credentials?.name?.toLowerCase()==='x-booking-webhook-key'?credentials.value:undefined,channel:context.getNodeParameter('channel'),maxBytes:context.getNodeParameter('maxBytes')};
  const auth=authenticate(req.headers,config);
  if(auth){res.statusCode=auth.status;res.end(JSON.stringify({code:auth.code}));return {noWebhookResponse:true};}
  let db;
  try{
   if(!req.rawBody)await req.readRawBody();
   db=new Inbox(context.getNodeParameter('database'));
   const result=boundary(req.rawBody,req.headers,config,db);
   res.statusCode=result.status;res.end(JSON.stringify({code:result.code,accepted:result.items.length,rejected:result.rejected||0,ignored:result.ignored||0}));
   return {noWebhookResponse:true,workflowData:[result.items.map(json=>({json}))]};
  }catch{res.statusCode=503;res.end('{"code":"boundary_unavailable"}');return {noWebhookResponse:true};}
  finally{db?.close();}
 }
}
module.exports={SecureWebhook};
