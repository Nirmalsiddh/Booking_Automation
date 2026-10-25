'use strict';
const crypto=require('node:crypto');
const DEFAULTS={provider:'whapi',channel:'fitness-studio',maxBytes:65536,maxMessages:20,maxText:2000};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9._:@+-]{1,160}$/.test(x);
function authenticate(headers,config){
 const expected=config?.secret,actual=headers?.['x-booking-webhook-key'];
 if(typeof expected!=='string'||expected.length<32)return {status:503,code:'authentication_unconfigured'};
 if(typeof actual!=='string'||actual.length>256)return {status:401,code:'unauthorized'};
 const hash=s=>crypto.createHash('sha256').update(s).digest();
 if(!crypto.timingSafeEqual(hash(expected),hash(actual)))return {status:401,code:'unauthorized'};
 return null;
}
function boundary(raw,headers,settings,inbox){
 const config={...DEFAULTS,...settings};const auth=authenticate(headers,config);if(auth)return {...auth,items:[]};
 if(!validId(config.provider)||!validId(config.channel)||!Number.isInteger(config.maxBytes)||config.maxBytes<1||!Number.isInteger(config.maxMessages)||config.maxMessages<1)return {status:503,code:'invalid_configuration',items:[]};
 if(typeof headers['content-type']!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type']))return {status:415,code:'unsupported_content_type',items:[]};
 if(!Buffer.isBuffer(raw)||raw.length>config.maxBytes)return {status:413,code:'payload_too_large',items:[]};
 let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return {status:400,code:'invalid_json',items:[]};}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return {status:400,code:'invalid_envelope',items:[]};
 if(!Array.isArray(payload.messages)){
  if(Array.isArray(payload.statuses)&&payload.statuses.length)return {status:200,code:'ignored_receipts',items:[],ignored:payload.statuses.length,rejected:0};
  return {status:400,code:'invalid_envelope',items:[]};
 }
 if(!payload.messages.length||payload.messages.length>config.maxMessages)return {status:400,code:'invalid_batch',items:[]};
 const items=[];let ignored=0,rejected=0,conflicts=0;
 for(const m of payload.messages){
  if(!m||typeof m!=='object'||Array.isArray(m)){rejected++;continue;}
  if(m.from_me===true){ignored++;continue;}
  if(m.from_me!==false||m.type!=='text'||!validId(m.id)||typeof m.from!=='string'||!/^\+?[1-9]\d{6,14}(?:@s\.whatsapp\.net)?$/.test(m.from)||typeof m.text?.body!=='string'||!m.text.body.trim()||m.text.body.length>config.maxText||/[\x00-\x08\x0b-\x1f\x7f]/.test(m.text.body)){rejected++;continue;}
  const name=m.from_name??m.push_name??'';
  if(typeof name!=='string'||name.length>120||/[\x00-\x1f\x7f]/.test(name)){rejected++;continue;}
  const phone=m.from.replace('@s.whatsapp.net','').replace(/^\+/,'');
  const message={id:m.id,from:phone,from_name:name,from_me:false,type:'text',text:{body:m.text.body}};
  // Display name is mutable provider metadata, deliberately excluded from immutable digest.
  const digest=crypto.createHash('sha256').update(JSON.stringify([phone,'text',m.text.body])).digest('hex');
  const envelope={provider:config.provider,channel:config.channel,id:m.id,digest};
  if(inbox&&inbox.receive(envelope).status==='conflict'){conflicts++;continue;}
  items.push({body:{messages:[message]},envelope});
 }
 return {status:items.length?202:conflicts?409:rejected?422:200,code:items.length?'accepted':conflicts?'identifier_conflict':rejected?'invalid_events':'ignored_events',items,ignored,rejected,conflicts};
}
// The same bounded HTTP boundary is used by isolated tests and can front a private dispatcher.
function handler(config,inbox,dispatch){return async(req,res)=>{
 const auth=authenticate(req.headers,config);
 if(auth){res.writeHead(auth.status);res.end(JSON.stringify({code:auth.code}));return;}
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}
 const limit=config.maxBytes||DEFAULTS.maxBytes;let size=0;const chunks=[];
 try{
  for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413);res.end('{"code":"payload_too_large"}');req.resume();return;}chunks.push(chunk);}
  const result=boundary(Buffer.concat(chunks),req.headers,config,inbox);
  // Never return/log headers, raw payload, or authentication configuration.
  if(result.items.length)await dispatch(result.items);
  res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify({code:result.code,accepted:result.items.length,ignored:result.ignored||0,rejected:result.rejected||0}));
 }catch{res.writeHead(503);res.end('{"code":"processing_unavailable"}');}
};}
module.exports={boundary,authenticate,handler,DEFAULTS};
