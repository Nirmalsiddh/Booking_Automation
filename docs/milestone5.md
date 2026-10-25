# Milestone 5 — verified reservations and booking operations

The inactive `workflows/milestone5.json` builds on M4. Original and M2–M4 candidates,
fixture sources and historical reports remain unchanged. The approved authority model
is implemented in a separate storage interface, not in n8n's own database schema.

## Authority, policy and storage

SQLite owns automated booking identity, resource holds, lifecycle/version, operation
history and projection/notification dispatch ownership. Google Calendar is the external
appointment system. Sheets is a staff projection of verified booking information.

`config/reservations.json` is explicitly synthetic: one resource, capacity one. Policy
is supplied separately to the generic engine. `config/validation.json` supplies business
hours, timezone, weekdays, advance window and duration. Both M3 and the coordinator check
slot/duration validity. The engine has no fitness-specific resource or scheduling logic.
Capacity is represented explicitly but this version rejects capacity other than one;
group allocation and multi-business/tenant routing are not implemented.

Half-open UTC intervals `[start,end)` allow adjacent appointments. `BEGIN IMMEDIATE`, a
reservation overlap trigger, unique operation IDs and a unique active-operation index
serialize participating writers. Resource holds are committed before any external
mutation; no database transaction stays open while awaiting a network operation.
Rescheduling reserves the new interval while keeping the original one. Uncertainty
keeps both intervals; it does not expire automatically. All automated writers must share
this store. Calendar availability reads additionally reject observed external conflicts.
External/manual writers can race after that check and are outside the atomic guarantee.

## Additive database migrations

Booking migrations have their own `booking_migrations` table. M4's global SQLite
`user_version`, `messages` and `operations` are not replaced or reset.

- Version 1: resources, bookings, booking operations, reservation holds, versioned
  projection attempts and notification dispatch records.
- Version 2: minimal customer-profile cache, necessary to retain validated customer
  details when a booking bypasses the former pre-success Sheets write or Sheets is stale.

Unknown future versions fail before booking DDL runs. Migrations use transactions and
additive `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`; no table/data is dropped. Upgrade tests
preserve completed M4 message records and `user_version=1`. Booking/customer associations,
verified details and necessary profile fields are stored through the reference-workflow profile adapter; the
reservation engine treats profile data as opaque. Credentials, request headers and
raw provider responses are not stored in the authority ledger.

For a future reviewed installation: stop writers, make a SQLite online backup (or a
consistent database/WAL backup with all writers stopped), test that backup's restoration,
then initialize `BookingStore` against a disposable copy and inspect migration versions
and record counts before upgrading the real store. This task performs no production
upgrade. There is no destructive downgrade command. Restore a reviewed consistent backup
rather than manually removing migration records. Older candidates must not mutate an
M5-managed deployment, though their isolated databases and tests remain independent.

## Booking lifecycle and recovery

M4 continues to own message claims. M5's stable booking-operation identifiers are separate:
application-generated hashes of trusted provider/channel/message/action identity. IDs
and request fingerprints are immutable. Business outcomes do not inherit generic M4
node-completion status. Completed mutations never dispatch again; uncertain ones cannot
be automatically retried. Attempt/operation history remains durable.

Create: acquire a local hold, check external availability, dispatch once, then verify.
Only verified Calendar success confirms a booking and advances its version. Definite
failure releases the new hold. Unknown results retain it for reconciliation.

Each mutation is bound to the booking ID/version captured in authoritative context
before AI processing. A later reschedule or replacement invalidates older authorization;
the coordinator cannot silently apply an old cancellation consent to a newer appointment.
The same version is checked again inside the reservation transaction.

Reschedule: preserve the original event/slot until the update is verified. Definite
failure releases only the new hold. Unknown results preserve the last verified snapshot,
mark the booking uncertain, and block both intervals. Do not tell the customer the remote
appointment definitely stayed unchanged after a timeout.

Cancel: preserve state/occupancy until identity-bound deletion is verified. Failure keeps
the original booking; uncertainty keeps the reservation and blocks automatic mutation.

