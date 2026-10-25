# Milestone 2 — State and profile correctness

The original `workflow.json` is the immutable Milestone 1 baseline. The new
`workflows/milestone2.json` is an **inactive candidate**, exercised only through the
network-disabled mock harness. Do not activate/import it into a live instance as part
of these instructions. No real credentials, customer records, messages, or calendar
operations are needed. There is no PostgreSQL or multi-business implementation.

## Source and build

`src/state-profile.js` defines pure validation, profile merge, legacy normalization,
and transition rules. `scripts/build-milestone2.js` embeds those rules into a standalone
n8n export; no custom runtime module is required by that export.

```bash
node scripts/build-milestone2.js
node scripts/build-milestone2.js --check
node --test tests/state-profile.test.js
```

Always regenerate and rebuild the test image after editing rules. `--check` fails if
the committed candidate is out of date. The original baseline is never rewritten.
Native AI generation and conversation memory remain outside harness coverage.

## Customer profile contract

- Missing, null, blank, and string `"null"` fields mean **no update**, never deletion.
- Existing name is retained when WhatsApp display names change. `collected_data.full_name`
  explicitly updates it; the display name initializes only a missing name.
- Accepted fields: full name, email, goal, experience, and injuries. Unknown keys are ignored.
- Strings are trimmed; control characters, wrong types, and oversized values are rejected.
- Email must have a basic email structure. Experience is normalized to beginner,
  intermediate, or advanced. Name/email/experience max length is 120, goal 300, injuries 500.
- `profile_patch` records accepted changes, `rejected_profile_fields` identifies invalid
  fields, and merged values are used in Sheets mappings. These are profile safeguards,
  not the full AI response schema or a security audit.
- Empty-value clearing, email deliverability verification, and concurrent compare-and-swap
  updates are not implemented. Old saved fields are preserved rather than silently repaired.

The Agent receives the saved profile and requests a name field. Its old fresh-lead
instruction to ignore all history is removed. Conversation identity is always
`fitness-studio:whatsapp:<normalized-phone>`; it does not depend on record existence,
display name, date, or lead status. Empty/invalid conversation identities stop processing.
Returned rows with a missing or mismatched phone also stop before AI processing; a
lookup failure cannot be treated as a fresh customer. These rejection paths are unit-tested.
The original normalizer is retained; full telephone validation is not added here.

## Separate state domains

`Lead_Status` expresses engagement/qualification:

| Current | Allowed next values |
|---|---|
| New | New, Interested, Needs Info, Qualified, Not Interested |
| Interested | Interested, Needs Info, Qualified, Not Interested |
| Needs Info | Interested, Needs Info, Qualified, Not Interested |
| Qualified | Qualified, Not Interested |
| Not Interested | Interested, Needs Info, Qualified, Not Interested |

Qualified means a booking-ready/accepted intent in this prototype; it does not certify
completion of every qualification question. Questions and blocked new-booking intents
do not downgrade a qualified lead. Customer-initiated messages can re-engage a previously
uninterested customer. Consent/opt-out management is not implemented by this change.

`Booking_Status` remains independent and uses compatible existing sheet values:

| Internal state | Existing values | Allowed next internal states |
|---|---|---|
| none | empty, Not Started, Awaiting Date, Closed, without an event | none, pending |
| pending | Pending Confirmation | pending, confirmed |
| confirmed | Confirmed - Calendar Created, Rescheduled - Calendar Updated | confirmed, rescheduling, cancelled |
| rescheduling | Reschedule Pending | rescheduling, confirmed |
| cancelled | Cancelled | cancelled, pending |

An existing event in an otherwise inactive legacy booking record is treated as active
for action guards; its stored status is preserved, not silently rewritten as verified
confirmation. Unknown status strings block booking mutations and are preserved for review.
Legacy lead values Booking Confirmed, Booking Pending, and Reschedule Requested normalize
to Qualified; old manual-call labels and Cancelled normalize to Interested.

- Inquiries, declines, invalid mutations, and blocked rebooking retain status, slot, and event ID.
- Rescheduling/cancellation require an appropriate current state and existing event ID.
- New booking/rescheduling still require date and time presence; full date validation is later work.
- A reschedule request retains the stored original slot until the update branch completes.
- Cancellation clears booking slot/event fields without changing lead state to a booking label.
- Completion branches still trust continued API responses: **false confirmations on API
  failure remain known failures**. Transition checks use the initial customer snapshot;
  they are not transactional or a concurrency lock.

