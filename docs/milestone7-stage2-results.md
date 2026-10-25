# Milestone 7 Stage 2 verification results

This is the historical Stage 2 acceptance record before the final-review corrections. See [the correction report](milestone7-corrections.md) for the subsequent defects, fixes and newly executed verification.

Implemented M7.4–M7.6 on `feature/milestone7-stage1`, based on unchanged HEAD `dc1666c6c7fc73168470cc6b73d823aee7029401`. Stage 1 was preserved and extended; changes remain uncommitted. No push, deployment, live provider call or production workflow activation occurred.

## Actually executed verification

- Initial Stage 1 baseline rerun: **109/109 unit tests**, **15/15 safety tests**. Its saved 48-scenario/342-assertion native evidence was reviewed before changes.
- Final source: **119/119 unit tests**, **18/18 safety tests**.
- Complete native M7 suite: **78/78; 552/552** (passing scenarios/total; passing assertions/total).
- Actual n8n CLI executions: **203**; native status counts `{"error": 4, "interrupted": 3, "success": 196}`. Injected errors and SIGKILL interruptions remain visible as failed/interrupted native executions; the scenario passes only when its safety assertions pass.
- All **48 Stage 1 scenarios and 342 assertion outcomes** are retained and match the saved Stage 1 results within the expanded suite. These are not a separate rerun of the original Stage 1 runner; they execute in the Stage 2 harness with the preserved business assertions. Completed success/error execution retention is distinguished from private interrupted in-flight records.
- Workflow SHA-256: `504c995fb989ffb03c5b991da11b0d4f56185ba70f9b92fffa64be50da62299c`.
- Current source/harness digest: `74fdd1d61566d366d421f36b98c2915f21a334729fa461492da7ee4d51bf6829`; verified against the completed run.
- Evidence directory: `.harness-results/m7s2-9daf74579f4b/`, ignored by Git. It contains summaries, sanitized per-scenario operational/recovery journals, execution metadata, isolation/privacy checks and retention counts. Raw runtime output, databases, customer/model content and credentials are not exported.

All 22 requested recovery categories are covered, with additional permanent-failure, backoff, explicit concurrency overlap, handoff, authorization, readback and post-effect audit-failure checks. Actual n8n routing, expressions, paired items, domain transformations, error boundaries and mock integrations execute in the isolated container; unit tests are not substitutes for these runs.

## Before/after M2–M6 regression comparison

Entries show passing scenarios/total; passing assertions/total. Every scenario/assertion status was compared, including known failures. These suites actually ran after the complete M7 run using the combined image and instrumentation disabled in their preserved candidates.

| Suite | Saved Stage 1 checkpoint | Stage 2 rerun | Comparison | New local evidence |
| --- | --- | --- | --- | --- |
| M2 | 17/20; 37/42 | 17/20; 37/42 | Exact assertion match | `run-58db20a5da01` |
| M3 | 29/32; 59/63 | 29/32; 59/63 | Exact assertion match | `run-a0ac5ad48bf2` |
| M4 | 55/56; 104/106 | 55/56; 104/106 | Exact assertion match | `m4-5e6888b1410a` |
| M5 | 24/24; 33/33 | 24/24; 33/33 | Exact assertion match | `m5-32816597d1cb` |
| M6 | 35/35; 35/35 | 35/35; 35/35 | Exact assertion match | `m6-197647a0c083` |

### Historical failures remain visible

