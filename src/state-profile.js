'use strict';
// Pure Milestone 2 rules. Embedded verbatim in the candidate's n8n Code nodes.
function stateProfileRules() {
  const leadStates = ['New','Interested','Needs Info','Qualified','Not Interested'];
  const leadTransitions = {
    New:leadStates, Interested:['Interested','Needs Info','Qualified','Not Interested'],
    'Needs Info':['Interested','Needs Info','Qualified','Not Interested'],
    Qualified:['Qualified','Not Interested'], 'Not Interested':leadStates.filter(s=>s!=='New'),
  };
  const bookingTransitions = {
    none:['none','pending'], pending:['pending','confirmed'],
    confirmed:['confirmed','rescheduling','cancelled'],
    rescheduling:['rescheduling','confirmed'], cancelled:['cancelled','pending'],
  };
  function leadState(value) {
    if (!value) return 'New';
    if (value==='Booking Confirmed') return 'Qualified';
    if (['Booking Pending','Reschedule Requested'].includes(value)) return 'Qualified';
    if (value==='Cancelled') return 'Interested';
    if (['Requires Manual Call','Required Manual Call'].includes(value)) return 'Interested';
    return leadStates.includes(value)?value:null;
  }
  function bookingState(value, eventId='') {
    if (['Confirmed - Calendar Created','Rescheduled - Calendar Updated'].includes(value)) return 'confirmed';
    if (value==='Reschedule Pending') return 'rescheduling';
    if (value==='Pending Confirmation') return 'pending';
    if (value==='Cancelled') return 'cancelled';
    if (!value || ['Not Started','Awaiting Date','Closed'].includes(value)) return eventId?'confirmed':'none';
    return null;
  }
  function allowed(kind, from, to) {
    return !!(kind==='lead'?leadTransitions[from]:bookingTransitions[from])?.includes(to);
  }
  function profile(existing, incoming, displayName) {
    const mapping={full_name:'Name',email:'Email',goal:'Goal',experience:'Experience',injuries:'Injuries'};
    const merged=Object.fromEntries(Object.values(mapping).map(k=>[k, existing[k] ?? '']));
    if (!merged.Name && typeof displayName==='string') merged.Name=displayName.trim().slice(0,120);
    const patch={}, rejected=[];
    for (const [key,column] of Object.entries(mapping)) {
      const value=incoming?.[key];
      if (value==null || (typeof value==='string' && (!value.trim() || value.trim().toLowerCase()==='null'))) continue;
      if (typeof value!=='string') {rejected.push(key);continue;}
      let text=value.trim();
      if (text.length>(key==='injuries'?500:key==='goal'?300:120) || /[\x00-\x1f\x7f]/.test(text)) {rejected.push(key);continue;}
      if (key==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {rejected.push(key);continue;}
      if (key==='experience') {
        text=text.toLowerCase();
        if (!['beginner','intermediate','advanced'].includes(text)) {rejected.push(key);continue;}
      }
      patch[column]=text;merged[column]=text;
    }
    return {merged,patch,rejected};
  }
  function prepare(row, source, raw) {
    let parsed;
    try {parsed=JSON.parse((typeof raw==='string'?raw:'').replace(/```json|```/gi,'').trim());} catch {}
    if (!parsed || Array.isArray(parsed) || typeof parsed!=='object') parsed={category:'Needs Info',reply:'Sorry, I had a small issue. Could you please repeat that?'};
    const valid=['Interested','Booking Pending','Needs Info','Not Interested','Reschedule','Cancel Booking'];
    let category=valid.includes(parsed.category)?parsed.category:'Needs Info';
    let reply=typeof parsed.reply==='string'?parsed.reply:'Could you clarify your request?';
    const event=row.Calendar_Event_ID || '';
    const currentLead=leadState(row.Lead_Status), currentBooking=bookingState(row.Booking_Status,event);
    const collected=profile(row,parsed.collected_data,source.Lead_Name);
    const date=typeof parsed.booking_date==='string' && parsed.booking_date!=='null'?parsed.booking_date:null;
    const time=typeof parsed.booking_time==='string' && parsed.booking_time!=='null'?parsed.booking_time:null;
    let nextBooking=row.Booking_Status || 'Not Started';
    const decline=(message)=>{category='Needs Info';reply=message;};
    if (!currentLead || !currentBooking) decline('Your record needs a staff review before changing a booking.');
    else if (category==='Booking Pending') {
      if (event || currentBooking==='confirmed' || currentBooking==='rescheduling') {
        category='Interested';reply='You already have a booking. Please ask to reschedule or cancel it.';
      } else if (!date || !time) {category='Interested';}
      else if (!allowed('booking',currentBooking,'pending')) decline('Please clarify your booking request.');
      else nextBooking='Pending Confirmation';
    } else if (['Reschedule','Cancel Booking'].includes(category)) {
      const target=category==='Reschedule'?'rescheduling':'cancelled';
      if (!event || !allowed('booking',currentBooking,target)) decline('There is no confirmed booking available for that change.');
      else if (category==='Reschedule' && (!date || !time)) decline('Please provide both a new date and time.');
      else if (category==='Reschedule') nextBooking='Reschedule Pending';
    }
    let desiredLead=category==='Not Interested'?'Not Interested':
      ['Booking Pending','Reschedule','Cancel Booking'].includes(category)?'Qualified':category;
    // An inquiry or blocked duplicate cannot downgrade a qualified customer.
    if (currentLead==='Qualified' && desiredLead!=='Not Interested') desiredLead='Qualified';
    const nextLead=allowed('lead',currentLead,desiredLead)?desiredLead:(row.Lead_Status || 'New');
    const changingTime=['Booking Pending','Reschedule'].includes(category);
    return {
      category,reply, booking_date:date,booking_time:time,
      Lead_Phone:source.Lead_Phone,Lead_Name:collected.merged.Name,Lead_Source:row.Source || source.Lead_Source,
      collected_email:collected.merged.Email,collected_goal:collected.merged.Goal,
      collected_experience:collected.merged.Experience,collected_injuries:collected.merged.Injuries,
      profile_patch:collected.patch,rejected_profile_fields:collected.rejected,
      next_lead_status:nextLead,next_booking_status:nextBooking,
      handoff_status:row.Handoff_Status || (['Requires Manual Call','Required Manual Call'].includes(row.Lead_Status)?'Requested':''),
      stored_booking_date:changingTime?date:(row.Booking_Date ?? ''),
      stored_booking_time:changingTime?time:(row.Booking_Time ?? ''),
      existing_calendar_event_id:event,whapi_to:source.Lead_Phone+'@s.whatsapp.net',
    };
  }
  return {leadState,bookingState,allowed,profile,prepare};
}
module.exports={stateProfileRules};
