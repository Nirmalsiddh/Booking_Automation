# Milestone 5 — reservation authority decision

Status: subsequently approved by the user and implemented for the isolated M5 baseline.
This is the original architecture proposal; see `milestone5.md` and
`milestone5-results.md` for the delivered implementation and verified limitations.

## Verified baseline and existing contracts

Branch `work`, HEAD `2fd834a5849bde686d9b8b236631e18c0679528d`. Existing untracked
milestone work was preserved. The M4 candidate regenerates cleanly with `--check`.
Stored M4 evidence (`.harness-results/m4-7f6805fab746/summary.json`) matches its source
hash: 55/56 scenarios and 104/106 assertions pass. The only failures are stale follow-up
and handoff suppression. These reports were inspected, not newly rerun for this design.

Unchanged workflow SHA-256 hashes:

- Original: `2b5d405893fec176205a785e9cff4f16013ecfff619aa23e83c5747d84853375`
- M2: `b5260080548ed0d5a9ab81b30f3102dfce59b060bcbd69ec5696ce074ccdb7c2`
- M3: `5fcae7b87424057323aca0c297a79eee94cb85c31304a1ac3cb128644b7878a6`
- M4: `d3bf3ef31c81bf507973e61f2d2d44c7aed277590e51431b8826ff190cbd6d06`

M4's SQLite schema version 1 has `messages` and `operations`, atomic message claims,
operation begin/completion guards, bounded lock waits and conservative interrupted-owner
recovery. Operation keys are scoped to an incoming message. The generic completion guard
checks an error field; it is not a provider-specific success verifier. M4 does not have
reservations, authoritative booking versions, independent booking-operation identities,
or a projection retry mechanism. M4 rejects a database with global `user_version > 1`.

Installed n8n 2.44.6 exposes a Calendar create ID option. Its delete node returns a
synthesized `{success: true}` after the API call, without returning event identity.
Existing mocks return simplified Calendar/Sheets/WHAPI objects. Neither those objects nor
a generic success boolean are adequate evidence for the full M5 outcome contract.

## Decision and alternatives

| Choice | Consequence |
|---|---|
| **SQLite booking/reservation authority (recommended)** | Same-host transactions serialize conflicting reservations and mutations. Calendar realization is verified separately; Sheets becomes a projection. Requires new domain tables and an explicit single-writer protocol. |
| Calendar as the sole authority | Useful for visibility and external availability, but querying then creating does not atomically reserve capacity. Cannot meet the concurrent-conflict acceptance criterion alone. |
| PostgreSQL authority | Appropriate for a future multi-host service; adds an operational dependency without removing remote API uncertainty. Not proposed for this milestone. |

Approve SQLite as authority for **automated allocation and verified booking state**.
Calendar remains the external appointment system, not a transactional lock service.
There is no atomic transaction spanning SQLite and Google/WHAPI.

## Synthetic resource and availability policy

Proposed demonstration policy, explicitly fictional and not inferred business policy:

- Resource `synthetic-assessment-room`, capacity **one**.
- All baseline assessment requests target that configured resource; Gemini cannot select
  a different resource or alter capacity.
- Keep existing Asia/Dubai, 06:00–23:00, 60-minute assessment rules and their validation.
  Do not introduce group capacity, overnight hours, multi-business routing or trainer rosters.
- Occupancy uses half-open UTC intervals `[start,end)`: adjacent appointments are allowed;
  any positive overlap on the same resource conflicts.
- Pending mutation holds, confirmed appointments and uncertain mutations block capacity.
- One in-flight mutation per booking, with an expected booking version checked atomically.
  Preserve the baseline policy against creating a second active booking for a customer.

A `BEGIN IMMEDIATE` transaction checks local overlaps and inserts/updates a hold before
external mutation. Every automated writer must use this interface. No database lock is
held across an external API call. Availability reads from Calendar detect observed outside
appointments but do not provide a global lock. A failed/unverifiable availability check
blocks dispatch. Read-only preflight failure can release a newly acquired hold when the
ledger proves no Calendar mutation began.

