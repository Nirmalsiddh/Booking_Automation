'use strict';
const {Observer}=require('./store');
function attach(store,options={}){const message=options.message;if(!message||!['provider','channel','id'].every(k=>typeof message[k]==='string'&&message[k].length))options={...options,message:null};store.observer=new Observer(store.db,options);return store.observer;}
module.exports={attach};
