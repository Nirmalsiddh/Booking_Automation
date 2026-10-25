'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{timingSafeEqual}=require('node:crypto');const {RecoveryError}=require('./catalog');
const AUTH='/inbox/.recovery-authority.json';
function isolated(file){try{
 if(process.getuid()!==1000||Object.keys(os.networkInterfaces()).some(n=>n!=='lo')||fs.readFileSync('/proc/net/route','utf8').trim().split('\n').length!==1)throw 0;
 const stat=fs.readFileSync('/proc/self/status','utf8');if(!/^CapEff:\s+0+$/m.test(stat)||!/^NoNewPrivs:\s+1$/m.test(stat))throw 0;
 const mount=fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').find(l=>l.split(' ')[4]==='/');if(!mount||!mount.split(' ')[5].split(',').includes('ro'))throw 0;
 if(!path.isAbsolute(file)||!/^\/inbox\/booking-[a-zA-Z0-9_-]+\.sqlite$/.test(file)||fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile()||fs.readFileSync('/inbox/.harness-marker','utf8')!=='booking-inbox-disposable-v1')throw 0;
 }catch{throw new RecoveryError('ISOLATION_UNVERIFIED');}}
function authority(file,{operator=false}={}){isolated(file);try{const st=fs.lstatSync(AUTH);if(!st.isFile()||st.isSymbolicLink()||st.uid!==1000||(st.mode&0o077)!==0)throw 0;const a=JSON.parse(fs.readFileSync(AUTH));if(a.version!==1||a.mode!=='synthetic-mock-only'||!/^[a-f0-9]{64}$/.test(a.token)||!a.databases?.[path.basename(file)])throw 0;
 if(operator){const token=process.env.BOOKING_RECOVERY_TOKEN;if(typeof token!=='string'||token.length!==a.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(a.token)))throw 0;}
 return {now:a.databases[path.basename(file)].now,faults:a.databases[path.basename(file)].faults||{}};
 }catch{throw new RecoveryError('AUTHORIZATION_REQUIRED');}}
module.exports={authority,isolated,AUTH};
