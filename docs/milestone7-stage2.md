# Milestone 7 Stage 2: controlled recovery

This stage extends the preserved [Stage 1 checkpoint](milestone7-stage1.md) with M7.4–M7.6. Recovery is available only inside the verified, disposable Docker mock harness. It is not a production administration interface. The original workflow, M2–M6 candidates, Stage 1 candidate and simulation video remain unchanged. The Stage 2 candidate is inactive and retains the same 116 business/observation nodes; recovery is deliberately absent from its customer-facing graph and Gemini tools.

## Journal and ownership

`src/recovery/migrations.js` installs additive recovery schema version 1 in its own `ops_recovery_migrations` namespace. It does not rewrite inbox, booking, outreach or Stage 1 operational migration histories. Unknown versions fail closed. Plans and ordinary diagnostic commands never migrate a database.

| Table | Responsibility |
| --- | --- |
| `ops_recovery_migrations` | Explicit recovery schema version and installation time |
| `ops_recovery_workers` | Private supervisor-issued identity, secret, actual PID/start time/boot identity, lifecycle and verified join time |
| `ops_recovery_bindings` | Worker-to-target binding committed when the actual worker acquires ownership |
| `ops_recovery_requests` | Stable request UUID, exact opaque target, action, immutable state/version observations and snapshot, eligibility, owner, result and effect reference |
| `ops_recovery_evidence` | Append-only mock-adapter classification of transient/permanent/unclassified no-effect failures, applied results and uncertainty |
| `ops_recovery_claims` | Unique active claim on the canonical logical operation |
| `ops_recovery_events` | Append-only eligibility, dispatch/read attempts, interruption and outcome history with sanitized reasons/evidence references |

Request identities and observed snapshots are immutable. Recovery events reject UPDATE and DELETE. Completed claims may be removed; historical requests and events remain. Like Stage 1, this is application-level protection, not protection against a privileged database administrator.

The snapshot is a server-computed digest of the target, domain rows, booking/revision, activity and consent versions, handoff, relevant current rules, ownership proof and attempt budget. The recorded observations are historical audit facts, not a second authoritative business state machine.

The Docker harness requires `--init` and verifies `HostConfig.Init=true`; Docker's bundled init reaps orphaned runner descendants. Startup fails closed if init or any other isolation requirement cannot be provided. The trusted supervisor launches only pinned n8n or the recovery CLI using a managed child process. It records the actual kernel identity and issues a private worker secret. Inbox/job acquisition binds the actual worker inside the ownership transaction. On termination, the parent observes child close, stops its runner process group, verifies that no executable group members remain, and records joined evidence. Permission or verification failure does not establish termination. PID reuse is checked through process start time and boot identity when using a worker credential.

Recovery accepts no operator-supplied PID, proof string, lease expiry or model-supplied ownership claim. An older unsupervised worker cannot retrospectively obtain trusted proof through the CLI. Missing proof blocks reclaim. Existing M4–M6 synthetic helper interfaces remain for historical compatibility; the new executor never uses their proof-string shortcut.

## Authorization and actions

Mutating execution requires all of:

- `recovery apply --execute`, a stable request UUID, exact target UUID, permitted action and exact plan snapshot.
- The harness-issued operator capability, separate from a normal customer workflow's worker credential.
- A registered, live worker with matching PID/start/boot identity and private credential.
- Verified network isolation, non-root UID, read-only root, dropped capabilities, no-new-privileges, a private authority file and an approved existing `/inbox/booking-*.sqlite` path.
- Host-side validation of the exact image and owned disposable volume before starting the container.

The authority file and worker secrets stay in the private disposable volume and are never exported. This capability model assumes a trusted Docker host, container UID and application code. It is not multi-user RBAC or a security boundary against a malicious host administrator. There is no live recovery provider adapter, configurable endpoint or caller-selectable provider module.