`Handoff_Status` is a separate column. Both manual-call nodes write `Requested` instead
of overwriting `Lead_Status`. Before any eventual live migration, a reviewed sheet copy
would need this additional column. This milestone does not configure a real sheet.
Profile writes preserve an existing handoff value and migrate legacy manual-call lead
labels to `Handoff_Status=Requested`, so normalization does not discard the staff request.
The new stable conversation-key namespace causes a one-time history reset for any old
in-memory sessions; saved profile data is supplied separately. No live memory migration runs.

## Nodes changed in the candidate

| Nodes | Change |
|---|---|
| Code - Prepare Context | Saved profile, stable identity, stop on failed lookup/invalid identity |
| Code - Safe Parse & Prep | Validated profile merge, normalized states, permitted intent transitions |
| Memory - Per Phone | Stable session expression |
| AI Agent | Saved profile context, name extraction, remove fresh-record history reset |
| Switch | Re-engage a customer-initiated inquiry previously marked Not Interested |
| Upsert Booking Pending / Interested / Needs Info / Not Interested / Reschedule | Merged profile and independent state mappings; preserve existing booking details on non-mutations |
| Mark Booking Confirmed / Mark Rescheduled / Mark Cancelled | Keep lead state independent; reschedule/cancel slot mappings |
| Flag Manual Call / Flag Follow Up Required | Write Handoff_Status instead of lead state |

Calendar and WHAPI operations, API retry/success behavior, deduplication, provider
authentication, waits, and scheduling eligibility are not redesigned.

## Isolated n8n comparison

```bash
# If the local runtime image needs initialization:
python3 tests/harness/run.py init --runtime /workspace/.booking-automation/runtime
# Otherwise rebuild only the harness/candidate layer:
python3 tests/harness/run.py build

python3 tests/harness/run.py run all --extended --workflow baseline
python3 tests/harness/run.py run all --workflow milestone2
python3 tests/harness/run.py run confirmed-inquiries --workflow milestone2
python3 -m unittest discover -s tests/harness -p 'test_*.py' -v

# Substitute the two generated summary paths; output must not already exist.
python3 scripts/compare-results.py BASELINE_RUN/summary.json UPDATED_RUN/summary.json \
  --output .harness-results/milestone2-comparison.md
```

The original 11 scenarios remain available in baseline mode. Extended mode uses
matching assertions for both variants and adds partial/invalid/null profile patches,
confirmed inquiries, decline with an active booking, illegal mutations, unknown state,
re-engagement, and cancelled rebooking. The follow-up race accepts the equivalent old
and new qualified labels and separately checks stale handoff. No assertion is removed
to hide an unrelated failure. `--allow-baseline-failures` still prints FAIL and tolerates
only explicitly known out-of-scope defects; targeted Milestone 2 regressions are not
silenced for the candidate.

Results retain source hashes, mock operation ledgers, and actual n8n execution data.
Default suite exit code remains 1 while known defects remain. A successful comparison
command means no assertion regressed, not that all assertions passed.

Docker inode use is reduced by omitting only source maps and TypeScript declaration
files from the **image**. Host dependencies and executable runtime files are untouched.
Tests execute compiled JavaScript; TypeScript compilation is not provided by this image.
All Milestone 1 isolation gates remain active. Run suites sequentially on Docker vfs.

## Verified results

See [the full comparison](milestone2-results.md). With identical extended assertions,
baseline scenarios passed 7/20 and candidate scenarios passed 17/20. Assertions improved
from 23/42 to 37/42, with 14 fixes and no regressions. Both suites completed 26 actual
n8n executions including the interleaved reply. Fifteen profile/state/identity unit
tests and five harness safety/reset tests pass. Both integration-suite commands return
1 because the remaining failures are still reported, not hidden.

Evidence in the current workspace:

- Baseline: `.harness-results/run-6f9a365f6bf9/summary.json`.
- Candidate: `.harness-results/run-6c96e31747f6/summary.json`.
- Source workflow hash: `2b5d405893fec176205a785e9cff4f16013ecfff619aa23e83c5747d84853375` (unchanged).

## Remaining work

Unverified API outcomes can still produce false success. Duplicate events still reach
AI and messaging. Old waiting executions still send stale follow-ups and request stale
handoffs, although they no longer corrupt lead/booking state. Snapshot writes can race
with other profile edits. Native memory durability, full AI/date schemas, conflict
prevention, webhook authenticity, and live integration behavior remain unverified or
unimplemented. Those are not Milestone 2 completion claims.
