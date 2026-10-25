'use strict';
// All operation/request identity comes from the coordinator, not the response body.
class HttpProvider {
 constructor(request,config){this.request=request;this.config=config;if(new Set(Object.values(config.projectionRanges||{})).size!==Object.values(config.projectionRanges||{}).length)throw Error('DUPLICATE_PROJECTION_RANGE');if(!config.calendars||!Object.keys(config.calendars).length)throw Error('CALENDAR_MAPPING_REQUIRED');}
 calendarPath(c){const id=this.config.calendars[c.calendar];if(typeof id!=='string'||!id)throw Error('CALENDAR_MAPPING_REQUIRED');return '/calendar/v3/calendars/'+encodeURIComponent(id)+'/events';}
 async get(c){return this.request('calendar','GET',this.calendarPath(c)+'/'+encodeURIComponent(c.eventId));}
 event(c,e){if(!e||e.id!==c.eventId||e.extendedProperties?.private?.bookingId!==c.booking||e.extendedProperties?.private?.operationId!==c.operation||e.status!=='confirmed')return null;return {id:e.id,status:e.status,start:e.start?.dateTime,end:e.end?.dateTime};}
 base(c){return {requestId:c.operation,calendar:c.calendar};}
 rejected(c,r){const reason=r?.body?.error?.errors?.[0]?.reason;return [400,401,403,412].includes(r?.status)&&['badRequest','invalid','authError','forbidden','conditionNotMet'].includes(reason)?{...this.base(c),rejected:true,noEffect:true}:null;}
 async available(c){const q=new URLSearchParams({timeMin:new Date(c.start).toISOString(),timeMax:new Date(c.end).toISOString(),singleEvents:'true'});let next;
 for(let page=0;page<100;page++){if(next)q.set('pageToken',next);const r=await this.request('calendar','GET',this.calendarPath(c)+'?'+q);if(r.status!==200||!Array.isArray(r.body?.items))return false;
 for(const e of r.body.items){if(e.id===c.eventId||e.status==='cancelled')continue;if(e.start?.date||e.end?.date)return false;const a=Date.parse(e.start?.dateTime||e.start?.date),b=Date.parse(e.end?.dateTime||e.end?.date);if(!Number.isFinite(a)||!Number.isFinite(b)||a<c.end&&b>c.start)return false;}
 next=r.body.nextPageToken;if(!next)return true;}return false;}
 async mutate(c){const base=this.base(c),url=this.calendarPath(c);let before;
 if(c.action!=='create'){before=await this.get(c);if(before.status!==200||before.body?.id!==c.eventId||before.body.extendedProperties?.private?.bookingId!==c.booking)return {...base};}
 const body={start:{dateTime:new Date(c.start).toISOString()},end:{dateTime:new Date(c.end).toISOString()},extendedProperties:{private:{bookingId:c.booking,operationId:c.operation}}};
 const response=await this.request('calendar',c.action==='create'?'POST':c.action==='update'?'PATCH':'DELETE',url+(c.action==='create'?'':'/'+encodeURIComponent(c.eventId)),c.action==='delete'?undefined:{...body,...(c.action==='create'?{id:c.eventId}:{})},before?.body?.etag?{'If-Match':before.body.etag}:{});
 const rejection=this.rejected(c,response);if(rejection)return rejection;
 if(c.action==='delete'){
  if(response.status!==204)return base;const after=await this.get(c);
  const absent=after.status===404&&after.body?.error?.errors?.some(e=>e.reason==='notFound');
  const cancelled=after.status===200&&after.body?.id===c.eventId&&after.body?.status==='cancelled';
  return {...base,deletedId:c.eventId,absenceVerified:!!(absent||cancelled)};
 }
 if(![200,201].includes(response.status)||!this.event(c,response.body))return base;
 const after=await this.get(c);return {...base,event:after.status===200?this.event(c,after.body):null};
 }
 async observe(c){const r=await this.get(c);if(c.action==='delete')return {...this.base(c),deletedId:c.eventId,absenceVerified:r.status===200&&r.body?.id===c.eventId&&r.body?.status==='cancelled'&&r.body.extendedProperties?.private?.bookingId===c.booking};return {...this.base(c),event:r.status===200?this.event(c,r.body):null};}
 async project(c){const range=this.config.projectionRanges?.[c.customer],sheet=this.config.spreadsheetId;if(!range||!sheet)throw Error('PROJECTION_MAPPING_REQUIRED');
 const b=JSON.parse(c.payload),values=[[c.customer,String(c.revision),b.id,b.state,new Date(b.start).toISOString(),new Date(b.end).toISOString(),b.resource,b.event||'']];
 const path='/v4/spreadsheets/'+encodeURIComponent(sheet)+'/values/'+encodeURIComponent(range),r=await this.request('sheets','PUT',path+'?valueInputOption=RAW',{range,majorDimension:'ROWS',values});
 if([400,401,403].includes(r.status)&&['badRequest','invalid','authError','forbidden'].includes(r.body?.error?.errors?.[0]?.reason))return {requestId:c.id,rejected:true,noEffect:true};
 if(r.status!==200||r.body?.updatedRange!==range)return {requestId:c.id};
 const read=await this.request('sheets','GET',path);
 return read.status===200&&JSON.stringify(read.body?.values)===JSON.stringify(values)?{requestId:c.id,customer:c.customer,revision:c.revision,verifiedPayload:c.payload}:{requestId:c.id};
 }
 async notify(c){const r=await this.request('whapi','POST','/messages/text',{to:c.recipient,body:c.body}),b=r.body,m=b?.message||b;
 if([400,401,403].includes(r.status)&&b?.sent===false)return {requestId:c.id,rejected:true,noEffect:true};
 return {requestId:c.id,accepted:[200,201].includes(r.status)&&b?.sent===true,messageId:m?.id,recipient:m?.chat_id||m?.to};
 }
}
module.exports={HttpProvider};
