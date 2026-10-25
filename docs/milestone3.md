# Milestone 3 — AI validation and action authorization

`workflows/milestone3.json` is a separate, inactive 48-node candidate. The original
46-node workflow and Milestone 2 candidate are unchanged. Do not activate this candidate
or connect it to live services as part of testing. No database or live credentials are added.

## Trust boundary

Gemini proposes an interpretation. `Code - Safe Parse & Prep` independently validates
the entire proposal, checks the original normalized inbound message, checks the existing
customer's state using the unchanged Milestone 2 rules, and constructs action parameters.
`IF - Authorized Proposal` permits only validated outputs into the existing category
router. Rejected proposals go to `WHAPI - Send Clarification` and terminate: no profile
writes, booking mutations, or delayed follow-ups. Rejection reasons are available in
execution data; raw model replies are never sent to customers.

This deliberately introduces a conservative confirmation protocol. Natural-language
booking requests still reach the interpreter, but cannot themselves authorize changes.
Customers must send the following exact commands (case-sensitive, outer whitespace allowed):

- `BOOK YYYY-MM-DD HH:MM`
- `RESCHEDULE YYYY-MM-DD HH:MM`
- `CONFIRM CANCEL YYYY-MM-DD HH:MM`

For booking/rescheduling, the model's category, date and time must match the command.
For cancellation, the confirmation must name the **currently saved appointment's** date
and time. A conversational cancellation request receives that confirmation instruction;
only the matching command permits deletion, and only when Milestone 2's event/state
checks also allow it. Bare “yes”, stale slot confirmations and model claims of consent
are rejected. No pending-confirmation state is stored: this is explicit direct consent,
not a nonce-based challenge or replay protection. Commands should eventually become
provider-verified interactive confirmations; that is outside this milestone.

The original webhook is not authenticated by this work. Authorization here means a
validated command from the inbound sender identity, not cryptographic sender verification.

## Schema and validation

The JSON object has required `category`, `reply`, and `collected_data`; optional
`booking_date` and `booking_time` may be omitted or null for non-slot actions. No other
properties are accepted. Markdown fences and non-object responses are rejected.

| Field | Contract |
|---|---|
| category | Interested, Needs Info, Not Interested, Booking Pending, Reschedule, Cancel Booking |
| reply | Nonblank string, maximum 1,000 characters; control characters rejected; never sent |
| booking_date | Null or strict YYYY-MM-DD; calendar actions also require a real date |
| booking_time | Null or HH:MM in 24-hour format |
| collected_data | Object; only optional full_name, email, goal, experience, injuries |
| profile values | String or null; bounded lengths, control-character checks, basic email syntax, experience enum |

The model cannot supply event IDs, customer identity, recipients, authorization flags,
calendar instants, or state fields. These are derived independently. Null/blank/string-null
profile values continue to mean no update. An invalid field rejects the **whole proposal**,
whereas Milestone 2 accepted valid parts of a partly invalid profile. Existing profile
values therefore survive both cases. Schema validation does not prove the factual truth
of model-extracted customer details, nor does it verify email ownership.

Inbound validation runs before lookup/AI: malformed senders, batches, missing explicit
`from_me=false`, wrong text types, oversized text, control characters and invalid display
name types are skipped through the existing skip route. Receipt/echo filtering remains.
Unsupported non-text messages use the original harmless text fallback.

## Business configuration

Edit `config/validation.json`, then regenerate the candidate and rebuild the test image.
Configuration is embedded at build time; customers and Gemini cannot override it.
Invalid configuration fails the build and fails closed at execution.

Defaults retain the fitness studio baseline: Asia/Dubai, 06:00–23:00 daily, one-hour
appointments, zero minimum notice, and a five-year maximum advance window. The long
window keeps existing synthetic 2030 fixtures usable. Set a reviewed practical horizon
before any future live use. `requiredBookingFields` defaults to an empty list to preserve
the prototype's booking behavior; it can require any supported profile field, validated
against the merged saved/new profile. Missing required fields block creation/rescheduling.

