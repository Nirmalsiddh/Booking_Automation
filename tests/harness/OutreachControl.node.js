'use strict';
const fs=require('fs');
class OutreachControl {
 constructor(){this.description={displayName:'Synthetic worker barrier',name:'outreachControl',group:['transform'],version:1,defaults:{name:'Synthetic worker barrier'},inputs:['main'],outputs:['main'],properties:[]};}
 async execute(){const state=JSON.parse(fs.readFileSync(process.env.HARNESS_STATE_PATH));if(state.current.waitForRevocation){const {OutreachStore}=require('../outreach/store');const store=new OutreachStore(state.current.database);try{const until=Date.now()+30000;while(store.contact(state.current.customer)?.consent!=='revoked'){if(Date.now()>until)throw Error('REVOCATION_BARRIER_TIMEOUT');await new Promise(r=>setTimeout(r,100));}}finally{store.close();}}return [this.getInputData()];}
}
module.exports={OutreachControl};