The operator reconciliation action performs reads only. Sufficient evidence can record
an already-applied operation without repeating it. Absence alone cannot establish that
a pending call will never apply; unproven cases remain uncertain. The restart scenario
kills an actual n8n worker after a committed mock Calendar effect, restarts the container,
and uses an operator-only n8n execution to reconcile the durable remote evidence.

Reconciliation updates booking facts and queues the latest projection; it does not
silently resend a notification or introduce a general recovery daemon. Controlled
projection retry is a separate action. M4 interrupted-message recovery still requires
a stopped/joined worker and never treats elapsed time as permission to repeat a call.

## Provider adapters and verification

`src/booking/http-provider.js` implements explicit request/read-back contracts. The
coordinator receives a provider interface (`available`, `mutate`, `observe`, `project`,
`notify`), enabling different transports without SQL in workflow business nodes.

Calendar creation uses a stable client event ID and booking/operation markers. Creation
and update require matching response identity and a matching read-back event; interval
and duration must equal the intended UTC values. Existing event identity/booking marker
is checked before update/delete, with If-Match when an ETag is available.

Delete requires a prior identity/ownership read, a successful identity-bound DELETE
acknowledgement and corroborating absence/cancelled-state read-back. A generic
`{success:true}` or standalone 404 is insufficient. Permission changes and other provider
ambiguities cannot be completely eliminated; unknown results stay blocked. Reconciliation
of hard deletion without adequate positive evidence deliberately remains conservative.

Calendar rejected requests are classified definitively failed only for supported typed,
correlated rejection responses. Timeouts, malformed bodies, mismatched identity, generic
continued errors and unrecognized responses are uncertain. Status codes alone do not
establish success. Actual API availability, credential scopes and provider behavior are
not claimed verified by offline testing.

For Sheets, use a reviewed unique physical row range per customer. The adapter writes
RAW values (customer, projection revision, booking ID/state, UTC start/end, resource,
event ID), then verifies range and read-back values. Projection revision is monotonic
per customer, independently of booking version. One row dispatch may be active at a time;
unknown writes block further writes, and stale queued revisions are rejected/coalesced
by reading the latest stored projection. No remote compare-and-swap guarantee is assumed.
Staff/external edits can bypass ordering and require reconciliation/governance.

WHAPI acceptance requires a nonempty receipt identity and matching intended recipient,
not just HTTP success. Missing/ambiguous receipt fields remain uncertain. Acceptance is
not delivery. Live WHAPI response-shape support is unverified; the adapter is deliberately
strict rather than inventing a delivery proof or provider idempotency scheme.

## Customer information and responses

Authoritative context is hydrated before M3's existing profile/state preparation. Failed
lookups or mismatched Sheet identities are rejected before cache hydration can mask them.
Unknown lead-state labels remain blocked for staff review; loading a verified booking
cannot silently normalize them into permission. Legacy manual-call labels are migrated
to the separate handoff field before normalizing recognized lead states.
Validated profiles are cached only after M3 authorization/schema checks; inquiries cannot
overwrite booking facts with stale Sheet labels. Unknown legacy event records are held
for review rather than silently promoted into verified local authority.

Verified success replies are constructed from the saved booking's date/time/timezone,
duration and reference. Stale booking versions cannot dispatch a later notification on
behalf of an older operation. Failure/uncertainty acknowledgements are deterministic and
never claim booking/cancellation success. AI-written replies are not used as confirmations.
All notices have durable identities; unknown sends do not automatically repeat.

Calendar success remains recorded even if Sheets fails. Projection failure and outbound
acceptance failure are independent statuses, and projection retries do not repeat Calendar
work. Confirmed booking details may be communicated while the staff projection is pending.

## Candidate nodes and files

New nodes: `Booking - Authoritative Context`, `Booking - Preserve Profile`, and
`Booking - Verified Operation`. Existing M4 guards and M3 authorization remain. Booking,
reschedule and cancellation categories enter the coordinator. Non-booking profile writes
omit booking-state/date/event fields. Previous booking branch nodes remain in the export
for traceability but are not reached by the booking category routes.

Implementation files:

