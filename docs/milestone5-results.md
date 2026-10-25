# Milestone 5 — verified results

M5 acceptance run: `.harness-results/m5-d1cd1dbbb4de/summary.json`.
Workflow SHA-256: `6cc177147e6e21ed5781127b17500c5d5c7edc21f522cd4c2ae9abaa0c7f6371`.
Runtime-source SHA-256: `01b2af69b50b20968bd81e2bf45fe315f8e50f72083eef2155b92f3161baae59`.

All 18 approved scenarios and six additional regression/recovery cases pass:
**24/24 scenarios, 33/33 assertions**. These are actual n8n executions with mock providers,
not a replacement by unit tests. There were 33 n8n executions: 32 successful and one
deliberately SIGKILLed after an applied mock Calendar effect. The interrupted case and
later container-restart reconciliation both pass their correctness assertions.

## All approved scenarios

| Scenario | Result |
|---|---|
| successful-create | PASS |
| creation-failure | PASS |
| creation-timeout | PASS |
| concurrent-slot | PASS |
| distinct-slots | PASS |
| outside-hours | PASS |
| conflicting-reschedule | PASS |
| reschedule-success | PASS |
| reschedule-failure | PASS |
| cancel-success | PASS |
| cancel-failure | PASS |
| cancel-uncertain | PASS |
| sheets-failure | PASS |
| repeat-operation | PASS |
| outbound-failure | PASS |
| restart-pending | PASS |
| stale-projection | PASS |
| wrong-event-identity | PASS |
| profile-after-booking | PASS |
| batch-identities | PASS |
| stale-cancellation-consent | PASS |
| unknown-lead-state | PASS |
| legacy-handoff-retained | PASS |
| restart-reconciliation | PASS |

The additional cases check profile retention after booking, batch identity/capacity,
stale cancellation consent, unknown lead-state protection, legacy handoff retention,
and read-only reconciliation after container restart. The stale-projection case explicitly
asserts `outcome=stale` returned by the actual n8n booking operator node. Failed create
checks the mock remote has no event; failed update/cancel check retained remote state.

## Preserved regression comparison

| Candidate | Before scenarios | After scenarios | Before/after assertions |
|---|---|---|---|
| M2 | 17/20 | 17/20 | 37/42 |
| M3 | 29/32 | 29/32 | 59/63 |
| M4 | 55/56 | 55/56 | 104/106 |

Every previous scenario/check-name/status pair matches its saved baseline exactly.
No prior fixture assertions were removed or changed. These known failures remain visible:
M2 has five failing assertions, M3 four, and M4 two. M4 still fails only stale follow-up
and stale handoff suppression, both belonging to M6. Earlier-suite exit code 1 is retained.
M5 itself returns 0.

Regression artifacts:
- M2: `.harness-results/run-6d1524789bf7/summary.json`.
- M3: `.harness-results/run-2e17bc2af209/summary.json`.
- M4: `.harness-results/m4-d893a9337524/summary.json`.

Host checks: **66 unit tests and nine harness safety tests pass**. The original 56 unit
tests and seven safety tests remain included. New unit checks cover typed HTTP adapters,
migration from M4-only and partial-M5 stores, preserved profile information, future-version
rejection and completed-operation replay/conflict protection.

## Isolation, concurrency and recovery

Both M5 phases and both successful M4 phases verified loopback-only interfaces, no
routes and ENETUNREACH probes for IPv4/IPv6. Docker gates verified network=none, non-root,
read-only root, no host binds/ports/capabilities and the exact owned disposable volume.
Authentication values are absent from the exported M5 JSON/log evidence.

Actual n8n execution intervals overlap in both `concurrent-slot` and `distinct-slots`.
One overlapping slot produces one successful Calendar mutation; nonconflicting slots
both succeed. Local holds and provider mock state are shared durably between workers.

The restart case SIGKILLs the n8n worker after a committed mock remote effect but before
local settlement. Following Docker restart, an actual operator n8n execution reads the
durable evidence and confirms the existing result without another mutation. No automatic
uncertain-operation replay or reservation expiry is enabled. Projection retry after
Calendar success performs no additional Calendar mutation or success notification.

## Runtime diagnostic and mitigation

The first M4 rerun (`.harness-results/m4-af6364c7faf6`) aborted with exit 2. The
`replayed-event/execution-56.meta.json` records a native SIGSEGV after a successful
duplicate-only workflow result. That failed run is retained and is not counted as passing.

A test-only JS-runner initialization barrier was added to generated M4/M5 test workflows
and operator tests. It waits for one inert Code task before early exits in this pinned
n8n/Node runtime. Original candidates and fixture assertions are unchanged. The complete
M5 suite and M4 rerun then finished with every expected execution outcome; no SIGSEGV or
other unexpected nonzero exit was ignored. This is a harness mitigation, not a business
logic fix or a claim that an upstream native-runtime defect has been generally resolved.

Earlier M5 artifacts (`m5-5926891a461a`, `m5-be33ab609420`) are diagnostic/intermediate
runs. The latter used a harness-side stale-version precondition; acceptance uses the
final actual n8n stale-result assertion listed above.

## Limits and next milestone

Provider APIs, credentials, OAuth scopes and live response contracts remain unverified.
HTTP adapters are unit-tested with injected fake transport; n8n integration tests use the
durable deterministic provider interface. Calendar manual/external writers bypassing SQLite
remain a residual conflict risk. SQLite is a single-host authority, not a multi-host service.
Capacity greater than one is rejected; full multi-business/tenant support is not implemented.
Remote effects are not claimed exactly once. Unknown mutations/writes/sends stay blocked
when evidence is insufficient. Native Wait durability, autonomous recovery queues and
delivery confirmation are outside this milestone.

The next scoped work is M6: follow-up and handoff eligibility. Nothing from M6–M8 was
implemented. No live API calls, production activation, deployment, commit or push occurred.

The final run also binds authorization to the captured booking ID/version. The native
`stale-cancellation-consent` operator case proves old consent cannot delete a newer
appointment after rescheduling. Unknown lead labels still block mutations, and legacy
manual-call labels migrate to the separate handoff field without losing the request.

Final host check logs: `.harness-results/m5-host-checks-6ad297ce24e5/unit.log` and `.harness-results/m5-host-checks-6ad297ce24e5/safety.log`.
