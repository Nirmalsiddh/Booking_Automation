# Milestone 7 Stage 1: operational diagnostics

Scope: M7.1–M7.3 only. This is an inactive, isolated, mock-tested candidate, not a production deployment. Recovery execution, retry workers, recovery mutations, a dashboard and Milestone 8 are excluded. Existing M4–M6 recovery interfaces are preserved for compatibility; this stage adds no commands that invoke them.

## Storage and authority

`src/operations/migrations.js` applies an additive version-1 migration in the existing SQLite database. It uses its own `ops_migrations` namespace and leaves inbox `user_version`, booking migrations, outreach migrations and business records intact. Unknown future operational versions fail closed. Runtime attachment explicitly upgrades storage; inspection never initializes it.

| Table | Purpose |
| --- | --- |
| `ops_migrations` | Operational schema version and application time |
| `ops_links` | Server-generated opaque UUID references and protected mappings to existing domain identities |
| `ops_attempts` | Observed attempt lifecycle, start/end, sanitized code and duration; one unfinished attempt per entity |
| `ops_events` | Append-only events, trace/entity/attempt/parent UUIDs, closed kind/status/code enums, timestamp and duration |

Events reject UPDATE and DELETE with triggers. This is application-level append-only protection, not tamper-proof storage against a database administrator. Attempts summarize observed execution; existing inbox, reservation, projection, outreach and handoff ledgers remain authoritative. Diagnostics resolve current status from those ledgers instead of maintaining a second business-state machine.

Critical business mutations and their audit events use the same database connection and transaction. Provider calls commit an intent first, run outside a transaction, then append their transport outcome. A failed audit before dispatch blocks the call. A failed post-call audit retains its committed start evidence and must not be interpreted as proof that the external call failed. Uncertain and interrupted work requires investigation; Stage 1 never retries it.

A provider transport `completed` event means the call returned. It does not establish verified Calendar booking success, delivery of a message or successful Sheets synchronization. Existing result verifiers establish those facts. Notifications expose provider acceptance, not delivery.

## Instrumentation

`config/operations.json` fixes observe-only mode and explicitly disables recovery execution and automatic retention deletion. `scripts/build-milestone7.js` validates that configuration and derives `workflows/milestone7.json` from the unchanged M6 export.

Optional `observability` properties default to false on Inbox, Booking, Outreach and SecureWebhook nodes, preserving earlier candidates. M7 enables those properties and inserts four pass-through nodes:

- `Ops - Begin Message`: bind a trace to the trusted inbox claim.
- `Ops - Begin AI` and `Ops - End AI`: observe interpretation without recording prompts/responses.
- `Ops - Observe Validation`: record deterministic authorization outcome without proposal content.

Existing source stores instrument ingress acceptance/claims, AI operation boundaries, reservation preparation/dispatch/results, Calendar transport, versioned projections, booking notifications, follow-up jobs/notifications, consent changes, activity and handoff transitions. Rejected unauthenticated ingress uses bounded, rate-limited code-only diagnostics rather than persisting attacker-controlled identities.

Correlations originate from UUID generation and trusted server claim mappings, never a caller-supplied correlation header. Follow-up entities recover their existing trace after worker restart. Provider spans identify their domain parent. Durations use a monotonic process-local clock; restarted or cross-process spans may have null durations rather than invented timing. Duration does not include queue age unless explicitly observed in one process. Detached legacy records may have no historical trace.

## Read-only CLI

Requirements: Node 24 with `node:sqlite`, a locally accessible SQLite file and OS permission to read it. No npm dependencies, credentials or environment variables are needed.

```sh
node src/operations/cli.js status --db /absolute/path/to/disposable.sqlite
node src/operations/cli.js list --db /absolute/path/to/disposable.sqlite --state uncertain --limit 25
node src/operations/cli.js list --db /absolute/path/to/disposable.sqlite --kind booking_operation
node src/operations/cli.js inspect --db /absolute/path/to/disposable.sqlite --ref <opaque-uuid>
node src/operations/cli.js history --db /absolute/path/to/disposable.sqlite --ref <opaque-uuid>
node src/operations/cli.js health --db /absolute/path/to/disposable.sqlite
```

Output is JSON. Exit codes: 0 success, 2 unavailable/unsupported diagnostics, 64 invalid arguments. Errors never echo the database path, arguments or underlying exception. Missing databases are not created. Legacy databases return counts and indicate that operational schema is uninitialized. List/history return at most 100 records; history currently returns the earliest 100 matching events, not pagination. Retry eligibility is conservative advisory information: unknown outcomes are blocked, definite failures require manual review. There are no recovery execution commands.

The CLI uses SQLite read-only open and `query_only`, without business constructors, schema upgrades, provider adapters or network access. It cannot change business records. SQLite may need existing WAL/SHM access during concurrent use; OS ownership and permissions remain important. `health` reports local storage and unresolved records, not provider connectivity or a production readiness assessment.

## Privacy

Operational event fields are strictly allow-listed: no payloads, conversations, customer profiles, model text, authentication headers, receipts or arbitrary exception serialization. Codes and statuses use closed vocabularies. Internal mappings necessarily retain the minimum pre-existing identity keys used to join authoritative records; they are private database data, never CLI/export fields. UUIDs are pseudonymous correlators, not an anonymization guarantee. Protect database files, backups, WAL and SHM using the existing restricted runtime ownership; do not commit them.

