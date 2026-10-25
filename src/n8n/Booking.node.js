'use strict';
const {BookingStore}=require('../booking/store');const {Coordinator}=require('../booking/coordinator');
class Booking {
 constructor(){this.description={displayName:'Verified Booking',name:'booking',group:['transform'],version:1,defaults:{name:'Verified Booking'},inputs:['main'],outputs:['main'],credentials:[{name:'googleCalendarOAuth2Api',required:false},{name:'googleSheetsOAuth2Api',required:false},{name:'httpHeaderAuth',required:false}],properties:[{displayName:'Observability',name:'observability',type:'boolean',default:false},{displayName:'Action',name:'action',type:'string',default:'execute'},{displayName:'Database',name:'database',type:'string',default:'/inbox/inbox.sqlite'},{displayName:'Authorized Booking Snapshot',name:'snapshot',type:'json',default:{}},{displayName:'Claim',name:'claim',type:'json',default:{}},{displayName:'Proposal',name:'proposal',type:'json',default:{}},{displayName:'Policy',name:'policy',type:'json',default:{}},{displayName:'HTTP Configuration',name:'httpConfig',type:'json',default:{}},{displayName:'Expected Projection Revision',name:'revision',type:'number',default:-1},{displayName:'Adapter',name:'adapter',type:'string',default:'unconfigured'}]};}
 async execute(){const out=[];for(let i=0;i<this.getInputData().length;i++){
 const store=new BookingStore(this.getNodeParameter('database',i)),claim=this.getNodeParameter('claim',i),action=this.getNodeParameter('action',i);
 try{
  if(this.getNodeParameter('observability',i,false))require('../operations/runtime').attach(store,{message:claim});
  if(action==='profile'){require('../booking/profile').preserveProfile(store,claim.channel+':'+this.getNodeParameter('proposal',i).Lead_Phone,this.getNodeParameter('proposal',i));out.push({json:this.getInputData()[i].json,pairedItem:{item:i}});continue;}
  if(action==='context'){const row={...this.getInputData()[i].json};if(row.error)throw Error('CUSTOMER_LOOKUP_FAILED');if(Object.keys(row).length&&(!row.Phone||String(row.Phone).replace(/\D/g,'')!==this.getNodeParameter('proposal',i).Lead_Phone))throw Error('CUSTOMER_IDENTITY_MISMATCH');const cached=store.profile(claim.channel+':'+this.getNodeParameter('proposal',i).Lead_Phone);if(Object.keys(cached).length){Object.assign(row,cached);row.Phone=this.getNodeParameter('proposal',i).Lead_Phone;}const b=store.current(claim.channel+':'+this.getNodeParameter('proposal',i).Lead_Phone);
   if(b){row._booking_snapshot={id:b.id,version:b.version};if(['Requires Manual Call','Required Manual Call'].includes(row.Lead_Status)&&!row.Handoff_Status)row.Handoff_Status='Requested';if(b.state==='confirmed'&&row.Lead_Status!=='Not Interested'&&require('../state-profile').stateProfileRules().leadState(row.Lead_Status)!==null)row.Lead_Status='Qualified';row.Phone=this.getNodeParameter('proposal',i).Lead_Phone;const parts=ms=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:this.getNodeParameter('policy',i).timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(p=>[p.type,p.value]));const t=b.start?parts(b.start):null;Object.assign(row,{Booking_Status:b.state==='confirmed'?'Confirmed - Calendar Created':b.state==='cancelled'?'Cancelled':'Uncertain - Staff Review',Calendar_Event_ID:b.event||'',Booking_Date:t?`${t.year}-${t.month}-${t.day}`:'',Booking_Time:t?`${t.hour}:${t.minute}`:''});}
   else if(row.Calendar_Event_ID)row.Booking_Status='Unverified Legacy Booking';
   out.push({json:row,pairedItem:{item:i}});continue;
  }
  let provider;
  if(this.getNodeParameter('adapter',i)==='http'){
   const {HttpProvider}=require('../booking/http-provider');
   provider=new HttpProvider(async(service,method,path,body,headers={})=>{
    const credential={calendar:'googleCalendarOAuth2Api',sheets:'googleSheetsOAuth2Api',whapi:'httpHeaderAuth'}[service];
    const base={calendar:'https://www.googleapis.com',sheets:'https://sheets.googleapis.com',whapi:'https://gate.whapi.cloud'}[service];
    const r=await this.helpers.httpRequestWithAuthentication.call(this,credential,{method,url:base+path,body,headers,json:true,returnFullResponse:true,ignoreHttpStatusErrors:true,timeout:15000});
    return {status:r.statusCode,body:r.body};
   },this.getNodeParameter('httpConfig',i));
  }else if(this.getNodeParameter('adapter',i)==='isolated-mock'&&process.env.HARNESS_STATE_PATH){
   const state=JSON.parse(require('fs').readFileSync(process.env.HARNESS_STATE_PATH));
   const {BookingProvider}=require('../BookingProvider');provider=new BookingProvider(store,state.current.bookingFaults||{});if(process.env.BOOKING_RECOVERY_WORKER)provider=require('../recovery/evidence').wrap(provider,store,state.current.bookingFaults||{});
  }else throw Error('BOOKING_ADAPTER_UNCONFIGURED');
  const coordinator=new Coordinator(store,provider,this.getNodeParameter('policy',i));
  let result;if(action==='reconcile'){const pending=store.snapshot().booking_operations.find(o=>['uncertain','dispatched'].includes(o.status));result=pending?await coordinator.reconcile(pending.id):{outcome:'missing'};}
  else if(action==='projection'){result={outcome:await coordinator.project(claim.channel+':'+this.getNodeParameter('proposal',i).Lead_Phone,this.getNodeParameter('revision',i)<0?undefined:this.getNodeParameter('revision',i))};}
  else result=await coordinator.execute(this.getNodeParameter('proposal',i),claim,this.getNodeParameter('snapshot',i));
  out.push({json:result,pairedItem:{item:i}});
 }finally{store.close();}}
 return [out];}
}
module.exports={Booking};
