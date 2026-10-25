# Milestone 3 observed results

Actual n8n 2.44.6 execution with synthetic fixtures and mocked providers. No live verification.

Source SHA-256: `5fcae7b87424057323aca0c297a79eee94cb85c31304a1ac3cb128644b7878a6`.

29/32 scenarios pass; 59/63 assertions pass. All 12 new boundary scenarios pass.
39 successful n8n executions, including the interleaved follow-up reply.
29 unit tests (15 preserved + 14 new tests) and five harness safety tests pass.

| Scenario | Outcome |
|---|---|
| new-inquiry | PASS |
| existing-inquiry | PASS |
| multi-turn-qualification | PASS |
| new-booking | PASS |
| reschedule | PASS |
| cancellation | PASS |
| decline | PASS |
| invalid-ai | PASS |
| calendar-failure | FAIL |
| duplicate-webhook | FAIL |
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

## Failures retained

- calendar-failure: Failed calendar operation cannot mark booking confirmed
- duplicate-webhook: Duplicate message is processed only once
- reply-during-follow-up: Stale follow-up is suppressed
- reply-during-follow-up: Stale handoff is suppressed

## Evidence and comparison

Artifacts: `.harness-results/run-fc9dd29dcca9/summary.json` and `all/scenarios/`.
Isolation: network=none, loopback only, no routes, IPv4/IPv6 probes ENETUNREACH,
no credentials, host mounts or published ports; non-root/read-only container.

Milestone 2 previously passed 17/20 scenarios and 37/42 assertions. Milestone 3
passes 17/20 adapted inherited scenarios and all 12 new scenarios. These are not
identical inputs: commands now explicitly authorize actions. Three assertions change
to reflect the new contract (UTC reschedule time, terminal invalid-AI clarification,
and no success claim in message content rather than absence of a named node).
The prior files and assertions remain available unchanged for baseline/M2 execution.

The calendar-failure scenario still fails on stored status. Its outgoing request
acknowledgement no longer claims success, but API-result verification is not implemented.
Default runner exit code is 1 because four behavioral assertions fail; no safety or
execution failure occurred.

Native model/Agent execution, live APIs, memory durability and native Wait/resume are
unsupported by this mock harness. Unit tests inject a fixed clock for temporal edges;
native n8n uses the system clock, so the synthetic 2030 slots eventually need refreshing.

Preserved Milestone 2 suite rerun: `.harness-results/run-b835eeb030d1/summary.json`.
All 42 assertion outcomes exactly match the earlier M2 run: 17/20 scenarios and
37/42 assertions pass, with the same five known failures. Its source hash and network
isolation evidence were verified again. Original workflow bytes and M2 candidate hash
remain unchanged. No test containers remain running.