M7 disables `saveDataSuccessExecution`, `saveDataErrorExecution`, `saveManualExecutions` and `saveExecutionProgress` using settings supported by pinned n8n 2.44.6. Pinned n8n defaults to soft deletion when pruning is enabled, so disabled workflow saving alone can leave in-flight execution-data rows until pruning. The disposable M7 harness additionally sets supported `EXECUTIONS_DATA_PRUNE=false`, causing n8n to hard-delete unsaved completed/error execution records immediately. This setting is limited to newly initialized disposable runtime storage; changing it on an existing live runtime requires separate review. Interrupted processes can still leave in-flight data in the private disposable runtime, which is never exported. These settings do not erase pre-existing execution history, redact arbitrary n8n process logs or make a live deployment privacy-cleared. The M7 runner holds raw execution output only in memory and exports a constrained diagnostic set. Existing synthetic evidence remains unchanged. The original video and its previously acknowledged publication concerns remain unchanged.

No automatic retention deletion is introduced. Operators must protect and capacity-plan append-only storage; a retention/export policy is a later decision.

## Isolated verification and reproduction

First follow [reproducibility.md](reproducibility.md) to provision Linux, Docker, Node 24 and the pinned local n8n 2.44.6 runtime image. These provisioning requirements are unchanged. The M7 build never pulls, installs packages or contacts providers.

```sh
node scripts/build-milestone7.js --check
node --test tests/*.test.js
python3 -m unittest discover -s tests/harness -p 'test*guards.py'
python3 tests/harness/run-milestone7.py build
python3 tests/harness/run-milestone7.py run ops-invalid-ai
python3 tests/harness/run-milestone7.py run all
# Preserved suites, using the combined locally built image:
python3 tests/harness/run.py run all --workflow milestone2 --extended --allow-baseline-failures
python3 tests/harness/run.py run all --workflow milestone3 --allow-baseline-failures
python3 tests/harness/run-milestone4.py run all
python3 tests/harness/run-milestone5.py run all
python3 tests/harness/run-milestone6.py run all
```

For an optional manual inactive import, install `src/n8n/Operations.node.js` beside the existing Inbox/Booking/Outreach/SecureWebhook custom node classes and install `src/operations/` as their sibling library directory, preserving the relative `../operations` imports. Include the updated shared inbox/booking/outreach modules. Use the supported custom-extension mechanism described in the reproducibility guide and a disposable absolute database path. Import `workflows/milestone7.json` inactive. Manual import is not a substitute for running the isolated harness, and the exported candidate must not be executed against real adapters or credentials. The harness installs this complete layout automatically. Safety preflight verifies `network=none`, read-only root, non-root UID, no host bindings or ports, dropped capabilities, no-new-privileges, exact image digests and a uniquely owned disposable volume. In-container checks verify loopback-only interfaces, no routes, missing credential environment and unreachable documentation-only IP probes before executing n8n. Delays use the synthetic clock. A real container restart tests retained state. Only runner-owned container/volume resources are removed afterward; prior result directories remain intact.

M7 exports only isolation evidence, transformation metadata, summaries, execution node names/times/outcomes and sanitized operational records. It does not export raw runtime logs, model output, full business snapshots or runtime SQLite databases. M2–M6 runners retain their existing synthetic artifact behavior and known baseline failures.

Docker's `vfs` storage can require hundreds of thousands of inodes per image/container. Build and run sequentially. The runner fails closed if resources are insufficient. Do not broadly prune user Docker resources to resolve this. Preserve any exact prior harness image archive before selectively releasing obsolete local harness aliases/cache. The combined M7 image includes earlier candidates and is tagged for earlier suites; their source digests still guard against stale modules.

## Verification results

See the [Stage 1 verification report](milestone7-stage1-results.md) for the actual native run, the complete scenario inventory, and assertion-level before/after regression comparisons.

## Remaining work

M7.4–M7.6 remain unimplemented: approved recovery planning, guarded operator execution and recovery-specific concurrency/interruption validation. Stage 1 provides evidence and visibility only. Recovery mutation design must preserve reconciliation-before-repeat and existing reservation authority. Live provider verification, deployment policy, retention and access control remain separate from this synthetic test environment.

## File and node inventory

New implementation files:

- `config/operations.json`
- `src/operations/{events,migrations,store,runtime,reader,cli}.js`
- `src/n8n/Operations.node.js`
- `scripts/build-milestone7.js`
- `workflows/milestone7.json` (inactive; 116 nodes)

Optional integration changes:

- `src/inbox/sqlite.js`: audit receive/claim, operation boundaries and final message outcome inside existing transactions.
- `src/booking/store.js`: audit reservation, projection and notification transitions; notification completion gains a transaction for atomic audit/state writes.
- `src/booking/coordinator.js`: wrap Calendar, Sheets and outbound transport observations; propagate audit failures through existing error boundaries.
- `src/outreach/store.js`, `src/outreach/scheduler.js`: observe activity, consent, cancellation, job dispatch/results and handoffs.
- `src/n8n/{Inbox,Booking,Outreach,SecureWebhook}.node.js`: optional attachment, default off.
- `src/webhook-boundary.js`: optional bounded rejection classification; no raw ingress logging.

New verification files:

- `tests/operations.test.js`
- `tests/harness/{container-milestone7.js,scenarios-milestone7.js,run-milestone7.py,test_milestone7_guards.py}`
- This guide, the Stage 1 results report and the README roadmap reference.

In the new candidate only, existing Inbox, Booking, Outreach and SecureWebhook nodes enable observation. Main business routing stays inherited from M6 except for the four inserted pass-through observation nodes. AI, Calendar, Sheets, messaging and wait nodes are replaced only in the disposable generated test copy, using the same deterministic providers as earlier suites. Original workflow exports and the simulation video are not edited.
