# Milestone 2 comparison

Mock-backed n8n execution; no live integration verification.

| Scenario | Baseline | Milestone 2 |
|---|---|---|
| new-inquiry | PASS | PASS |
| existing-inquiry | FAIL | PASS |
| multi-turn-qualification | FAIL | PASS |
| new-booking | PASS | PASS |
| reschedule | PASS | PASS |
| cancellation | PASS | PASS |
| decline | PASS | PASS |
| invalid-ai | PASS | PASS |
| calendar-failure | FAIL | FAIL |
| duplicate-webhook | FAIL | FAIL |
| reply-during-follow-up | FAIL | FAIL |
| validated-partial-profile | FAIL | PASS |
| invalid-profile-patch | FAIL | PASS |
| null-profile-patch | FAIL | PASS |
| confirmed-inquiries | FAIL | PASS |
| decline-with-booking | FAIL | PASS |
| invalid-booking-transitions | FAIL | PASS |
| unknown-state | FAIL | PASS |
| reengage | FAIL | PASS |
| cancelled-rebooking | PASS | PASS |

## Fixed assertions

- existing-inquiry: Previously collected email and goal survive an inquiry
- multi-turn-qualification: Email survives subsequent qualification
- multi-turn-qualification: Fresh and existing lead use the same memory session
- reply-during-follow-up: Later escalation does not overwrite newer lead state
- validated-partial-profile: Valid partial patch updates supplied fields and preserves others
- invalid-profile-patch: Invalid profile fields cannot replace valid saved values
- null-profile-patch: Null and empty updates preserve all saved profile values
- confirmed-inquiries: Inquiries cannot downgrade a confirmed booking or its slot
- confirmed-inquiries: Qualified lead and handoff are separate fields
- confirmed-inquiries: Blocked rebooking performs no calendar mutation
- decline-with-booking: Declining changes engagement without cancelling existing booking
- invalid-booking-transitions: Missing booking cannot be rescheduled or cancelled
- unknown-state: Unknown state is preserved and blocks destructive actions
- reengage: Customer-initiated inquiry can reengage closed lead

## Regressions

None.

## Remaining failures

- calendar-failure: Failed calendar operation cannot mark booking confirmed
- calendar-failure: Failed calendar operation cannot send success confirmation
- duplicate-webhook: Duplicate message is processed only once
- reply-during-follow-up: Stale follow-up is suppressed
- reply-during-follow-up: Stale handoff is suppressed