- M2 `calendar-failure`: Failed calendar operation cannot mark booking confirmed — **FAIL**, unchanged.
- M2 `calendar-failure`: Failed calendar operation cannot send success confirmation — **FAIL**, unchanged.
- M2 `duplicate-webhook`: Duplicate message is processed only once — **FAIL**, unchanged.
- M2 `reply-during-follow-up`: Stale follow-up is suppressed — **FAIL**, unchanged.
- M2 `reply-during-follow-up`: Stale handoff is suppressed — **FAIL**, unchanged.
- M3 `calendar-failure`: Failed calendar operation cannot mark booking confirmed — **FAIL**, unchanged.
- M3 `duplicate-webhook`: Duplicate message is processed only once — **FAIL**, unchanged.
- M3 `reply-during-follow-up`: Stale follow-up is suppressed — **FAIL**, unchanged.
- M3 `reply-during-follow-up`: Stale handoff is suppressed — **FAIL**, unchanged.
- M4 `reply-during-follow-up`: Stale follow-up is suppressed — **FAIL**, unchanged.
- M4 `reply-during-follow-up`: Stale handoff is suppressed — **FAIL**, unchanged.

The baseline-aware M2/M3 runner flags and M4's exit code 1 do not relabel these assertions. The original candidate files and expected outcomes were not changed to obtain passing tests.

## Complete native scenario inventory

Each scenario also checks operational recording, AI duration where applicable, provider trace relationships, the read-only diagnostic CLI, redacted exports and zero completed success/error execution-data rows.

| Scenario | Result | Assertions |
| --- | --- | --- |
| `recovery-pre-effect` | PASS | 7/7 |
| `recovery-definitive-failure` | PASS | 7/7 |
| `recovery-uncertain-result` | PASS | 7/7 |
| `recovery-calendar-reconcile` | PASS | 7/7 |
| `recovery-insufficient-evidence` | PASS | 7/7 |
| `recovery-duplicate-request` | PASS | 7/7 |
| `recovery-request-conflict` | PASS | 7/7 |
| `recovery-concurrent` | PASS | 7/7 |
| `recovery-stale-version` | PASS | 7/7 |
| `recovery-revoked-consent` | PASS | 7/7 |
| `recovery-eligibility-changed` | PASS | 7/7 |
| `recovery-interrupted-worker` | PASS | 7/7 |
| `recovery-unverified-worker` | PASS | 7/7 |
| `recovery-failed-sheets` | PASS | 7/7 |
| `recovery-uncertain-sheets` | PASS | 7/7 |
| `recovery-failed-outbound` | PASS | 7/7 |
| `recovery-uncertain-outbound` | PASS | 7/7 |
| `recovery-confirmed-preserved` | PASS | 7/7 |
| `recovery-restart` | PASS | 7/7 |
| `recovery-audit-failure` | PASS | 7/7 |
| `recovery-redaction` | PASS | 7/7 |
| `recovery-cli-readonly` | PASS | 7/7 |
| `recovery-bounded-backoff` | PASS | 7/7 |
| `recovery-handoff-transitions` | PASS | 7/7 |
| `recovery-authorization-denied` | PASS | 7/7 |
| `recovery-sheets-readback` | PASS | 7/7 |
| `recovery-outbound-readback` | PASS | 7/7 |
| `recovery-permanent-failure` | PASS | 7/7 |
| `recovery-post-effect-audit-failure` | PASS | 7/7 |
| `eligible-followup` | PASS | 7/7 |
| `reply-before-followup` | PASS | 7/7 |
| `booking-before-followup` | PASS | 7/7 |
| `optout-before-followup` | PASS | 7/7 |
| `declined-contact` | PASS | 7/7 |
| `duplicate-job` | PASS | 7/7 |
| `concurrent-workers` | PASS | 7/7 |
| `restart-pending` | PASS | 7/7 |
| `outbound-failure` | PASS | 7/7 |
| `outbound-uncertain` | PASS | 7/7 |
| `superseded-sequence` | PASS | 7/7 |
| `new-sequence-eligible` | PASS | 7/7 |
| `handoff-due` | PASS | 7/7 |
| `duplicate-handoff` | PASS | 7/7 |
| `assigned-handoff` | PASS | 7/7 |
| `resolved-handoff` | PASS | 7/7 |
| `timezone-boundary` | PASS | 7/7 |
| `outside-sending-hours` | PASS | 7/7 |
| `maximum-attempts` | PASS | 7/7 |
| `booking-state-preserved` | PASS | 7/7 |
| `legacy-assigned-handoff` | PASS | 7/7 |
| `legacy-resolved-handoff` | PASS | 7/7 |
| `decline-survives-inquiry` | PASS | 7/7 |
| `explicit-reoptin-after-decline` | PASS | 7/7 |
| `unknown-consent` | PASS | 7/7 |
| `revoked-consent` | PASS | 7/7 |
| `revocation-invalidates-jobs` | PASS | 7/7 |
| `inquiry-no-consent` | PASS | 7/7 |
| `explicit-customer-optin` | PASS | 7/7 |
| `duplicate-consent-update` | PASS | 7/7 |
| `revocation-versus-dispatch` | PASS | 7/7 |
| `no-consent-booking-confirmation` | PASS | 7/7 |
| `outdated-handoff-suppressed` | PASS | 7/7 |
| `ops-creation-failure` | PASS | 8/8 |
| `ops-creation-timeout` | PASS | 8/8 |
| `ops-reschedule-failure` | PASS | 8/8 |
| `ops-cancel-failure` | PASS | 8/8 |
| `ops-cancel-uncertain` | PASS | 8/8 |
| `ops-distinct-slots` | PASS | 7/7 |
| `ops-concurrent-slot` | PASS | 7/7 |
| `ops-wrong-event-identity` | PASS | 8/8 |
| `ops-batch-identities` | PASS | 7/7 |
| `ops-invalid-ai` | PASS | 7/7 |
| `ops-audit-failure` | PASS | 7/7 |
| `ops-sheets-failure` | PASS | 7/7 |
| `ops-private-profile` | PASS | 7/7 |
| `ops-post-effect-audit-failure` | PASS | 7/7 |
| `restart-execution` | PASS | 7/7 |
| `recovery-restart-reconciliation` | PASS | 7/7 |