Manual Calendar edits, native Calendar invitations and other integrations can bypass the
store between check and mutation. The design guarantees capacity only among participating
automated writers. Live use would require exclusive-write governance or explicit external
reconciliation. No claim of atomic conflict protection against arbitrary external writers.

## Persistence design and operation lifecycle

Reuse the same owned SQLite file where practical, without modifying n8n's database or
changing M4's global `user_version=1`. Introduce separately versioned booking migrations
(e.g. `booking_schema_migrations`) and additive domain tables:

- `bookings`: trusted booking ID, customer/resource association, last verified appointment,
  provider event identity, lifecycle state and monotonic booking version.
- `reservation_holds`: resource interval, owning booking/operation and blocking state.
- `booking_operations`: unique stable operation ID, action, expected booking version,
  intended interval, request fingerprint, phase, verified outcome and provider evidence.
- Message-to-operation references: correlate M4 inbox records without making booking
  history depend on message completion status.
- `sheet_projections`: per-customer monotonic projection revision, desired snapshot,
  dispatch ownership, sync outcome and retry/reconciliation state.
- `booking_notifications`: stable notification ID, booking/revision, trusted message
  snapshot, dispatch outcome and provider acceptance ID.

Store only data needed for booking execution/recovery. Keep credentials and raw request
headers out of all tables/logs. Prior candidates and their disposable databases stay
unchanged; older candidates must not write against an M5-managed deployment/store.

Operation identity is generated by trusted application logic and reused for redelivery or
controlled retry. A different message may refer to an existing operation without creating
another mutation. Reusing an operation ID with a changed fingerprint is rejected. Identity
must not be based solely on time-slot text, which could represent distinct legitimate intent.

Proposed phases: prepared -> dispatched -> succeeded / definitively_failed / uncertain.
Reconciliation is read-only until an outcome is established. Completed operations never
repeat mutations; uncertain operations never automatically repeat. A lease expiry or a
single absence observation does not prove an in-flight request cannot complete later.
Only proven pre-effect/definitive failures may be considered for a controlled retry.

M4 remains the message-level guard. M5's independent operation record determines business
outcomes. A handled definitive failure can finish message handling without being recorded
as a successful booking. Do not overload the generic M4 `completed` flag as Calendar success.

### Create

Reserve locally, check external availability, then dispatch once with stable request/event
identity where supported. Verify the returned event and expected interval. Only verified
success makes the booking confirmed. Definitive failure releases the new hold. An uncertain
outcome keeps the hold and blocks confirmation/replay until reconciliation.

### Reschedule

