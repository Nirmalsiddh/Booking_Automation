'use strict';
// Embedded verbatim into n8n; no network, modules, credentials or model trust.
function authorizationRules(config) {
  const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
  const time=v=>typeof v==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const minutes=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
  const fields={full_name:120,email:120,goal:300,experience:120,injuries:500};
  const bad=reason=>({ok:false,reason});
  const configKeys=['timezone','openingTime','closingTime','durationMinutes','minimumNoticeMinutes','maximumAdvanceDays','allowedWeekdays','maxMessageLength','maxAIBytes','requiredBookingFields'];
  if(!object(config)||Object.keys(config).length!==configKeys.length||configKeys.some(k=>!Object.hasOwn(config,k)))throw Error('Invalid validation configuration');
  let formatter;
  try {formatter=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});} catch {throw Error('Invalid business timezone');}
  if(typeof config.timezone!=='string'||!time(config.openingTime)||!time(config.closingTime)||minutes(config.openingTime)>=minutes(config.closingTime))throw Error('Invalid business hours');
  for(const [k,min,max] of [['durationMinutes',1,1440],['minimumNoticeMinutes',0,525600],['maximumAdvanceDays',1,3650],['maxMessageLength',1,10000],['maxAIBytes',1,100000]])
    if(!Number.isInteger(config[k])||config[k]<min||config[k]>max)throw Error('Invalid config '+k);
  if(!Array.isArray(config.allowedWeekdays)||!config.allowedWeekdays.length||config.allowedWeekdays.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Invalid weekdays');
  if(!Array.isArray(config.requiredBookingFields)||config.requiredBookingFields.some(k=>!Object.hasOwn(fields,k)))throw Error('Invalid required fields');
  function slot(date,clock,now) {
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!time(clock))return bad('invalid_datetime');
    const [y,m,d]=date.split('-').map(Number), t=Date.UTC(y,m-1,d);
    if(new Date(t).toISOString().slice(0,10)!==date)return bad('impossible_date');
    const wall=t+minutes(clock)*60000, matches=[];
    // Enumerate modern timezone offsets. Zero or two matches reject DST gaps/folds.
    for(let offset=-840;offset<=840;offset+=15){
      const candidate=wall-offset*60000;
      const p=Object.fromEntries(formatter.formatToParts(candidate).map(x=>[x.type,x.value]));
      if(`${p.year}-${p.month}-${p.day}`===date && `${p.hour}:${p.minute}`===clock)matches.push(candidate);
    }
    if(matches.length!==1)return bad('ambiguous_timezone_time');
    const start=matches[0],end=start+config.durationMinutes*60000;
    if(!Number.isFinite(now)||start<=now||start<now+config.minimumNoticeMinutes*60000||start>now+config.maximumAdvanceDays*86400000)return bad('outside_booking_window');
    if(!config.allowedWeekdays.includes(new Date(t).getUTCDay())||minutes(clock)<minutes(config.openingTime)||minutes(clock)+config.durationMinutes>minutes(config.closingTime))return bad('outside_business_hours');
    const endParts=Object.fromEntries(formatter.formatToParts(end).map(x=>[x.type,x.value]));
    if(`${endParts.year}-${endParts.month}-${endParts.day}`!==date||minutes(`${endParts.hour}:${endParts.minute}`)!==minutes(clock)+config.durationMinutes)return bad('timezone_transition_during_slot');
    return {ok:true,start:new Date(start).toISOString(),end:new Date(end).toISOString()};
  }
  function schema(raw) {
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>config.maxAIBytes)return bad('invalid_payload');
    let p;try{p=JSON.parse(raw);}catch{return bad('invalid_json');}
    const keys=['category','reply','booking_date','booking_time','collected_data'];
    if(!object(p)||Object.keys(p).some(k=>!keys.includes(k))||!['category','reply','collected_data'].every(k=>Object.hasOwn(p,k)))return bad('invalid_schema');
    if(!['Interested','Needs Info','Not Interested','Booking Pending','Reschedule','Cancel Booking'].includes(p.category))return bad('invalid_category');
    if(typeof p.reply!=='string'||!p.reply.trim()||p.reply.length>1000||/[\x00-\x08\x0b-\x1f\x7f]/.test(p.reply))return bad('invalid_reply');
    if(!object(p.collected_data))return bad('invalid_profile');
    for(const [k,v] of Object.entries(p.collected_data)) {
      if(!Object.hasOwn(fields,k))return bad('unexpected_profile_field');
      if(v===null)continue;
      if(typeof v!=='string'||v.length>fields[k]||/[\x00-\x1f\x7f]/.test(v))return bad('invalid_profile_field');
      if(v.trim() && v.trim().toLowerCase()!=='null') {
        if(k==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))return bad('invalid_email');
        if(k==='experience'&&!['beginner','intermediate','advanced'].includes(v.trim().toLowerCase()))return bad('invalid_experience');
      }
    }
    for(const k of ['booking_date','booking_time'])if(p[k]!=null && (typeof p[k]!=='string'||p[k].length>10))return bad('invalid_datetime');
    if(p.booking_date!=null && !/^\d{4}-\d{2}-\d{2}$/.test(p.booking_date))return bad('invalid_datetime');
    if(p.booking_time!=null && !time(p.booking_time))return bad('invalid_datetime');
    return {ok:true,value:p};
  }
  function authorize(raw,source,row,stateRules,now) {
    const help=`Please repeat your request. To authorize an appointment, send BOOK YYYY-MM-DD HH:MM or RESCHEDULE YYYY-MM-DD HH:MM (${config.timezone}).`;
    const reject=(reason,reply=help)=>({authorized:false,authorization_reason:reason,reply,whapi_to:source.Lead_Phone+'@s.whatsapp.net'});
    if(typeof source.Lead_Phone!=='string'||!/^\d{7,15}$/.test(source.Lead_Phone))throw Error('Invalid customer identity');
    if(typeof source.Lead_Message!=='string'||!source.Lead_Message.trim()||source.Lead_Message.length>config.maxMessageLength||/[\x00-\x08\x0b-\x1f\x7f]/.test(source.Lead_Message))return reject('invalid_input');
    const validated=schema(raw);if(!validated.ok)return reject(validated.reason);
    const p=validated.value, text=source.Lead_Message.trim();
    let times={};
    if(['Booking Pending','Reschedule'].includes(p.category)) {
      const action=p.category==='Booking Pending'?'BOOK':'RESCHEDULE';
      if(text!==`${action} ${p.booking_date} ${p.booking_time}`)return reject('customer_authorization_required');
      times=slot(p.booking_date,p.booking_time,now);if(!times.ok)return reject(times.reason);
    }
    if(p.category==='Cancel Booking') {
      const validSaved=/^\d{4}-\d{2}-\d{2}$/.test(row.Booking_Date||'')&&time(row.Booking_Time);
      if(!validSaved)return reject('missing_cancellation_slot','A staff review is needed before cancelling this appointment.');
      const confirmation=`CONFIRM CANCEL ${row.Booking_Date} ${row.Booking_Time}`;
      if(text!==confirmation)return reject('cancellation_confirmation_required',`To cancel your appointment on ${row.Booking_Date} at ${row.Booking_Time} (${config.timezone}), reply exactly: ${confirmation}`);
    }
    const prepared=stateRules.prepare(row,source,raw);
    if(['Booking Pending','Reschedule','Cancel Booking'].includes(p.category)&&prepared.category!==p.category)return reject('state_transition_denied',prepared.reply);
    if(['Booking Pending','Reschedule'].includes(p.category)) {
      const merged=stateRules.profile(row,p.collected_data,source.Lead_Name).merged;
      const columns={full_name:'Name',email:'Email',goal:'Goal',experience:'Experience',injuries:'Injuries'};
      for(const field of config.requiredBookingFields) {
        const value=merged[columns[field]];
        if(typeof value!=='string'||!value.trim()||value.trim().toLowerCase()==='null'||!schema(JSON.stringify({category:'Interested',reply:'ok',collected_data:{[field]:value}})).ok)return reject('missing_required_profile');
      }
    }
    const replies={Interested:'Thanks for your interest. Please share your fitness goals or ask about an assessment.',
      'Needs Info':'Please share the details of your question so the studio can help.',
      'Not Interested':'Understood. Thank you for letting us know.',
      'Booking Pending':'Your booking request was submitted. This message does not confirm calendar success.',
      Reschedule:'Your rescheduling request was submitted. This message does not confirm calendar success.',
      'Cancel Booking':'Your cancellation request was submitted. This message does not confirm calendar success.'};
    return {...prepared,authorized:true,authorization_reason:'validated',reply:replies[prepared.category],calendar_start:times.start,calendar_end:times.end};
  }
  return {schema,slot,authorize};
}
module.exports={authorizationRules};