## Guarantees exercised

- Stable request IDs are idempotent; conflicting reuse is rejected. Canonical target claims and current domain state prevent concurrent duplicate effects. Native recovery workers overlap in the concurrency case.
- Exact plan snapshots fence current booking/version, recipient, consent, activity, handoff, ownership and rules. A new ID or projection alias cannot reset the attempt budget.
- Actual supervised worker acquisition binds ownership. Verified close/group termination supplies join evidence; fabricated strings, missing bindings and elapsed time do not. Stale actors cannot reuse old ownership.
- Only classified transient no-effect failures retry. Permanent or unclassified failures, uncertain sends and uncertain Calendar mutations remain blocked. Calendar reconciliation reads positive provider evidence and never replays a Calendar mutation.
- Backoff and the three-attempt limit persist. There is no retry daemon, force override or automatic resend.
- Pre-effect recovery changes a proved-safe inbox claim to retryable without reconstructing or dispatching a customer request. Follow-ups require current explicit consent and eligibility. Resolved handoffs cannot be reopened.
- Audit failure before effects rolls back the local action. Post-effect audit failure leaves durable dispatch evidence; a later operator read reconciles it without another mutation. Confirmed bookings survive projection/notification failures.
- A real container restart retains pending jobs and interrupted recovery state. The subsequent read-only reconciliation uses retained provider evidence and trusted prior join proof. It does not pretend that an unobserved whole-container death supplies proof.

## Isolation, privacy and retention

Docker verification confirms network none, init enabled, non-root UID, read-only root, dropped capabilities, no-new-privileges, no host binds/published ports and one uniquely owned disposable volume. In-container checks confirm loopback-only interfaces, no routes, unreachable documentation-only IPv4/IPv6 probes and no credential environment before execution. All providers and customer records are synthetic. No executable managed worker group remains when verified joined evidence is recorded; Docker init reaps orphaned descendants.

