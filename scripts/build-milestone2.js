'use strict';
const fs=require('node:fs'),path=require('node:path');
const {stateProfileRules}=require('../src/state-profile');
const root=path.resolve(__dirname,'..');
const workflow=JSON.parse(fs.readFileSync(path.join(root,'workflow.json')));
const nodes=Object.fromEntries(workflow.nodes.map(n=>[n.name,n]));
const rules=`const rules=(${stateProfileRules.toString()})();\n`;
nodes['Code - Prepare Context'].parameters.jsCode=rules+`
const row=$input.item.json;
if (row.error) throw new Error('Customer lookup failed; refusing to infer a new customer.');
const source=$('Merge - All Sources').item.json;
if (!source.Lead_Phone || !/^\\d{7,15}$/.test(source.Lead_Phone)) throw new Error('Invalid conversation identity');
if (Object.keys(row).length && !row.Phone) throw new Error('Customer record has no identity');
if (row.Phone && String(row.Phone).replace(/\\D/g,'')!==source.Lead_Phone) throw new Error('Customer identity mismatch');
return {...row, is_existing_lead:!!row.Phone,is_fresh_lead:!row.Phone,
 existing_lead_status:row.Lead_Status || '',existing_booking_status:row.Booking_Status || '',
 existing_calendar_event_id:row.Calendar_Event_ID || '',
 conversation_id:'fitness-studio:whatsapp:'+source.Lead_Phone,
 existing_profile:{Name:row.Name || '',Email:row.Email || '',Goal:row.Goal || '',Experience:row.Experience || '',Injuries:row.Injuries || ''}};`;
nodes['Code - Safe Parse & Prep'].parameters.jsCode=rules+`
return rules.prepare($('Code - Prepare Context').item.json,
 $('Merge - All Sources').item.json,$input.item.json.output);`;
nodes['Memory - Per Phone'].parameters.sessionKey="={{ $('Code - Prepare Context').item.json.conversation_id }}";
const agent=nodes['AI Agent'].parameters.options;
agent.systemMessage=agent.systemMessage.replace(/=- Fresh Lead[\s\S]*?You are the AI Sales Agent/,
  '=You are the AI Sales Agent');
agent.systemMessage+='\nSAVED CUSTOMER PROFILE: {{ JSON.stringify($("Code - Prepare Context").item.json.existing_profile) }}\nNever replace known profile values with guesses. Include collected_data.full_name only when the customer supplies or corrects their full name.';
agent.systemMessage=agent.systemMessage.replace('"collected_data": {','"collected_data": {\n    "full_name": "value or null",');
// A customer-initiated message may re-engage a previously uninterested lead.
workflow.connections.Switch.main[0]=[{node:'AI Agent',type:'main',index:0}];
const expr=field=>`={{ $('Code - Safe Parse & Prep').item.json.${field} }}`;
for (const n of workflow.nodes) {
 if (n.type!=='n8n-nodes-base.googleSheets' || !n.parameters.columns) continue;
 const values=n.parameters.columns.value;
 if (['Sheet - Flag Manual Call','Sheet - Flag Follow Up Required'].includes(n.name)) {
   delete values.Lead_Status;values.Handoff_Status='Requested';
   n.parameters.columns.schema.push({id:'Handoff_Status',displayName:'Handoff_Status',type:'string',required:false,display:true,canBeUsedToMatch:true});
   continue;
 }
 if ('Name' in values) values.Name=expr('Lead_Name');
 if ('Lead_Status' in values) values.Lead_Status=expr('next_lead_status');
 if (['Sheet - Upsert Booking Pending','Sheet - Upsert Interested','Sheet - Upsert Needs Info','Sheet - Upsert Not Interested','Sheet - Upsert Reschedule'].includes(n.name)) {
   values.Booking_Status=expr('next_booking_status');
   values.Booking_Date=expr('stored_booking_date');values.Booking_Time=expr('stored_booking_time');
   values.Calendar_Event_ID=expr('existing_calendar_event_id');
 }
 if (n.name.startsWith('Sheet - Upsert') || n.name==='Sheet - Mark Cancelled') {
   Object.assign(values,{Name:expr('Lead_Name'),Email:expr('collected_email'),Goal:expr('collected_goal'),
     Experience:expr('collected_experience'),Injuries:expr('collected_injuries')});
   values.Handoff_Status=expr('handoff_status');
   if (!n.parameters.columns.schema.some(c=>c.id==='Handoff_Status')) n.parameters.columns.schema.push({id:'Handoff_Status',displayName:'Handoff_Status',type:'string',required:false,display:true,canBeUsedToMatch:true});
 }
 // Keep the confirmed slot in storage until the calendar-update branch completes.
 if (n.name==='Sheet - Upsert Reschedule') {delete values.Booking_Date;delete values.Booking_Time;}
 if (n.name==='Sheet - Mark Rescheduled') {values.Booking_Date=expr('stored_booking_date');values.Booking_Time=expr('stored_booking_time');}
 if (n.name==='Sheet - Mark Cancelled') {values.Calendar_Event_ID='';values.Booking_Date='';values.Booking_Time='';}
}
workflow.name='Fitness Studio Booking - Milestone 2 Candidate';workflow.active=false;
workflow.id='milestone2Candidate';workflow.pinData={};workflow.meta={};
fs.mkdirSync(path.join(root,'workflows'),{recursive:true});
const output=JSON.stringify(workflow,null,2)+'\n';
const destination=path.join(root,'workflows/milestone2.json');
if (process.argv.includes('--check')) {
 if (!fs.existsSync(destination) || fs.readFileSync(destination,'utf8')!==output) throw new Error('Candidate is stale; run node scripts/build-milestone2.js');
} else fs.writeFileSync(destination,output);
