# Milestone 4 — authenticated durable inbox

This milestone adds a separate, inactive `workflows/milestone4.json`. Original, M2 and
M3 exports, earlier fixture files and historical reports are preserved. The candidate
requires the custom nodes in `src/n8n`; importing JSON alone is insufficient. Nothing
is activated or deployed by the build/test commands below.

## Boundaries and installation layout

`src/webhook-boundary.js` owns authentication, HTTP/body validation and normalization.
`src/inbox/sqlite.js` owns all persistence; n8n business Code nodes contain no SQL.
`src/n8n/SecureWebhook.node.js` authenticates native webhook requests and emits sanitized
message items. `src/n8n/Inbox.node.js` implements claim, operation and completion nodes.

The isolated image places nodes in `/harness/custom`, the storage module in
`/harness/inbox/sqlite.js`, and the boundary in `/harness/webhook-boundary.js`.
`N8N_CUSTOM_EXTENSIONS=/harness/custom` registers them. For a future reviewed installation,
retain this relative layout; the custom nodes require their sibling modules. Node.js 24's
built-in `node:sqlite` is used, with no new npm package or database service.

The native trigger requires an n8n `httpHeaderAuth` credential named
`x-booking-webhook-key` with a secret of at least 32 characters. No credential is embedded
in the candidate. Missing or wrongly configured credentials fail closed. Channel identity
is a trusted node setting, not an incoming field. No production setup is performed here.

## Authentication assumptions

This is an application-defined shared-secret header boundary, **not a WHAPI signature
scheme**. The repository does not establish that the configured provider can supply this
header. Actual provider capabilities, TLS termination, upstream access controls and log
redaction must be verified before any live use. An outbound WHAPI API key is not used as
proof of webhook authenticity. Native n8n/custom-trigger hosting behavior is not equivalent
to a verified live provider integration.

The shared boundary uses constant-time comparison of fixed-length secret digests. It
checks configuration/authentication before parsing JSON or dispatching workflow work.
It accepts JSON (optional UTF-8 charset), limits raw body size to 64 KiB, batches to
20 messages and text to 2,000 characters. The standalone HTTP handler bounds streamed
reads; native n8n also needs an appropriate instance/proxy request-size limit because
n8n may buffer the request before invoking a custom webhook. Headers and secrets are
never emitted into workflow items, responses, operation ledgers or application logs.
The harness strips authentication overrides from saved synthetic execution state.

Responses: 401 missing/invalid key; 503 unconfigured/unavailable boundary; 415 wrong
content type; 413 oversized body; 400 malformed envelope/JSON; 422 invalid message-only
batch; 409 conflicting identifier reuse; 200 ignored receipt/echo; 202 accepted items.
A mixed batch accepts valid messages and reports rejected/ignored counts separately.
Acceptance is not a booking-success claim.

## Normalization and identity

Only individual inbound text messages are supported. Validate nonempty bounded provider
IDs, explicit `from_me=false`, phone syntax (7–15 digits, nonzero prefix, optional plus or
personal WhatsApp suffix), text and display-name types/limits. Reject malformed/unsupported
messages; ignore delivery receipts and explicit bot echoes. This validates syntax, not
ownership or telephone reachability. Sender authentication depends on the ingress contract.

Each item retains `(provider, authenticated channel, message ID)` and a SHA-256 digest
of normalized sender/type/text. Display names are mutable metadata, excluded from the
digest. Channel claims in the payload cannot select another inbox namespace. Reusing an
ID with changed immutable content is a conflict. Identical IDs with identical content
are deduplicated, including across restarts. Identical text with different IDs remains a
different request; this is not semantic deduplication or a calendar conflict lock.

The `Loop - Messages` node processes batched items one at a time through existing M3
logic, retaining n8n item linking. Each message is independently claimed. Dormant test
source connections are disconnected so they cannot bypass the ingress/claim path.

## SQLite schema and guarantees

Storage is a separate `/inbox/inbox.sqlite`; n8n's internal database schema is untouched.
Migration 1 is explicit DDL in the storage constructor, versioned with `PRAGMA user_version`
and applied under `BEGIN IMMEDIATE`. Unknown future versions fail closed. Tables:

