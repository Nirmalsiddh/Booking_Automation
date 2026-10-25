# Milestone 6 — durable outreach and handoffs

The inactive M6 candidate extends M5. Original and M2–M5 workflows and prior fixtures
remain unchanged. Tests use actual n8n with virtual time and synthetic mock providers;
no live service, credentials, workflow activation, deployment or commits are involved.

## Workflow and storage

`scripts/build-milestone6.js` generates `workflows/milestone6.json`. New nodes:

| Node | Responsibility |
|---|---|
| Outreach - Record Inbound | Verify M4 owner and normalized identity, record activity and exact consent command atomically |
| Outreach - Current Handoff | Hydrate authoritative handoff state before conversation preparation |
| Outreach - Validated Engagement | Update engagement only from M3-validated output for the current generation |
| Outreach - Schedule | Persist an eligible job after a direct Interested/Needs Info reply, then finish inbound processing |
| Outreach - Scheduler Tick | Separate minute-based worker trigger; candidate remains inactive |
| Outreach - Process Due Job | Claim one due job; recheck current eligibility; record outcome |

Legacy Wait, delayed WHAPI and Sheet-flag paths are disconnected. Their historical
nodes remain for comparison. The harness removes the schedule trigger and explicitly
executes the worker using a Manual Trigger; no schedule or live webhook is activated.
Existing direct replies and M3–M5 booking protections remain in place.

`src/outreach/store.js` reuses BookingStore's SQLite settings and BEGIN IMMEDIATE
transactions. Its additive `outreach_migrations` v1 leaves inbox user_version=1 and
booking migrations 1/2 intact. New tables:

- `outreach_contacts`: customer/channel identity, recipient, generation, last activity,
  engagement and current consent/version/source/times.
- `outreach_inbound`: stable M4-derived message fingerprint, generation and receive time.
- `outreach_consent_events`: immutable validated consent audit.
- `outreach_rules`: immutable versioned configuration payload.
- `outreach_sequences`: customer, activity generation, policy version, booking snapshot.
- `outreach_jobs`: stable sequence/kind/attempt ID, due UTC instant, status and owner.
- `outreach_notifications`: promotional dispatch intent and verified acceptance outcome.
- `outreach_handoffs` and `outreach_handoff_events`: independent state and versioned audit.

No database is recreated. Before a real upgrade, stop writers, take a consistent SQLite
backup including WAL state using SQLite's backup API, open the new store to apply the
additive transaction, and verify existing ledgers before resuming. Future schema versions
fail closed. Do not run older writers against M6 state; restore a consistent backup for
rollback. Test stores are only owned disposable volumes.

## Consent and categories

Promotional consent is **unknown**, **granted** or **revoked**. Unknown is the default.
Records include customer, source, event timestamp, last update/recorded time, actor,
evidence reference and version. Identical update-ID replay is harmless; conflicting
reuse, stale version, invalid source and future/out-of-order timestamps are rejected.

Only trusted logic writes consent:

- Exact authenticated `OPT IN FOLLOWUPS` grants consent.
- Exact `STOP`, `UNSUBSCRIBE` or `OPT OUT` revokes consent.
- Privileged application updates record verified choices with an expected version.
  This API has no webhook route or new staff platform. Deployment access control must
  restrict it. Fixtures use the explicit `synthetic_fixture` audit source.

Matching trims whitespace and uses uppercase. Inquiries and AI assertions never imply
consent. An inbound command and activity update commit atomically. Revocation/unknown
consent cancels pending and claimed promotional jobs. Regranting does not resurrect old
jobs; a fresh eligible interaction is required.

Direct customer replies keep the existing inbound path. Transactional booking notices
keep M5's verified-booking ledger and work without promotional consent. Only promotional
follow-ups use the new consent gate; their category cannot be relabeled transactional.
Provider rules and applicable legal requirements must be checked before live deployment.

## Eligibility, configuration and time

`config/followups.json` is versioned synthetic business policy: Asia/Dubai, 24-hour delay,
one attempt, 09:00 inclusive–18:00 exclusive sending window, all weekdays, and 48-hour
post-acceptance handoff delay. Delay, max attempts, weekdays, timezone, hours, engagement
and escalation delay are configurable. Explicit opt-in/opt-out suppression cannot be
disabled. Changed rules require a new version; old-version jobs are suppressed.

Before each dispatch, a transaction checks current identity/recipient, granted consent,
eligible engagement, unchanged inbound generation, active sequence, current rules,
unchanged authoritative booking identity/version/state, absence of an active booking,
and absence of an existing handoff. New replies, declines, bookings, opt-outs and newer
sequences invalidate outdated outreach. Booking states are read only by this subsystem.
A cancelled historical booking may allow a fresh eligible interaction; changing booking
state after scheduling suppresses the old job.

UTC due instants persist in SQLite. Intl computes sending windows using the explicit
IANA timezone, including DST. Closed hours defer to the next allowed minute. Pending-only
compare-and-set supports safe due-time changes without changing the logical job ID.
Accepted follow-ups progress up to max attempts, then schedule a handoff. Failed or
uncertain sends stop automatic progression; no blind marketing retries occur.

## Handoffs and recovery

No row represents **None**. Transitions: None → Requested; Requested → Assigned or
Resolved; Assigned → Resolved. Resolved cannot automatically reopen. Updates require
stable IDs, expected versions, reasons and actors. Requests retain customer, sequence,
booking reference, reason, request/update timestamps and version; later states add
assignment/resolution times. Duplicate requests cannot escalate twice.

