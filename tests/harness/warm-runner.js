'use strict';
// Test-only CLI initialization barrier. No business inputs, provider calls or state writes.
// A zero-Code early exit otherwise races internal JS-runner startup in this pinned runtime.
function warmRunner(workflow,start='Harness - Start'){
 const name='Harness - Initialize JS Runner';
 if(workflow.nodes.some(n=>n.name===name))throw Error('DUPLICATE_RUNNER_BARRIER');
 const next=workflow.connections[start]?.main?.[0];if(!next)throw Error('MISSING_TEST_ENTRYPOINT');
 workflow.nodes.push({id:'harness-warm-js-runner',name,type:'n8n-nodes-base.code',typeVersion:2,position:[0,0],parameters:{jsCode:'return $input.all();'}});
 workflow.connections[start]={main:[[{node:name,type:'main',index:0}]]};workflow.connections[name]={main:[next]};
}
module.exports={warmRunner};
