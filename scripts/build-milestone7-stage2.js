'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const w=JSON.parse(fs.readFileSync(path.join(root,'workflows/milestone7.json')));w.id='milestone7Stage2Candidate';w.name='Booking - Milestone 7 Stage 2 Candidate';w.active=false;w.meta={...w.meta,recoveryPolicy:require('../config/recovery.json')};
const file=path.join(root,'workflows/milestone7-stage2.json'),out=JSON.stringify(w,null,2)+'\n';if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==out)throw Error('STALE_M7_STAGE2');}else fs.writeFileSync(file,out);
