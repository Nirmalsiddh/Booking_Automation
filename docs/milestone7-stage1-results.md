# Milestone 7 Stage 1 verification results

Verified on 2026-10-25, on `feature/milestone7-stage1`, based on unchanged HEAD `dc1666c6c7fc73168470cc6b73d823aee7029401`. Changes remain uncommitted. Scope is M7.1–M7.3 only.

## Actual verification

- **109/109 unit tests** passed (93 preserved tests plus 16 operational tests).
- **15/15 harness safety tests** passed (12 preserved plus 3 M7 guards).
- **M7: 48/48 scenarios; 342/342 assertions passed** through actual isolated n8n 2.44.6 execution.
- 121 native CLI executions; status counts: `{"error": 2, "success": 119}`. The injected audit failures are intentionally failed native executions whose safety outcomes are asserted, not relabeled successful n8n executions.
- Source workflow SHA-256: `bd97fdca36cca6dfdedd4104f2a24ca64070dc0490c3a5723c7d7693c9e5931d`.
- Source/harness digest: `340e97dd6809756534f3db156d696fc94b4d85c6f87dd7532f3b77f02c5bd3b6`.
- Saved diagnostic evidence: `.harness-results/m7-379d8ab190f6/summary.json`, `docker-safety.json`, `isolation.json`, `transform-manifest.json`, and per-scenario `operations.json`/sanitized execution metadata. Results are local and ignored, not committed.

Both unit and native tests were run; unit tests are not substitutes for the native results. Native runs retain actual node routing, expressions, paired-item linking, conditional branches, transformations and error boundaries. External providers, model generation, memory and elapsed delays remain mocked/virtualized as described in the transformation manifest.

## Before/after preserved suites

Entries show passing scenarios/total; passing assertions/total. These are fresh executions of the unchanged earlier candidates using the updated shared source with instrumentation disabled. Comparisons use each scenario name and assertion name/status, not just counts.

| Suite | Previously saved baseline | Actually rerun | Comparison | New local evidence |
| --- | --- | --- | --- | --- |
| M2 | 17/20; 37/42 | 17/20; 37/42 | Exact assertion statuses preserved | `run-1de8fbd41fa5` |
| M3 | 29/32; 59/63 | 29/32; 59/63 | Exact assertion statuses preserved | `run-68e418bba5bd` |
| M4 | 55/56; 104/106 | 55/56; 104/106 | Exact assertion statuses preserved | `m4-e45746112e0f` |
| M5 | 24/24; 33/33 | 24/24; 33/33 | Exact assertion statuses preserved | `m5-6f403870283a` |
| M6 | 35/35; 35/35 | 35/35; 35/35 | Exact assertion statuses preserved | `m6-9b68389fd959` |

Saved baseline references: `run-4994d02b66ce`, `run-4eac2bf7d393`, `m4-3777aa79e76c`, `m5-d68f1885a784`, `m6-ec844c1aa305`.

### Existing failures kept visible

- M2 `calendar-failure`: Failed calendar operation cannot mark booking confirmed — **FAIL**, unchanged from the saved baseline.
- M2 `calendar-failure`: Failed calendar operation cannot send success confirmation — **FAIL**, unchanged from the saved baseline.
- M2 `duplicate-webhook`: Duplicate message is processed only once — **FAIL**, unchanged from the saved baseline.
- M2 `reply-during-follow-up`: Stale follow-up is suppressed — **FAIL**, unchanged from the saved baseline.
- M2 `reply-during-follow-up`: Stale handoff is suppressed — **FAIL**, unchanged from the saved baseline.
- M3 `calendar-failure`: Failed calendar operation cannot mark booking confirmed — **FAIL**, unchanged from the saved baseline.
- M3 `duplicate-webhook`: Duplicate message is processed only once — **FAIL**, unchanged from the saved baseline.
- M3 `reply-during-follow-up`: Stale follow-up is suppressed — **FAIL**, unchanged from the saved baseline.
- M3 `reply-during-follow-up`: Stale handoff is suppressed — **FAIL**, unchanged from the saved baseline.
- M4 `reply-during-follow-up`: Stale follow-up is suppressed — **FAIL**, unchanged from the saved baseline.
- M4 `reply-during-follow-up`: Stale handoff is suppressed — **FAIL**, unchanged from the saved baseline.

These older candidate defects are not repaired by Stage 1 or hidden by changing test expectations. M5/M6 retain their later protections. Baseline-aware runner exit codes do not replace the assertion-level comparison above.

## M7 native scenarios

Every row also verifies operational events, AI duration when AI runs, parent/trace relationships, read-only CLI operation, redacted operational exports and zero retained raw execution-data rows after completed success/error executions.

| Scenario | Outcome | Assertions |
| --- | --- | --- |
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

## Isolation and privacy evidence

Host inspection verifies `network=none`, non-root, read-only root, dropped capabilities, no-new-privileges, no host binds, no published ports and one uniquely labeled disposable volume. In-container checks verify loopback-only interfaces, no routes, failed documentation-IP connection probes and no credential environment before execution. Only synthetic providers are used. A controlled container restart preserves pending work in that private volume; no new recovery mutation or retry worker is implemented.

The native audit faults test reservation rollback before a provider mutation and a post-Calendar-effect audit failure that leaves durable dispatched evidence with no success confirmation. Provider-result uncertainty remains blocked from blind repetition. Concurrent capacity-one reservations, distinct slots, failed rescheduling/cancellation, failed projection, rejected AI, consent and handoff behavior are included.

The pinned n8n runtime was inspected for supported workflow save settings. Initial verification found that pruning defaults to soft deletion, retaining execution-data rows temporarily even with saving disabled. The disposable M7 runtime therefore sets supported `EXECUTIONS_DATA_PRUNE=false`, and the final suite verifies no `execution_data` rows after successful and failed executions. This is not a cleanup of any existing runtime. Abrupt process termination can still leave private in-flight runtime data, which is never exported.

Raw n8n stdout/stderr stays in memory. Exported execution metadata omits result objects, prompts, responses and business snapshots. All files in the final M7 evidence directory were scanned for synthetic identity, profile and conversation canaries and internal `source_key` fields; none were present. Private identity mappings and necessary synthetic business profiles remain inside the owned disposable database until cleanup. Unit tests additionally verify arbitrary error redaction, rejected-ingress logging, missing-file behavior, future-schema rejection and CLI non-mutation.

Earlier partial M7 diagnostic runs are preserved separately. They include the initial retention failure and interrupted development checks; they are superseded by the complete final source-digest-verified run, not presented as passing acceptance evidence.

## Preservation and remaining limitations

Original `workflow.json`, M2–M6 candidate JSON and the video remain byte-identical to the approved baseline. M7 remains inactive. The M1–M6 checkpoint and hardening commits remain reachable. `origin/main` remains at the locally verified baseline ref; this task does not push, fetch, merge or deploy.

No live provider integrations, message delivery, production schedules, native Agent/memory persistence or native Wait resume behavior are verified. Diagnostic history/list output is bounded without pagination; historical legacy records do not gain invented traces or durations. Health reports current local ledger/storage state, not a provider health probe or readiness guarantee. Append-only protection is not tamper-proof against an administrator. Internal mappings and backups need filesystem access control. Automatic retention deletion is deliberately absent. Exact fresh-machine transitive dependency reproduction remains an existing limitation.

M7.4–M7.6 remain pending: controlled recovery planning/execution and recovery-specific concurrency/interruption verification. No recovery commands, automatic retries, new dashboard/database service or M8 work were added. No further architectural approval was needed for Stage 1; approval is required before implementing the remaining stage or committing/pushing these changes.
