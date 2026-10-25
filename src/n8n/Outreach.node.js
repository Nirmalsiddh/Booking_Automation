'use strict';
const {OutreachStore,hash}=require('../outreach/store');
const {Scheduler}=require('../outreach/scheduler');
class Outreach {
 constructor(){this.description={displayName:'State-aware Outreach',name:'outreach',group:['transform'],version:1,defaults:{name:'State-aware Outreach'},inputs:['main'],outputs:['main'],credentials:[{name:'httpHeaderAuth',required:false}],properties:[
  {displayName:'Action',name:'action',type:'string',default:'tick'},
  {displayName:'Database',name:'database',type:'string',default:'/inbox/inbox.sqlite'},
  {displayName:'Inbox Database',name:'inboxDatabase',type:'string',default:'/inbox/inbox.sqlite'},
  {displayName:'Claim',name:'claim',type:'json',default:{}},
  {displayName:'Source',name:'source',type:'json',default:{}},
  {displayName:'Activity',name:'activity',type:'json',default:{}},
  {displayName:'Proposal',name:'proposal',type:'json',default:{}},
  {displayName:'Rules',name:'rules',type:'json',default:{}},
  {displayName:'Trusted Operator Update',name:'update',type:'json',default:{}},
  {displayName:'Adapter',name:'adapter',type:'string',default:'unconfigured'}
 ]};}
 async execute(){const out=[];for(let i=0;i<this.getInputData().length;i++){
  const store=new OutreachStore(this.getNodeParameter('database',i));
  try{
   const action=this.getNodeParameter('action',i),adapter=this.getNodeParameter('adapter',i);let clock=Date.now,provider={notify:async()=>{throw Error('OUTREACH_ADAPTER_UNCONFIGURED');}};
   if(adapter==='isolated-mock'&&process.env.HARNESS_STATE_PATH){const state=JSON.parse(require('fs').readFileSync(process.env.HARNESS_STATE_PATH));clock=()=>state.clock;provider=new (require('../OutreachProvider').OutreachProvider)(store,state.current.outreachFaults||{});}
   if(adapter==='http'){provider={notify:async c=>{const r=await this.helpers.httpRequestWithAuthentication.call(this,'httpHeaderAuth',{method:'POST',url:'https://gate.whapi.cloud/messages/text',body:{to:c.recipient,body:c.body},json:true,returnFullResponse:true,ignoreHttpStatusErrors:true,timeout:15000});if(r.statusCode>=200&&r.statusCode<300&&r.body?.sent===true&&typeof r.body.message?.id==='string'&&r.body.message?.to===c.recipient)return {requestId:c.id,accepted:true,messageId:r.body.message.id,recipient:c.recipient};return {requestId:c.id};}};}
   const scheduler=new Scheduler(store,provider,this.getNodeParameter('rules',i),clock),input=this.getInputData()[i].json;
   let result;
   if(['inbound','engagement','schedule'].includes(action)){
    const claim=this.getNodeParameter('claim',i),{Inbox}=require('../inbox/sqlite'),inbox=new Inbox(this.getNodeParameter('inboxDatabase',i));try{inbox.owned(claim);}finally{inbox.close();}
    const source=this.getNodeParameter('source',i);if(!/^\d{7,15}$/.test(source.Lead_Phone)||source.channel!==claim.channel||source.provider!==claim.provider||source.message_id!==claim.id)throw Error('OUTREACH_IDENTITY_MISMATCH');
    const customer=claim.channel+':'+source.Lead_Phone;
    if(action==='inbound'){const activity=scheduler.inbound({id:hash([claim.provider,claim.channel,claim.id]),customer,recipient:source.Lead_Phone+'@s.whatsapp.net',text:source.Lead_Message}),text=source.Lead_Message.trim().toUpperCase();const ack=scheduler.rules.revokeCommands.includes(text)?'Your preference has been saved. Promotional follow-ups are disabled.':text===scheduler.rules.grantCommand?'Your explicit opt-in to promotional follow-ups has been recorded. Reply STOP to revoke it.':'';result={...input,_outreach:activity,_consent_ack:ack};}
    else{const activity=this.getNodeParameter('activity',i);if(activity.customer!==customer||activity.id!==hash([claim.provider,claim.channel,claim.id]))throw Error('ACTIVITY_IDENTITY_MISMATCH');
     if(action==='engagement'){const proposal=this.getNodeParameter('proposal',i);if(proposal.authorized!==true||proposal.Lead_Phone!==source.Lead_Phone)throw Error('UNVALIDATED_ENGAGEMENT');store.engagement(customer,activity.generation,proposal.next_lead_status);if(proposal.next_lead_status==='Not Interested')store.tx(()=>store.cancel(customer,clock(),'declined'));result=input;}
     else result={...input,outreach:scheduler.schedule(customer,activity.generation)};
    }
   }else if(action==='context'){
    const source=this.getNodeParameter('source',i),claim=this.getNodeParameter('claim',i),customer=claim.channel+':'+source.Lead_Phone;
    if(input.Phone&&String(input.Phone).replace(/\D/g,'')!==source.Lead_Phone)throw Error('OUTREACH_IDENTITY_MISMATCH');
    let h=store.handoff(customer);
    if(!h){const legacy=input.Handoff_Status||(['Requires Manual Call','Required Manual Call'].includes(input.Lead_Status)?'Requested':'');
     if(legacy&&!['None','Requested','Assigned','Resolved'].includes(legacy))throw Error('UNKNOWN_LEGACY_HANDOFF');
     if(legacy&&legacy!=='None')h=store.tx(()=>{
      const existing=store.handoff(customer);if(existing)return existing;
      store.updateHandoff({id:hash(['legacy-handoff',customer,'Requested']),customer,state:'Requested',reason:'legacy_staff_handoff_import',actor:'application',expectedVersion:0,sequence:null},clock());
      return store.updateHandoff({id:hash(['legacy-handoff',customer,legacy==='Assigned'?'Assigned':'Resolved']),customer,state:legacy==='Assigned'?'Assigned':'Resolved',reason:legacy==='Requested'?'legacy_request_superseded_by_inbound':'legacy_staff_handoff_import',actor:'application',expectedVersion:1,sequence:null},clock());
     });
    }
    result={...input};if(h)result.Handoff_Status=h.state;
   }else if(action==='tick'){if(adapter==='unconfigured')throw Error('OUTREACH_ADAPTER_UNCONFIGURED');result=await scheduler.tick();}
   else if(action==='consent')result=store.consent(this.getNodeParameter('update',i),clock());
   else if(action==='handoff')result=store.handoffUpdate(this.getNodeParameter('update',i),clock());
   else if(action==='reschedule'){const u=this.getNodeParameter('update',i);result={changed:scheduler.reschedule(u.id,u.expectedDue,u.due)};}
   else if(action==='recover'){const u=this.getNodeParameter('update',i);result={status:scheduler.recoverStoppedOwner(u.id,u.owner,u.proof)};}
   else throw Error('UNSUPPORTED_OUTREACH_ACTION');
   out.push({json:result,pairedItem:{item:i}});
  }finally{store.close();}
 }return [out];}
}
module.exports={Outreach};
