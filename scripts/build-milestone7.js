'use strict';
const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');
const policy=require('../config/operations.json');if(policy.version!==1||policy.mode!=='observe_only'||policy.recoveryExecutionEnabled!==false||policy.automaticRetentionDeletion!==false||policy.diagnosticLimit!==100)throw Error('UNSUPPORTED_STAGE1_POLICY');
const w=JSON.parse(fs.readFileSync(path.join(root,'workflows/milestone6.json')));
const edge=node=>({node,type:'main',index:0});
for(const n of w.nodes)if(['CUSTOM.inbox','CUSTOM.booking','CUSTOM.outreach','CUSTOM.secureWebhook'].includes(n.type))n.parameters.observability=true;
function node(name,action){return {id:name,name,type:'CUSTOM.operations',typeVersion:1,position:[0,0],parameters:{action,database:'/inbox/inbox.sqlite',claim:"={{ $('Inbox - Claim').item.json._inbox }}"}};}
w.nodes.push(node('Ops - Begin Message','trace'),node('Ops - Observe Validation','validation'),node('Ops - Begin AI','ai-start'),node('Ops - End AI','ai-end'));
w.connections['Inbox - Claim'].main[0]=[edge('Ops - Begin Message')];w.connections['Ops - Begin Message']={main:[[edge('Normalizer - WHAPI Payload')]]};
w.connections['Code - Safe Parse & Prep'].main[0]=[edge('Ops - Observe Validation')];w.connections['Ops - Observe Validation']={main:[[edge('IF - Authorized Proposal')]]};
w.connections['Inbox Begin - AI Agent'].main[0]=[edge('Ops - Begin AI')];w.connections['Ops - Begin AI']={main:[[edge('AI Agent')]]};
w.connections['AI Agent'].main[0]=[edge('Ops - End AI')];w.connections['Ops - End AI']={main:[[edge('Inbox Complete - AI Agent')]]};
w.meta={...w.meta,operationsPolicy:policy};w.id='milestone7Stage1Candidate';w.name='Booking - Milestone 7 Stage 1 Candidate';w.active=false;
w.settings={...w.settings,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,saveExecutionProgress:false};
const file=path.join(root,'workflows/milestone7.json'),out=JSON.stringify(w,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==out)throw Error('STALE_M7');}else fs.writeFileSync(file,out);