Retain the original verified booking and original occupancy while acquiring a hold on the
new interval (excluding that same booking's original interval from its own conflict check).
Verified update success atomically moves the booking and releases the old occupancy.
Definitive failure releases the new hold and retains the original appointment. Uncertainty
keeps both intervals blocked and marks the change uncertain: the old record is a last
verified snapshot, not a claim that the remote appointment definitely remains there.

### Cancel

Keep the existing booking/occupancy until deletion is verified. Definite failure preserves
it. Uncertainty blocks further mutation and does not release the slot or send cancellation
confirmation. Successful deletion releases occupancy and advances booking version.

## External verification rules

Adapters must bind responses to trusted dispatch context; model output or an untrusted
response field cannot declare its own operation identity. Default ambiguous results to
uncertain. HTTP status alone is insufficient.

| Operation | Required success evidence |
|---|---|
| Calendar create | Expected event ID (client-supplied where supported), bound calendar/resource, matching UTC interval/duration and non-cancelled event state; read-back when needed |
| Calendar update | Existing expected event ID, requested resulting interval and correct operation/booking association; reject mismatched identities or stale results |
| Calendar delete | Identity-bound delete acknowledgement plus corroborating absence/cancelled-state verification under a reviewed provider contract; bare `{success:true}` is insufficient |
| Sheets synchronization | Intended projection key/revision and values verified through response and/or read-back, not just a successful request |
| WHAPI acceptance | Provider acceptance receipt and nonempty provider message ID tied to the intended recipient/request; never interpreted as proof of delivery |

A mismatch, timeout, malformed response, ambiguous continued error or lost connection is
uncertain unless positive evidence establishes no effect. Explicit, correlated provider
rejection may establish definitive failure. Provider-specific rules must be documented;
where actual capabilities are unestablished, mock normalized contracts are labeled as
synthetic and live behavior remains unverified. Do not invent WHAPI endpoints or guarantees.

Deletion/read-back deserves particular care: a 404 might mean absence, visibility failure
or an ambiguous lookup depending on provider semantics. Unqualified 404 responses are not
a universal deletion proof. Reconciliation cannot assume a request has stopped merely
because a worker died. Conservative unresolved cases stay blocked.

## Projection and notification ordering

Booking facts in SQLite survive Sheets failure. Customer profile collection remains
protected by M2/M3; booking authorization reads authoritative booking state, not a stale
Sheet booking label. Existing synthetic booked fixtures will explicitly initialize matching
local verified records. Do not silently promote arbitrary legacy Sheet rows into authority;
real migration/reconciliation is outside this isolated milestone.

Use a monotonically increasing **per-customer projection revision**, separate from a
booking's version, so a cancelled/replaced booking cannot reset synchronization ordering.
Permit one projection dispatch in flight per row. Before dispatch, reject/coalesce stale
queued revisions and use the current authoritative snapshot. Confirmed failed projections
can retry independently without repeating Calendar work.

Sheets does not provide a presumed application-level compare-and-swap guarantee. An
uncertain write blocks further automatic writes to that row until reconciled; otherwise
an old request might complete after a newer one and overwrite it. Local locks do not
prevent staff/external writers from editing rows. Document this boundary rather than
claiming unconditional remote ordering.

Generate customer confirmations only from verified operation/booking records, including
appointment date, time, timezone, duration and booking reference. Calendar success may be
confirmed even if staff synchronization is separately pending/failed; do not roll back the
verified booking merely because Sheets failed. Definite failure and uncertainty receive
honest deterministic responses, not model-written success claims.

Stable notification identities prevent repeated accepted notifications. Acceptance and
delivery remain separate. Unknown send outcomes do not automatically resend; controlled
retry is limited to verified non-acceptance. Notification/projection status is independent
of message handling and Calendar outcome.

## Implementation and verification after approval

1. Add separately versioned booking storage, resource configuration and transactional
   conflict/version guards, with unit/concurrency tests.
2. Add operation-specific verification/reconciliation adapters and richer deterministic
   mock responses, preserving earlier mocks and their contracts.
3. Generate inactive `workflows/milestone5.json` from M4. Add authoritative booking-context,
   reserve/authorize, verified-outcome, projection and notification phases. Retain M3
   authorization and M4 ingress/deduplication. Replace pre-success booking-state Sheet
   writes with verified projection handling.
4. Add all 18 requested M5 scenarios, including overlapping intervals, conflict-aware
   reschedule, uncertain deletion/create, incorrect event identity, stale projections,
   concurrent reservations and restart mid-operation. Assert prohibited actions are absent.
5. Run the real adapters and n8n workflow inside the existing network-disabled harness
   against the exact owned disposable volume. Preserve old fixtures/reports, document
   test-only local booking seeding, and rerun preserved M4 coverage. Report M6 stale
   follow-up/handoff failures explicitly. No live integrations or publication.

## Approval requested

Approve the single-capacity synthetic resource policy and SQLite authority model above,
including conservative holds for uncertain operations, independent projection/notification
records, and the stated external-writer limitations. This changes both reservation authority
and persistent booking semantics beyond the M4 inbox approval. Sections 4 and 11 of the
M5 request require stopping for this significant architectural decision.