The final export scan checked the actual authority token and worker secrets, plus synthetic conversation/profile/identity canaries. Privacy evidence: `{"authoritySecretRedacted": true, "privateCanariesRedacted": true, "rawRuntimeExported": false, "workerSecretsRedacted": true}`. Requests expose only opaque references, allow-listed statuses/reasons and numeric version/time data. Private mappings, source keys, payloads, recipients, raw exceptions and provider/model text remain outside diagnostic exports.

The pinned n8n runtime retained **zero completed success/error execution-data rows** in every scenario. Controlled SIGKILL can leave private in-flight rows; the maximum observed count was **3**. Counts are reported separately rather than claiming abrupt interruption saves nothing. No raw runtime database is exported, and only the owned disposable runtime/volume is removed after testing. Existing synthetic evidence is preserved.

Earlier development runs are retained separately. They exposed a missing policy-file image dependency and an inbox timestamp-column mismatch. Additional review tightened permanent/unclassified failure handling and worker descendant cleanup. Those incomplete runs are not acceptance evidence. The final source-digest-verified run above is the acceptance run.

## Files and components

The new inactive `workflows/milestone7-stage2.json` retains 116 business/observation nodes. No recovery node or tool is added to the customer graph. The test-only `RecoveryHarness` node runs a separate manually triggered operator graph. Shared Inbox and Outreach claim code adds optional supervised binding; isolated Booking/Outreach mock adapters add trusted recoverability evidence. The original CLI commands remain read-only; only the explicit new recovery command path can mutate, behind isolation and authorization checks.

Stage 2 files added beyond the Stage 1 snapshot:

- `config/recovery.json`
- `docs/milestone7-stage2-results.md`
- `docs/milestone7-stage2.md`
- `scripts/build-milestone7-stage2.js`
- `src/operations/recovery-cli.js`
- `src/recovery/catalog.js`
- `src/recovery/engine.js`
- `src/recovery/evidence.js`
- `src/recovery/isolation.js`
- `src/recovery/migrations.js`
- `src/recovery/mock-provider.js`
- `src/recovery/plan.js`
- `src/recovery/supervisor.js`
- `src/recovery/worker.js`
- `tests/harness/RecoveryHarness.node.js`
- `tests/harness/container-milestone7-stage2.js`
- `tests/harness/run-milestone7-stage2.py`
- `tests/harness/scenarios-milestone7-stage2.js`
- `tests/harness/test_milestone7_stage2_guards.py`
- `tests/recovery.test.js`
- `workflows/milestone7-stage2.json`

Existing Stage 1 files extended: `src/operations/cli.js`, `src/operations/reader.js`, `src/inbox/sqlite.js`, `src/outreach/scheduler.js`, `src/n8n/Booking.node.js`, `src/n8n/Outreach.node.js`, and the README roadmap. The [Stage 2 guide](milestone7-stage2.md) describes the schema, interfaces, authorization, action matrix and exact reproduction commands. The Stage 1 source snapshot/image archives and its saved reports remain preserved locally.

## Limitations and next step

This remains an isolated mock implementation, not production administration. Real provider acceptance/delivery, OAuth, recoverability/no-effect contracts and Calendar evidence require separate verification. Manual/external Calendar writers can bypass SQLite reservation authority. Local capabilities assume trusted host/container code and UID; production RBAC, secret management, supervisor/orchestrator attestation, fencing, backups and retention policy remain unresolved. Privileged database administrators can bypass application-level append-only protections.

Legacy failures without trusted classification or termination evidence stay blocked. Missing provider evidence and exhausted budgets require manual review. Direct customer replies without durable safe message content are not reconstructed for retry. An abrupt unobserved container/host failure does not authorize reclaim. Native Agent/memory, real provider SDK behavior and native Wait resume remain outside the mock harness. Exact fresh-machine transitive dependency locking is still an existing limitation. The original video's acknowledged publication concerns remain unchanged.

Review this implementation and evidence before approving a local checkpoint or further milestone work. No PostgreSQL, dashboard or Milestone 8 work was added. No additional major architectural decision was required within the approved SQLite/mock-only scope.