- `messages`: composite primary key `(provider, channel, message_id)`, immutable digest,
  processing status, owner token, attempt count, timestamps and sanitized reason code.
- `operations`: primary key `(provider, channel, message_id, operation_key)`, owning token,
  started/completed/uncertain status and timestamps; foreign key to the message.

WAL, `synchronous=FULL`, foreign keys, transactional writes, and a 1.5-second busy timeout
provide single-host coordination among processes sharing the file. Lock exhaustion fails
closed; it never falls back to memory. Storage hardware/filesystem guarantees still matter.
Do not place the SQLite file on an unreviewed network filesystem. No PostgreSQL is added.

The storage interface is `receive`, `claim`, `begin`, `completeOperation`, `finish`,
`failBeforeEffects`, `recoverStoppedOwner`, `snapshot`, `close`. A future database adapter
can implement these contracts without putting SQL into workflow business logic.

The ledger stores identifiers/digests/status only, not raw text, phone numbers, profile
contents, API results or authentication material. Normalized request content is not a
durable job payload: accepted-but-not-dispatched records require provider redelivery or
an operator-supplied original message. This is a durable deduplication ledger, not a
background queue that autonomously drains pending requests.

## Duplicate and recovery behavior

Claims atomically transition received/retryable to processing and issue a new owner token.
Only one concurrent execution can own a message. Completed, processing, uncertain or
rejected messages cannot be claimed. Retry attempts are capped at three. A duplicate
returns to the batch loop without AI, Sheet, Calendar or outgoing-message operations.

Every external main node, including the AI Agent and Sheet lookup, has a durable begin
record written before dispatch and a completion record afterward. Repeated operation
keys are blocked. Model/memory subnodes remain within the guarded Agent operation.
Authorization and state/profile logic from M3 remain unchanged.

There is deliberately **no automatic lease expiry/reclaim**. Timestamps are evidence,
not permission to execute again. Pre-effect failure is retryable only when no operation
has begun. Once any operation started (even a read), interrupted recovery is conservative:
mark uncertain and block automatic replay. A continued error item from an external node
also marks the message/operation uncertain and stops that message's downstream actions.
An unhandled failure leaves the claim processing until operator recovery.

`recoverStoppedOwner` is an operator-only interface, never exposed through HTTP. Its
caller must terminate and join the worker before declaring it stopped; the harness
proves this by waiting for the killed n8n subprocess to exit. This is a trusted operator
contract, not a public boolean permission. Old owner tokens are fenced out of future
begin/finish calls. No automated uncertain-record clearing or broad reset command exists.

A local transaction cannot commit a remote Calendar/WHAPI effect and its local receipt
atomically. If a process dies in that gap, the operation stays uncertain and is **not
repeated automatically**. Thus duplicate safety sacrifices automatic recovery/liveness
in ambiguous cases. There is no exactly-once remote-effect guarantee, provider-idempotency
implementation, provider reconciliation or automatic recovery after partial completion.

The error-item stop incidentally prevents the existing injected Calendar-error scenario
from falsely confirming its Sheet record. This does not validate arbitrary provider
success schemas or fix the broader API-result-verification milestone. Stale follow-ups
and stale handoff eligibility are still outside scope.

## Isolated testing

Use the prerequisites in [the M1 harness guide](../tests/harness/README.md). All required
runtime dependencies already exist in this workspace; no package downloads or registry
pulls are used by these commands.

```bash
node scripts/build-milestone4.js
node scripts/build-milestone4.js --check
node --test tests/*.test.js
python3 -m unittest discover -s tests/harness -p 'test_*.py' -v
python3 tests/harness/run-milestone4.py build
python3 tests/harness/run-milestone4.py run new-booking
python3 tests/harness/run-milestone4.py run all
```

The M4 build includes prior workflow copies and runners without editing their sources.
Earlier commands remain `python3 tests/harness/run.py run all --workflow milestone3`
and `--workflow milestone2`. Their original fixture files and saved reports remain intact.

The M4 runner verifies image/source hashes and, before starting, network=none, read-only
root, non-root user, dropped capabilities, no-new-privileges, no host binds/ports and the
exact entrypoint. The sole added mount must be a fresh locally managed volume with the
exact random owner label and `/inbox` destination. Driver options, other mounts or wrong
ownership fail closed. Inside the container, loopback-only interfaces, no routes and
failed IPv4/IPv6 external probes are required before importing/executing n8n.

