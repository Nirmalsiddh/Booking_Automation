'use strict';
// Normalized transport contracts. Context is trusted dispatch metadata, never model output.
function calendar(context,response){
 const uncertain={status:'uncertain'};
 if(!response||response.error||response.timeout)return uncertain;
 if(response.rejected===true&&response.requestId===context.operation&&response.noEffect===true)return {status:'failed'};
 if(response.requestId!==context.operation||response.calendar!==context.calendar)return uncertain;
 if(context.action==='delete')return response.deletedId===context.eventId&&response.absenceVerified===true?{status:'succeeded',eventId:context.eventId}:uncertain;
 const e=response.event;
 if(!e||e.id!==context.eventId||e.status!=='confirmed'||Date.parse(e.start)!==context.start||Date.parse(e.end)!==context.end)return uncertain;
 return {status:'succeeded',eventId:e.id};
}
function projection(context,response){return response?.requestId===context.id&&response.customer===context.customer&&response.revision===context.revision&&response.verifiedPayload===context.payload?{status:'succeeded'}:response?.requestId===context.id&&response.rejected===true&&response.noEffect===true?{status:'failed'}:{status:'uncertain'};}
function notification(context,response){return response?.requestId===context.id&&response.accepted===true&&typeof response.messageId==='string'&&response.messageId.length>0&&response.recipient===context.recipient?{status:'succeeded',receipt:response.messageId}:response?.requestId===context.id&&response.rejected===true&&response.noEffect===true?{status:'failed'}:{status:'uncertain'};}
module.exports={calendar,projection,notification};
