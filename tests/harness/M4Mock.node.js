'use strict';
// Test-only adapter: no HTTP client, provider SDK, environment credentials, or sockets.
const fs = require('node:fs');
const FILE = process.env.HARNESS_STATE_PATH;
class Mock {
  constructor() {
    this.description = {
      displayName: 'Offline Mock', name: 'mock4', group: ['transform'], version: 1,
      description: 'Deterministic local test adapter', defaults: { name: 'Offline Mock' },
      inputs: ['main'], outputs: ['main'],
      properties: [
        {displayName:'Kind', name:'kind', type:'string', default:''},
        {displayName:'Original Parameters', name:'mockParams', type:'json', default:{}},
      ],
    };
  }
  async execute() {
    const result = [];
    for (let i = 0; i < this.getInputData().length; i++) {
      const state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      const name = this.getNode().name;
      const kind = this.getNodeParameter('kind', i);
      // n8n's expression engine resolves the original parameter objects, not an emulator.
      const p = this.getNodeParameter('mockParams', i);
      const call = {sequence: state.calls.length + 1, turn: state.turn, at:state.clock,
                    node:name, kind, parameters:p};
      state.calls.push(call);
      let out;
      try {
        const fault = state.current.faults?.[name] || state.current.faults?.[kind];
        if (fault) throw new Error(`Synthetic ${fault}: ${name}`);
        if (kind === 'inbound') out = {body:state.current.body};
        else if (kind === 'ai') out = {output:state.current.ai};
        else if (kind === 'sheet') {
          if (!p.operation || p.operation === 'read') {
            const phone = p.filtersUI.values[0].lookupValue;
            out = structuredClone(state.rows[phone] || {});
          } else {
            const values = Object.fromEntries(Object.entries(p.columns.value)
              .map(([k,v]) => [k, v == null ? '' : v]));
            if (!values.Phone) throw new Error('Synthetic missing Phone');
            state.rows[values.Phone] = {...state.rows[values.Phone], ...values};
            out = structuredClone(state.rows[values.Phone]);
          }
        } else if (kind === 'calendar') {
          const op = p.operation || 'create';
          if (op === 'create') {
            const id = `mock-event-${++state.eventSequence}`;
            out = {id, start:p.start, end:p.end, ...p.additionalFields};
            state.events[id] = out;
          } else {
            if (!state.events[p.eventId]) throw new Error('Synthetic event not found');
            if (op === 'update') {
              out = {...state.events[p.eventId], ...p.updateFields};
              state.events[p.eventId] = out;
            } else if (op === 'delete') {delete state.events[p.eventId]; out = {success:true};}
            else throw new Error(`Unsupported calendar operation ${op}`);
          }
        } else if (kind === 'outbound') {
          const body = typeof p.jsonBody === 'string' ? JSON.parse(p.jsonBody) : p.jsonBody;
          if (!body.to || !body.body) throw new Error('Synthetic invalid outgoing message');
          out = {sent:true, id:`mock-message-${state.messages.length + 1}`};
          state.messages.push({turn:state.turn, at:state.clock, node:name, ...body});
        } else if (kind === 'wait') {
          const hours = p.unit === 'hours' ? p.amount : 0;
          if (!hours) throw new Error('Unsupported virtual wait');
          state.clock += hours * 3600000;
          // Deterministic interleaving supplied by the scenario; no real timer or network.
          const injection = state.current.duringWait;
          if (injection && !state.injected) {
            const parentTurn = state.turn, parentCurrent = state.current, due = state.clock;
            state.clock = due - hours * 3600000 + 3600000;
            state.injected = true;
            state.turn = `${parentTurn}.reply`; state.current = injection;
            fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
            const {boundary}=require('../webhook-boundary');
            const {Inbox}=require('../inbox/sqlite');
            const db=new Inbox('/inbox/inbox.sqlite');
            const channel=JSON.parse(fs.readFileSync(process.env.HARNESS_REQUEST_PATH))[0].envelope.channel;
            const input=boundary(Buffer.from(JSON.stringify(injection.body)),{'x-booking-webhook-key':'synthetic-test-key-not-a-real-secret','content-type':'application/json'},{secret:'synthetic-test-key-not-a-real-secret',channel},db);db.close();
            fs.writeFileSync('/data/injected-request.json',JSON.stringify(input.items));
            const r = require('node:child_process').spawnSync('/usr/bin/node',[
              '/opt/runtime/node_modules/n8n/bin/n8n','execute','--id=offlineBaseline','--rawOutput',
            ],{env:{...process.env,N8N_RUNNERS_BROKER_PORT:'5681',HARNESS_REQUEST_PATH:'/data/injected-request.json'},encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
            fs.writeFileSync('/data/interleaved.log',r.stdout+'\n'+r.stderr);
            const match = r.stdout.match(/^\{/m);
            const execution = match && JSON.parse(r.stdout.slice(match.index));
            fs.writeFileSync('/data/interleaved-execution.json',JSON.stringify(execution,null,2));
            if(r.error || r.status!==0 || execution?.status!=='success')throw new Error('Interleaved n8n execution failed');
            Object.assign(state,JSON.parse(fs.readFileSync(FILE,'utf8')));
            state.interleavedRuns = [{status:execution.status,turn:state.turn}];
            state.turn = parentTurn;state.current = parentCurrent;state.clock = due;
          }
          out = this.getInputData()[i].json;
        } else throw new Error(`Unsupported mock kind ${kind}`);
        const recorded = state.calls.find(c=>c.sequence===call.sequence);
        recorded.outcome = 'success'; recorded.result = out;
      } catch (error) {
        call.outcome = 'error'; call.error = error.message;
        fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
        if (!this.continueOnFail()) throw error;
        out = {error:error.message};
      }
      fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
      if(state.current.crashAfter===kind)process.kill(process.pid,'SIGKILL');
      result.push({json:out, pairedItem:{item:i}});
    }
    return [result];
  }
}
module.exports = {M4Mock:Mock};