| Action | Eligibility and behavior |
| --- | --- |
| `inbox_pre_effect` | Processing message, verified stopped owner and zero operation records. Atomically changes it to retryable and clears the old owner. Does not reconstruct a customer request from a hash or dispatch anything; a genuine authenticated inbound frame is required afterward. |
| `reconcile` | Uncertain/dispatched Calendar, projection or notification. Performs provider reads only. Applies only matching positive evidence to the exact current version. Absence, timeout or wrong identity leaves uncertainty and holds intact. Sends no confirmation or Calendar mutation. |
| `projection_retry` | Definitively failed projection with a trusted no-effect audit record and transient recoverability evidence, current revision and verified booking. Creates a new attempt, preserves old attempt rows, and uses a version-guarded mock projection update. |
| `notification_retry` | Definitively failed transactional or promotional notification with no-effect proof and transient recoverability evidence. Uses durable verified booking facts or the trusted follow-up template, never model-generated recovery text. Current recipient/version must match. |
| `followup_continue` | Exact eligible pending job, or a claimed job whose owner is verified stopped. Rechecks consent, activity generation, booking snapshot, active rule version, handoff, sending hours, due time and limits. Never selects unrelated work. |
| `handoff_assign` / `handoff_resolve` | Version-guarded permitted transitions from Requested, or resolution from Assigned. Resolved handoffs cannot be reopened through this interface. |

Promotional sends require granted consent. Necessary booking notifications stay transactional. Reconciliation records an already observed result without sending another message, even if consent has since changed; current eligibility still controls any subsequent promotional job. Revocation committed before the final dispatch authorization blocks outreach. A request already authorized/in flight cannot be recalled.

## Idempotency, concurrency and interruption

Reusing an identical recovery request returns its historical result without repeating an effect. Reusing its ID for another target/action/snapshot is rejected. A new ID cannot bypass the canonical logical-operation lock, authoritative domain status, current version or persisted attempt budget. Projection aliases share the customer/revision scope; follow-up job and notification references share one logical scope.

Claims, dispatch records and corresponding domain/audit transitions use SQLite transactions. No business transaction remains open across provider IO. The executor checks its worker/fence and relevant state again before dispatch and before committing results. Stale plans cannot overwrite newer booking state. Normal workflow writers remain subject to existing reservation, projection and notification constraints.

An interruption retains durable intent and uncertainty. No lease reclaims work. A new explicitly authorized read reconciliation may take over an interrupted recovery claim only after trusted joined evidence exists. It records the prior recovery as interrupted and does not replay its mutation. An abrupt whole-container failure without observed join evidence remains blocked for manual review; a restart alone does not fabricate proof.

Critical audit failure rolls back the associated local transition. If an external effect may already have occurred, its prior dispatch evidence remains and no success is invented. SQLite failures expose only a sanitized category, numeric storage code and allow-listed diagnostic phase, never arbitrary exception objects.

## Retry policy

`config/recovery.json` fixes the maximum to three total attempts and configures backoff (currently 1,000 then 5,000 milliseconds). Counts include the original logical transport and recorded recovery sends/reads. New request IDs and target aliases do not reset the budget. Provider availability preflight is a separate read from a mutation attempt. Only classified transient no-effect write retries are permitted. Permanent rejections and unclassified/legacy failures remain blocked; uncertain mutations or sends are never repeated. Reconciliation is an explicitly requested read, also counted and bounded. Budget exhaustion requires manual review; there is no force override, retry loop or daemon.

Transactional retry text is regenerated only from durable booking/operation facts and trusted application templates. Older direct-reply inbox operations lack durable safe message bodies and are unsupported. No customer intent is reconstructed from inbox hashes.

## CLI

The original `status`, `list`, `inspect`, `history` and `health` commands remain read-only. Recovery planning and apply without `--execute` are also read-only, do not initialize schema, and make no provider calls.

```sh
node src/operations/cli.js recovery plan \
  --db /absolute/path/to/disposable.sqlite \
  --target TARGET_UUID --action projection_retry

# Also dry-run: prints the current plan and performs no recovery mutation.
node src/operations/cli.js recovery apply \
  --db /absolute/path/to/disposable.sqlite \
  --target TARGET_UUID --action projection_retry

# Only within an explicitly authorized, supervised harness worker:
node /harness/operations/cli.js recovery apply \
  --db /inbox/booking-SCENARIO.sqlite \
  --target TARGET_UUID --action projection_retry \
  --request-id REQUEST_UUID --snapshot PLAN_DIGEST --execute
```

