# Milestone 6 — verified results

Milestone 6 is complete within the isolated synthetic scope. The inactive 112-node
candidate is `workflows/milestone6.json`; all original/M2–M5 workflow files remain unchanged.
Promotions require explicit opt-in and current eligibility. Direct replies and verified
booking communications remain separate. Durable jobs replace reachable Wait paths;
versioned handoffs use None → Requested → Assigned/Resolved and Assigned → Resolved.

## Final acceptance evidence

- **35/35 scenarios, 35/35 assertions pass**: all 20 required cases,
  14 additional consent/preservation/recovery cases and the actual restart phase.
- **108 actual n8n CLI executions**: 107 completed successfully and
  1 was deliberately SIGKILLed after durable mock acceptance.
  The interruption/recovery assertions pass; no unexpected execution failure is ignored.
- **93 unit tests and 12 safety tests pass**; original 66 unit and nine safety tests remain.
- Native acceptance: `.harness-results/m6-ec844c1aa305/summary.json`.
- Host evidence: `.harness-results/m6-final-host-85ae9d04b3dc`.
- Workflow SHA-256: `1e779a6f75d8accec7d877f56a804dc06f16c8b1c71bdcb7f4c5457cdb28c050`.
- Runtime-source SHA-256: `aaf0d16dd811bd7fd7f89326ccac4f474ea8e6f2389d63a5c92fefb11b173079`.

The final run verifies real n8n routing, expressions (including consent acknowledgements),
item linking, custom nodes, SQLite transactions, mock operation interactions, native
concurrent CLI workers, controlled termination and a Docker container restart.
External provider calls and time are mocked. No live integration is verified.

## All scenario outcomes

The first 20 rows correspond to the requested M6 scenarios. Every suppression scenario
asserts absence of prohibited promotional sends. Direct replies remain available.

| Scenario | Outcome |
|---|---|
| eligible-followup | PASS |
| reply-before-followup | PASS |
| booking-before-followup | PASS |
| optout-before-followup | PASS |
| declined-contact | PASS |
| duplicate-job | PASS |
| concurrent-workers | PASS |
| restart-pending | PASS |
| outbound-failure | PASS |
| outbound-uncertain | PASS |
| superseded-sequence | PASS |
| new-sequence-eligible | PASS |
| handoff-due | PASS |
| duplicate-handoff | PASS |
| assigned-handoff | PASS |
| resolved-handoff | PASS |
| timezone-boundary | PASS |
| outside-sending-hours | PASS |
| maximum-attempts | PASS |
| booking-state-preserved | PASS |
| interrupted-send | PASS |
| legacy-assigned-handoff | PASS |
| legacy-resolved-handoff | PASS |
| decline-survives-inquiry | PASS |
| explicit-reoptin-after-decline | PASS |
| unknown-consent | PASS |
| revoked-consent | PASS |
| revocation-invalidates-jobs | PASS |
| inquiry-no-consent | PASS |
| explicit-customer-optin | PASS |
| duplicate-consent-update | PASS |
| revocation-versus-dispatch | PASS |
| no-consent-booking-confirmation | PASS |
| outdated-handoff-suppressed | PASS |
| restart-execution | PASS |

The additional cases cover post-dispatch interruption without resend, legacy Assigned
and Resolved preservation, decline surviving a later inquiry, explicit re-opt-in,
unknown/revoked consent, immediate cancellation on revocation, inquiry without consent,
customer opt-in, duplicate audit updates, concurrent revocation, transactional booking
without promotional consent and suppression of outdated escalation. The restart phase
uses the same persisted pending job after a real Docker restart.

Concurrency checks assert overlapping native CLI execution intervals, one accepted logical
promotion for two workers, and no promotion when a concurrent revocation commits before
the worker's dispatch boundary. Unit tests cover revocation after dispatch and prevent
successor jobs. The request already in flight cannot be recalled.

## Previous milestone regression comparison

| Candidate | Before scenarios | After scenarios | Passing assertions | Status comparison |
|---|---|---|---|---|
| M2 | 17/20 | 17/20 | 37/42 | exact match |
| M3 | 29/32 | 29/32 | 59/63 | exact match |
| M4 | 55/56 | 55/56 | 104/106 | exact match |
| M5 | 24/24 | 24/24 | 33/33 | exact match |

All scenario/check-name/status tuples match exactly. Existing failures are retained,
not relabeled passing. M2 has five failing assertions, M3 four and M4 two (stale follow-up
and handoff suppression). M5 has no failing assertions. The preserved M2/M3/M4 runners
exit 1 for their known defects; M5 and M6 exit 0. M6's corresponding new suppression
cases pass. Earlier candidates are intentionally unchanged.