HTTP requests use synthetic keys and localhost **inside** that network-disabled container.
The actual boundary validates and persists receipts; only sanitized accepted items enter
actual n8n CLI execution. Provider calls remain deterministic local mocks. Inbox nodes
and their SQLite storage are real, not mocks. The native webhook trigger is not activated;
the same boundary is exercised through a real loopback HTTP handler instead.

Concurrent tests issue simultaneous HTTP requests and run separate n8n processes against
the same inbox. Each has separate disposable mock/engine state to avoid using a racy JSON
file as shared mock infrastructure. Different-ID concurrency tests use different customer
phones: this does not prove concurrent profile correctness for one customer or slot.

Fault-control nodes exist only in the generated testing copy. Tests SIGKILL actual n8n
workers before operations and after a recorded mock Calendar effect, then join/recover
and redeliver. The restart test completes an actual booking, restarts the Docker container
with its owned volume, rebuilds ephemeral engine state and redelivers the same event.
The inbox must suppress all repeated effects. Unit tests also exercise multi-process
claims, busy timeouts, stale ownership and malformed/authentication boundaries.

Reports, operation ledgers and execution logs are exported into fresh `.harness-results/m4-*`
directories. Each run removes only its own container and verified labeled volume after
export. Historical reports are never reset. Exit 0 means all assertions pass, 1 means
behavioral failures remain, and 2 means setup/safety/execution failure. Known failures
remain printed as FAIL. See `milestone4-results.md` for observed outcomes.

## Fixture contract changes and remaining limits

M4 derives its regression suite from M3 without editing earlier fixtures. Distinct
conversation turns now receive distinct IDs; the explicit duplicate scenario retains
one ID. Earlier fixtures reused IDs for unrelated turns, which correctly conflicts with
durable message identity. Invalid inbound content is rejected at HTTP ingress, before
any n8n/mock operation. These deliberate input/expectation changes are documented, not
counted as identical-input regressions.

There is no verified WHAPI signature/timestamp contract or cryptographic replay window.
ID tombstones are retained without automatic expiry; replay of those IDs is blocked,
but an attacker with valid ingress credentials could invent fresh IDs. No rate limiting,
account-level authorization, live provider integration, native memory durability, native
Wait restart testing or multi-host storage guarantees are claimed. M3's business-time
fixtures still use 2030 dates and eventually need refreshing against the system clock.

The batch loop serializes a complete branch, including native follow-up waits. In a
future live execution, an early inquiry can delay later batch items until those waits
resume. The offline harness virtualizes waits; it does not resolve this scheduling
limitation or validate native durable Wait recovery. The existing conversation-memory
namespace remains the single fitness-studio namespace from M2.

## Files and node changes

Created:

- `src/inbox/sqlite.js`, `src/webhook-boundary.js`
- `src/n8n/Inbox.node.js`, `src/n8n/SecureWebhook.node.js`
- `scripts/build-milestone4.js`, `workflows/milestone4.json`
- `tests/inbox.test.js`
- `tests/harness/run-milestone4.py`, `container-milestone4.js`, `scenarios-milestone4.js`
- `tests/harness/HarnessIngress.node.js`, `M4Mock.node.js`, `test_milestone4_guards.py`
- `docs/milestone4.md`, `docs/milestone4-results.md`

Updated only documentation from earlier work: `docs/milestone4-design.md` records the
approval, and `tests/harness/README.md` links this extension. No earlier workflow,
fixture, production configuration or original runner implementation was overwritten.

The candidate has 103 nodes: the M3 nodes plus a batch loop, claim/finish nodes and
52 explicit begin/complete nodes around 26 external main nodes. The webhook node uses
the authenticated adapter; the normalizer retains message/channel/provider identifiers.
Connections from dormant Meta/Instagram test sources are removed to prevent bypasses.
Existing M3 AI validation, profile/state rules and memory-key expressions are unchanged.
The generated testing copy adds a Manual Trigger, sanitized ingress and test-only fault
control, and replaces live integrations/waits with mocks as in earlier milestones.
