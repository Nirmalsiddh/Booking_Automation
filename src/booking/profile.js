'use strict';
// Reference-workflow profile adapter. The reservation store itself treats this as opaque data.
const {stateProfileRules}=require('../state-profile');
function preserveProfile(store,customer,input){
 const patch={full_name:input.Lead_Name,email:input.collected_email,goal:input.collected_goal,experience:input.collected_experience,injuries:input.collected_injuries};
 const merged=stateProfileRules().profile(store.profile(customer),patch).merged;
 store.saveProfile(customer,merged);return merged;
}
module.exports={preserveProfile};