- `src/booking/store.js`, `verify.js`, `coordinator.js`, `http-provider.js`, `profile.js`
- `src/n8n/Booking.node.js`
- `config/reservations.json`, `scripts/build-milestone5.js`, `workflows/milestone5.json`
- `tests/booking.test.js`, `tests/http-provider.test.js`
- `tests/harness/BookingProvider.js`, `scenarios-milestone5.js`,
  `container-milestone5.js`, `run-milestone5.py`

No previous candidate or fixture is regenerated. The earlier M5 foundation was extended
in place. The M5 builder remains deterministic and has a `--check` mode.

## Reproduce isolated verification

Use the locally provisioned Node 24 / n8n 2.44.6 runtime and Docker prerequisites from
the earlier harness guide. No new packages, registry pulls or real credentials are needed.

```bash
node scripts/build-milestone5.js --check
node --test tests/*.test.js
python3 -m unittest discover -s tests/harness -p 'test_*.py' -v
python3 tests/harness/run-milestone5.py build
docker image tag local/booking-harness:milestone5 local/booking-harness:milestone3
docker image tag local/booking-harness:milestone5 local/booking-harness:milestone4
python3 tests/harness/run-milestone5.py run all
# Individual scenario; each invocation also performs mandatory pending-operation restart proof:
python3 tests/harness/run-milestone5.py run reschedule-failure
# Earlier candidates, original fixture contracts:
python3 tests/harness/run.py run all --workflow milestone2
python3 tests/harness/run.py run all --workflow milestone3
python3 tests/harness/run-milestone4.py run all
```

The M5 image contains earlier sources for compatibility. Existing M3/M4 tags can be
pointed to the consolidated image after verifying their source labels; this is a local
storage optimization, not a candidate change. An archived prior M4 image is retained in
this workspace. Docker vfs consumes many inodes: run suites sequentially and do not use
broad pruning or delete unrelated images/volumes.

All existing isolation gates remain: local-only images, `--network=none`, read-only root,
non-root user, no capabilities/host binds/published ports, exact owned labeled volume,
loopback-only interfaces, no routes and failed external IPv4/IPv6 probes before n8n runs.
Each run exports fresh evidence and removes only its own verified test resources.

M5 integration tests execute actual n8n routing, expressions, item linking, M3 checks,
M4 claims and real SQLite coordinator operations. The mock provider uses durable tables
as independent remote evidence, with a separate effect commit before local settlement.
This permits real process interruption between effect and acknowledgement. Each scenario
gets an isolated booking database within the exact owned test volume; concurrent workers
in a scenario share that database/provider state.

The HTTP adapter uses injected fake HTTP responses in unit tests; the n8n suite uses the
provider interface's deterministic durable mock. Live Calendar/Sheets/WHAPI transport,
OAuth, native Gemini, memory durability and native Wait recovery remain unverified.
The exported candidate defaults to `adapter=unconfigured`, so the new booking adapter cannot silently contact APIs. Inherited native integration
nodes must also be mocked or separately configured before any future use. Explicit HTTP adapter mode and reviewed credential/mapping configuration would be
needed for a separately authorized live deployment; none is configured or activated here.

Tests also add a post-booking profile-preservation regression. Original M2/M3/M4 fixture
versions and saved reports remain intact. See `milestone5-results.md` for actual results,
including the known M6 follow-up/handoff failures in earlier suites.

## Pinned-runtime test harness mitigation

A baseline M4 rerun exposed a native SIGSEGV after a successful duplicate-only CLI
execution. `tests/harness/warm-runner.js` now inserts a test-only inert Code task into
M4/M5 generated test workflows and M5 operator copies. It waits for the internal JS
runner to initialize before early exits. `container-milestone4.js` and its build copy
list were updated for this barrier; original workflow JSON and fixture assertions stay
unchanged. The original container script is backed up in this workspace under
`/tmp/booking-m4-container-before-runner-warmup.js`. Failed diagnostic evidence is retained.
No unexpected subprocess exit is suppressed or reclassified as passing.

The M5 image records a digest of runtime source, configuration and test adapters in
addition to the workflow hash. Changed code requires rebuilding; the runner checks that
digest before startup and again after execution. The build also checks that generated
M5 JSON matches its builder/configuration. This prevents stale module images from
silently validating an earlier implementation.