Supported settings: timezone (IANA), opening/closing time, durationMinutes,
minimumNoticeMinutes, maximumAdvanceDays, allowedWeekdays (Sunday=0), maxMessageLength,
maxAIBytes and requiredBookingFields. Overnight opening hours are unsupported.

The date validator rejects impossible dates, past/too-soon/too-distant slots, disallowed
weekdays, and slots that extend past closing. It resolves local times using the configured
IANA timezone and rejects DST gaps, ambiguous repeated times, and appointments crossing
a timezone transition. Modern quarter-hour offsets are supported; historical timezone
rules with second-based offsets are not. Calendar nodes receive explicit UTC start/end
instants. No calendar availability or overlapping-booking check is added.

## Safe responses and unchanged failures

Customer responses use fixed application templates. Model-written success claims,
instructions and links never reach outbound messages. Booking/cancellation/rescheduling
responses say the request was submitted and explicitly do not confirm calendar success.
Follow-ups no longer invent available slots. This does **not** verify API outcomes:
continued Calendar errors can still write a falsely confirmed Sheet status. The legacy
node name “Send Booking Confirmation” remains, but its message no longer claims success.
Deduplication, webhook authentication, retries, durable queues and stale follow-up
suppression remain later work. Existing follow-up scheduling is preserved.

## Changed nodes and files

- `Normalizer - WHAPI Payload`: pre-validation before existing normalization.
- `Code - Safe Parse & Prep`: schema, deterministic authorization, state guards, templates.
- New `IF - Authorized Proposal` and `WHAPI - Send Clarification`: fail-closed routing.
- `AI Agent`: interpreter-only prompt, existing profile and business timezone context.
- Three Calendar create/update nodes: use validated UTC interval fields.
- Two WHAPI follow-up nodes: remove unverified availability claims.
- Other replies use the existing `reply` expression, now supplied deterministically.
- Memory, Sheet mappings and Milestone 2 state/profile rules are preserved.

Implementation: `src/action-authorization.js`, `config/validation.json`,
`scripts/build-milestone3.js`, `workflows/milestone3.json`.
Tests: `tests/authorization.test.js`, `tests/harness/scenarios-milestone3.js`.
Harness extensions: `tests/harness/run.py`, `container.js`, `Dockerfile`.

## Reproduce

Use the local prerequisites and no-network Docker setup in
[the harness guide](../tests/harness/README.md). No new dependencies are needed.

```bash
node scripts/build-milestone2.js --check
node scripts/build-milestone3.js --check
node --test tests/*.test.js
python3 -m unittest discover -s tests/harness -p 'test_*.py' -v
python3 tests/harness/run.py build
python3 tests/harness/run.py run all --workflow milestone3
python3 tests/harness/run.py run cancel-without-confirmation --workflow milestone3
# Earlier suites remain available with their original fixtures and expectations:
python3 tests/harness/run.py run all --workflow milestone2
python3 tests/harness/run.py run all --extended --workflow baseline
```

`node scripts/build-milestone3.js` regenerates after source/config edits.
The build creates a distinct Milestone 3 image, preserving existing M1/M2 images.
All runtime safety gates remain: network none verified before start, internal route and
IPv4/IPv6 checks before n8n import, no credentials/mounts/ports, read-only root, non-root
execution, and disposable tmpfs storage. Actual n8n executes routing, expressions and
Code nodes; provider, Agent/model, memory and wait adapters remain mocked/virtualized.

The M3 suite carries forward 20 M2 scenarios with authorized synthetic commands, plus
12 boundary scenarios. Earlier fixtures and assertions are untouched. Changed M3
expectations are explicit: reschedule compares the correct UTC instant, malformed AI
terminates on the clarification branch, and Calendar failure checks message content
rather than the legacy node's name. The false Sheet status assertion remains failing.
This is a changed-contract regression suite, not a claim of identical-input comparison.

Results and operation ledgers are written to fresh `.harness-results/run-*` directories.
Default exit code 1 means behavioral failures remain visible; 2 means harness/safety
failure. Do not treat known failures as successes. See `milestone3-results.md` for actual
outcomes. Native model generation, memory persistence, durable waits, live integrations,
and concurrent execution correctness are not verified by these tests.
