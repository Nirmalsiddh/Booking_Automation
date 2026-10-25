# Milestone 4 — observed results

Final full run: `.harness-results/m4-7f6805fab746/summary.json`.
Source SHA-256: `d3bf3ef31c81bf507973e61f2d2d44c7aed277590e51431b8826ff190cbd6d06`.

- 55/56 scenarios pass; 104/106 assertions pass.
- All 22 added security/recovery cases and both container-restart phases pass.
- Inherited M3 cases: 31/32 scenarios pass (M3 previously 29/32).
- 59 top-level n8n executions: 57 successful, two intentionally SIGKILLed.
- One additional interleaved n8n reply succeeded: 60 executions total.
- 42 Node unit tests and seven Python harness safety tests pass.

## Full scenario results

| Scenario | Result |
|---|---|
| new-inquiry | PASS |
| existing-inquiry | PASS |
| multi-turn-qualification | PASS |
| new-booking | PASS |
| reschedule | PASS |
| cancellation | PASS |
| decline | PASS |
| invalid-ai | PASS |
| calendar-failure | PASS |
| duplicate-webhook | PASS |
| reply-during-follow-up | FAIL |
| validated-partial-profile | PASS |
| invalid-profile-patch | PASS |
| null-profile-patch | PASS |
| confirmed-inquiries | PASS |
| decline-with-booking | PASS |
| invalid-booking-transitions | PASS |
| unknown-state | PASS |
| reengage | PASS |
| cancelled-rebooking | PASS |
| ai-without-authorization | PASS |
| ai-date-mismatch | PASS |
| ai-extra-field | PASS |
| ai-wrong-type | PASS |
| impossible-date | PASS |
| past-date | PASS |
| outside-hours | PASS |
| cancel-without-confirmation | PASS |
| cancel-stale-confirmation | PASS |
| cancel-confirmation-conversation | PASS |
| safe-response | PASS |
| invalid-inbound | PASS |
| valid-authentication | PASS |
| missing-authentication | PASS |
| invalid-authentication | PASS |
| malformed-payload | PASS |
| unsupported-type | PASS |
| delivery-receipt | PASS |
| bot-echo | PASS |
| sequential-duplicate | PASS |
| concurrent-duplicate | PASS |
| multiple-messages | PASS |
| interrupted-before-effects | PASS |
| recoverable-failure | PASS |
| replayed-event | PASS |
| missing-message-id | PASS |
| valid-existing-booking | PASS |
| interrupted-after-effect | PASS |
| changed-payload-id | PASS |
| concurrent-distinct | PASS |
| invalid-content-type | PASS |
| oversized-payload | PASS |
| unconfigured-authentication | PASS |
| mixed-batch | PASS |
| container-restart-before | PASS |
| container-restart | PASS |

## Remaining failures

- Stale follow-up is suppressed: FAIL.
- Stale handoff is suppressed: FAIL.

Both belong to `reply-during-follow-up`; its profile/booking-state protection and
interleaved booking still pass. The command returns exit code 1 to keep these failures
visible. No final-suite safety or unexpected execution error was tolerated.

## Concurrency and recovery evidence

Actual n8n execution timestamps overlap for both concurrent duplicate and different-ID
cases. Duplicate requests produce one AI call, one Calendar operation and one outgoing
notification; different IDs for different synthetic phones progress independently.

The interrupted-before-effects case has attempts=2 and completed status after controlled
retry. The recoverable pre-effect failure case also completes on attempt 2. The process
killed after a mock Calendar effect remains uncertain with attempts=1; redelivery causes
no additional AI/Calendar work and no notification. The old owner cannot acquire another
operation after recovery. SQLite unit tests additionally confirm eight concurrent claimant
processes produce only one owner and a held write lock times out in about 1.5 seconds.

After the actual Docker restart, the completed message is still present and duplicate
dispatch performs zero mock operations. Both pre- and post-restart isolation evidence
show only loopback, no routes, ENETUNREACH for IPv4/IPv6 probes and no credentials in the
container environment. The only persistent mount was the exact owned disposable volume.
It was removed after export; no test resource reset touched earlier reports.

Exported JSON/log evidence was scanned for both synthetic authentication values: neither
appears. Source files deliberately contain a clearly synthetic test key, never a real one.

## Comparison and contract changes

Sequential duplicates and the injected Calendar-error scenario now pass. Continued
error items become uncertain and stop downstream actions, which avoids the former false
Sheet confirmation in that scenario. This is not general provider success-schema validation.

The original M3 fixtures remain unchanged. M4 assigns unique IDs to distinct conversation
turns and preserves duplicate IDs for duplicate tests. Oversized inbound content is now
rejected before any n8n/mock processing; its M4 assertion reflects HTTP ingress rejection.
This changed-contract suite is not an identical-input comparison. Earlier tests remain
available against their preserved candidates.

## Earlier diagnostic runs

A first booking/restart smoke run (`m4-9151a1378530`) exited 2 on a dispatch error after
the restart, despite an n8n success result in its log. That run did not record subprocess
exit metadata, so the exact failure could not be established. It was not counted as a
pass. Exit/signal/node metadata was added; the subsequent concurrent/restart smoke
(`m4-706910b22c31`) and the final full run completed without that error. All diagnostic
artifacts are retained. No exception or nonzero subprocess exit was suppressed.

## Unverified areas

Live WHAPI capabilities and provider authentication, native custom-trigger hosting, native
Gemini/memory behavior, native durable waits, same-customer concurrent profile updates,
calendar overlap prevention and exactly-once remote delivery remain unverified or outside
scope. The native webhook adapter is unit-tested; real HTTP tests use the shared boundary
on loopback and then run the sanitized items through actual n8n CLI executions.

## Preserved M3 compatibility rerun

`.harness-results/run-4872f5c2df99/summary.json` reproduces all 63 original M3
assertion outcomes exactly: 29/32 scenarios and 59/63 assertions pass, with the same
four failures. This run used the consolidated image with the unchanged M3 runner and
fixtures. No prior regression was hidden or removed. Original workflow bytes and the
M2/M3 candidate hashes were verified unchanged after testing.