Evidence and exact comparisons:
`.harness-results/m6-verification-460f68f3eadf/baseline-comparison.json`.

- M2: `.harness-results/run-4994d02b66ce/summary.json`.
- M3: `.harness-results/run-4eac2bf7d393/summary.json`.
- M4: `.harness-results/m4-3777aa79e76c/summary.json`.
- M5: `.harness-results/m5-d68f1885a784/summary.json`.

The regression runs used the consolidated local runtime before the final M6-only review
changes. Shared M2–M5 source/candidate bytes are identical in the final image; preserved
M5 runtime digest remains `01b2af69b50b20968bd81e2bf45fe315f8e50f72083eef2155b92f3161baae59`.
No prior assertions or fixtures were weakened.

## Isolation and retained diagnostics

Both final phases verify Docker network=none, no host binds/ports, non-root/read-only,
dropped capabilities and the exact labeled disposable volume. In-container checks require
loopback only, no routes and failed IPv4/IPv6 connectivity probes before workflow execution.
Artifacts include `docker-safety.json`, both phase isolation records and mock operation
ledgers. No production credentials, real customer information or live calls are used.

An initial attempt to build concurrently with an M5 rerun exhausted vfs inodes. That
attempt is an infrastructure failure, not a pass: `.harness-results/m5-338333087d3a`
retains its safety record and container log. Docker could not create an exec FIFO to
export its tmpfs evidence. A fresh sequential M5 rerun passes all 24 cases. The runner
now rejects insufficient inode space, and subsequent builds/tests ran sequentially.

Images preceding consolidation were archived before exact task image/cache replacement:
`/tmp/booking-m5-complete-image.tar` and `/tmp/booking-m1-preserved-image.tar`.
No broad prune or user-data deletion occurred. Initial M6 smoke and 31-case passing
runs remain in `.harness-results/m6-9b3449e4041f` and `m6-cc6f7d94f2e9`; the final
35-case artifact above is acceptance evidence.

## Files and nodes

New files:
- `config/followups.json`
- `src/outreach/store.js`, `src/outreach/scheduler.js`
- `src/n8n/Outreach.node.js`
- `scripts/build-milestone6.js`, `workflows/milestone6.json`
- `tests/outreach.test.js`
- `tests/harness/OutreachProvider.js`, `OutreachControl.node.js`, `scenarios-milestone6.js`,
  `container-milestone6.js`, `run-milestone6.py`, `test_milestone6_guards.py`
- `docs/milestone6.md`, `milestone6-results.md`, `milestone6-progress.md`

Existing file appended: `tests/harness/README.md` (M6 documentation link).
Six new M6-only nodes are described in `milestone6.md`. In the M6 copy, inbound/engagement
edges and direct-reply completions route through the scheduler, historical delayed paths
are disconnected, and five immediate WHAPI bodies gain trusted consent acknowledgements.
The booking engine, original workflow, M2–M5 candidates and their node definitions are
unchanged. No commits, pushes, publication, deployment or live activation occurred.

## Limits and next step

Live providers, provider consent rules, legal requirements, OAuth, delivery and native
schedule activation are unverified. Tests explicitly run the custom worker through a
Manual Trigger; the candidate schedule remains inactive. Acceptance does not imply delivery.
SQLite is single-host, and every participating writer must use its authority. Sending
hours support one same-day interval; there is one job per tick. Staff/operator access
control and controlled configuration rollout require review before deployment. Legacy
handoff timestamps are explicitly import times, not claimed historical evidence.

A committed revocation blocks future authorization; an already authorized in-flight send
cannot be unsent. Uncertain sends remain identifiable and never retry automatically.
Recovery requires genuine stopped-and-joined owner proof from a trusted caller. There is
no general monitoring/recovery daemon or staff dashboard. Synthetic 2030 test dates will
eventually need refreshing. No M7/M8 features were implemented.

See `milestone6.md` for architecture, consent, migration, recovery and reproduction
commands. Recommended next milestone: separately scoped M7 observability/recovery.
Stop at M6; no later milestone is authorized by this completion.

Final preservation/cleanup evidence:
`.harness-results/m6-final-host-85ae9d04b3dc/preservation.json`.
Branch remains `work`, HEAD remains `2fd834a5849bde686d9b8b236631e18c0679528d`.
Original/M2–M5 hashes match their checkpoints; every candidate remains inactive.
No test containers or owned inbox volumes remain. Both final phases report ENETUNREACH
for IPv4 and IPv6 probes. Measured native worker overlap was 5,446 ms for competing
workers and 6,673 ms for revocation versus dispatch.