A due handoff rechecks eligibility. New activity or revocation resolves an unassigned
Requested handoff as superseded. Assigned ownership and Resolved status survive later
interactions. SQLite is authoritative; no new Sheet handoff projection, staff messages,
dashboard or general notification platform is introduced. Context hydration overrides
stale Sheet handoff fields.

Unique job/activity keys prevent duplicates. Atomic claims exclude competing workers.
The final eligibility transaction durably authorizes dispatch before calling the provider.
That commit orders concurrent revocation: revocation committed first blocks the send;
an already authorized in-flight request cannot be recalled. Later revocation prevents
successor jobs. Tests cover these orderings; accepted messages cannot be unsent.

M5's notification verifier requires correlated operation, recipient, accepted flag and
nonempty receipt. **Accepted is not delivered.** Definite rejection is failed; timeout,
mismatched evidence and interrupted sends are uncertain. Neither repeats automatically.
Pending jobs survive restart. Requeue of claimed jobs requires the caller to establish
that the owner terminated and was joined. Dispatched jobs become uncertain on explicit
stopped-owner recovery and never requeue. Proof is an operator responsibility, not a
lease timeout or unauthenticated inbound field. Native tests kill and join a real worker.

M4 origin IDs link inbound activity to jobs. Asynchronous work uses its own operation
ledger because the inbound M4 claim finishes before the delay. M5 bookings and verifier
contracts are reused without altering reservations. No general M7 recovery daemon exists.

## Reproduce

Use existing Node 24, Python standard library, Docker and the provisioned local n8n 2.44.6
lean image. No new dependency installation, credentials or required environment variables.

```sh
node scripts/build-milestone6.js --check
node --test tests/*.test.js
python3 -m unittest discover -s tests/harness -p 'test_*.py' -v
python3 tests/harness/run-milestone6.py build
python3 tests/harness/run-milestone6.py run eligible-followup
python3 tests/harness/run-milestone6.py run all
```

Run builds and containers sequentially: Docker vfs has a limited inode budget. The runner
fails closed on insufficient free inodes, source/image mismatch or unverifiable isolation.
Builds never pull and use network=none. Runtime checks require no network, non-root,
read-only root, no capabilities/host binds/ports and an exact labeled owned volume.
In-container checks verify loopback only, no routes and failed IPv4/IPv6 connectivity
probes before execution. Safety/setup failures exit 2; assertion failures exit 1.
Each run exports readable results, node execution logs, ledger/provider evidence and
isolation records to a fresh `.harness-results/m6-*`. Only its own container and verified
volume are removed. Existing results are preserved. A real container restart occurs
even for a selected scenario.

The consolidated M6 image packages unchanged M2–M5 candidates and source hashes for
prior runners. Tag it to the appropriate local runner name and run suites sequentially:

```sh
for milestone in 3 4 5; do
  docker image tag local/booking-harness:milestone6 local/booking-harness:milestone$milestone
done
python3 tests/harness/run.py run all --workflow milestone2
python3 tests/harness/run.py run all --workflow milestone3
python3 tests/harness/run-milestone4.py run all
python3 tests/harness/run-milestone5.py run all
```

Prior suites retain known baseline failures. The pre-M6 consolidated image was archived
at `/tmp/booking-m5-complete-image.tar` before replacing local tags to accommodate vfs.
See `milestone6-results.md` for actual outcomes and diagnostics.

## Limits

Live providers, OAuth, WHAPI HTTP response shape, opt-in rules, legality and delivery are
unverified. Optional HTTP sending remains unconfigured and has no credentials. Tests
exercise actual n8n routing, expressions, item linking, SQLite and custom nodes, with an
explicit mock clock/provider; they do not activate the native schedule service. SQLite
is single-host; all participating writers must share its authority. One job per tick
limits throughput; operational catch-up and scheduling capacity need separate review.
An authorized in-flight request cannot be recalled. Unknown sends require investigation
and may sacrifice availability. No exactly-once external delivery is claimed. Staff access
control, ambiguous consent language and general monitoring/recovery remain future work.

### Preservation and decline details

Recognized legacy staff handoff fields seed the new SQLite state conservatively on
context hydration when no authoritative row exists. Assigned and Resolved remain so;
a legacy unassigned Requested item is recorded and resolved as superseded by the new
inbound. Import events explicitly identify their source; timestamps are import times,
not invented historical assignment dates. Unknown legacy labels stop processing for
review. Once SQLite has a handoff, stale Sheet fields never overwrite it. Existing
booking references remain attached across handoff updates.

A validated Not Interested result sets a separate durable decline-suppression flag.
It does not let AI rewrite authoritative consent. Ordinary later inquiries cannot clear
that flag; only a new trusted explicit opt-in can. Replaying an old opt-in cannot clear
a later decline/revocation. New consent events invalidate earlier pending sequences;
changing consent alone never resends an old promotion. Direct replies remain available.

The current sending-hours policy supports one same-day interval; overnight intervals
are rejected. Delays are elapsed UTC minutes, then adjusted into the next permitted
business window, rather than a promise of the same wall-clock time across DST changes.

Five existing immediate WHAPI nodes (Interested, Info, Closing, Fallback, Clarification)
also receive a consent-acknowledgement override in M6. Recognized commands use a trusted
acknowledgement produced only after the consent transaction commits; an opt-out does not
receive the ordinary sales-question template. Other messages retain their previous reply
expression, and transactional booking confirmations are untouched. No additional message
is sent and Gemini cannot fabricate the acknowledgement.