Plans explain eligibility and blocking reasons and include a bounded sanitized recovery/attempt history. Apply returns the durable request outcome and effect reference. Outcome events point to the associated domain audit event; insufficient evidence points to the observed transport event. A successful notification means verified provider acceptance, not delivery. Exit codes are 0 for a successful apply or completed dry-run, 3 for a recorded blocked/failed/uncertain apply, and 2 for rejected arguments, authorization, isolation or execution errors. Repeated in-flight requests return their existing running state with a busy explanation. Ordinary diagnostic commands retain their existing exit codes.

The harness installs the authority and launches supervised workers. Do not copy its capability into a shell, workflow, model prompt, environment file or repository. Recovery execution on the host or outside the verified harness fails closed. The CLI is intentionally not ready for production administration.

## Native verification and reproduction

Use the unchanged Linux/Docker/Node 24/n8n 2.44.6 setup in [reproducibility.md](reproducibility.md). The combined image additionally copies `src/recovery/`, the two recovery/booking policy JSON files and the deterministic provider fixture; it never pulls or installs dependencies during build.

```sh
node scripts/build-milestone7.js --check
node scripts/build-milestone7-stage2.js --check
node --test tests/*.test.js
python3 -m unittest discover -s tests/harness -p 'test*guards.py'
python3 tests/harness/run-milestone7-stage2.py build
python3 tests/harness/run-milestone7-stage2.py run recovery-failed-sheets
python3 tests/harness/run-milestone7-stage2.py run all
```

The full suite includes every Stage 1 scenario, the 22 requested Stage 2 cases, additional authorization/backoff/handoff/readback cases, and actual container restart verification. The test-only `RecoveryHarness` node invokes the same CLI/service within an operator workflow. It is never installed into the customer-facing candidate. Simulated delays and provider faults use the private synthetic authority clock/configuration. Recovery journal/backoff times use that synthetic business clock; Stage 1 operational events retain their execution wall clock and process-local monotonic durations.

Previous suites run sequentially against the combined local image:

```sh
python3 tests/harness/run.py run all --workflow milestone2 --extended --allow-baseline-failures
python3 tests/harness/run.py run all --workflow milestone3 --allow-baseline-failures
python3 tests/harness/run-milestone4.py run all
python3 tests/harness/run-milestone5.py run all
python3 tests/harness/run-milestone6.py run all
```

Saved historical failures must be compared by scenario and assertion status. The baseline-aware exit flag is not proof that every assertion passed.

## Verification results

See the [Stage 2 results report](milestone7-stage2-results.md) for actual native execution, the full scenario inventory and exact before/after regression comparisons.

## Privacy, retention and remaining limitations

Public diagnostics contain opaque references, closed statuses/codes, numeric versions/times and bounded attempt history. Private identity mappings, recipients, profiles, provider payloads, worker credentials, process identities and the authority token stay outside exports. The final harness scan checks exported diagnostics against the actual authority/worker secrets as well as synthetic conversation/profile/identity canaries.

Pinned n8n save settings and the disposable runtime's `EXECUTIONS_DATA_PRUNE=false` remove completed success/error execution data. A SIGKILL can leave private in-flight n8n rows. Stage 2 reports those counts separately, exports none of that runtime, and disposes only the owned runtime/volume after testing. This does not sanitize an existing production n8n installation or arbitrary process logs. Original Stage 1 evidence remains unchanged.

SQLite and the mock reservation resource remain single-host/capacity-one. Live API/OAuth behavior, provider delivery, external Calendar writers, real operational authorization, backups, access control and retention policy still require separate review. Append-only records are not administrator-proof. Some stale/uncertain work must stay blocked rather than being automatically repaired. Exact fresh-machine transitive dependency locking remains an existing limitation. No dashboard, PostgreSQL, deployment, production activation or Milestone 8 work is included.
