# Milestone 4 architecture decision — approved record

Status: approved by the user in the subsequent architecture decision. This document
records the pre-implementation proposal; see `milestone4.md` for the implementation
and its guarantees. Previous workflows remain preserved.

## Verified starting point

Branch `work`, HEAD `2fd834a5849bde686d9b8b236631e18c0679528d`.
Existing milestone files are untracked working-tree content and have been preserved.
Saved M3 results: 29/32 scenarios, 59/63 assertions, from
`.harness-results/run-fc9dd29dcca9/summary.json`. Saved M2 results: 17/20, 37/42,
from `.harness-results/run-b835eeb030d1/summary.json`. These artifacts were inspected;
no new workflow executions were performed during this investigation.

Unchanged SHA-256 hashes:

- Original: `2b5d405893fec176205a785e9cff4f16013ecfff619aa23e83c5747d84853375`
- M2: `b5260080548ed0d5a9ab81b30f3102dfce59b060bcbd69ec5696ce074ccdb7c2`
- M3: `5fcae7b87424057323aca0c297a79eee94cb85c31304a1ac3cb128644b7878a6`

## Persistence options

| Option | Guarantees and limits | Decision |
|---|---|---|
| Workflow static data / execution history | Useful state/history, but not a supported atomic message-claim API; persistence alone does not serialize concurrent business actions | Do not use for deduplication |
| n8n Data Tables | Persistent rows; installed 2.44.6 service uses a transaction around update-then-insert. Inspected public operation does not establish uniqueness on provider/channel/message fields or an atomic claim-owner contract | Not sufficient evidence for required concurrent guarantees |
| Separate SQLite inbox | Unique composite key and transactions can serialize claims among processes sharing one database on a single host. Requires explicit storage lifecycle, busy handling, ownership and recovery rules | Recommended for this isolated demonstration |
| PostgreSQL inbox | Unique constraints, transactions and row locks support coordinated multi-worker/multi-host claims; requires another managed service, migrations and operational configuration | Possible later alternative; not introduced automatically |

Do not alter n8n's internal SQLite schema. A custom persistence adapter would own a
separate database and be accessed by explicit workflow boundary nodes. The isolated
harness would exercise the real adapter, not an in-memory substitute. A dedicated,
labeled Docker-managed test volume would support container-restart tests. Isolation
checks would permit only that exact disposable volume; no host directory mounts,
ports or external networks. Reset must never remove arbitrary volumes or user data.

## Authentication evidence and proposed boundary

The current workflow's webhook has no authentication parameter or credential binding.
Installed n8n supports header/basic/JWT webhook authentication; this does not establish
what WHAPI can supply. No provider webhook settings, signed payload examples, or
provider signature specification were found in repository evidence. No live WHAPI
endpoint or account was contacted. WHAPI signature support remains unestablished.

Propose a configurable shared-secret header check at an ingress boundary, disabled/fail
closed when unconfigured, with synthetic credentials for tests. Treat this as our
boundary contract, not a WHAPI signature implementation or a production-security claim.
Before eventual live use, verify the actual provider can supply that credential or use
a separately authenticated gateway; outbound WHAPI API tokens are not proof of inbound
authenticity. No invented provider HMAC scheme, trusted timestamp or replay window.

Ingress validates authentication before JSON parsing/business processing, checks JSON
content type and a configurable raw-body byte limit, strips credentials before handing
data to n8n, and never records authentication headers or rejected raw bodies. Use only
loopback inside a network-disabled container for HTTP tests. Inactive candidate and
manual-entry isolated workflow execution remain separate from any live webhook.

## Message identity and batch processing

Bind provider/channel namespace to authenticated ingress configuration, not arbitrary
payload claims. Require bounded provider message IDs and valid individual sender IDs.
Normalize each valid message into its own item with provider, channel, message ID,
phone, source type and text. Process each through the M3 branch independently; verify
item linking for batched messages rather than assuming the existing merge works.

Malformed envelope: reject before business processing. For a valid batch, report invalid
items separately while accepting independently valid items. Receipts and bot echoes
are harmless ignored outcomes. Unsupported types are rejected outcomes. Batch limits
and repeated IDs within a batch are enforced before dispatch.

## Durable inbox and controlled recovery

Proposed unique key: `(provider, authenticated_channel, provider_message_id)`.
Store a digest of canonical immutable message data so reuse of the same ID with changed
content is rejected. Keep receipt timestamps, status, attempts, owner/claim token and
sanitized error code. Avoid storing unnecessary customer text in the ledger.

Atomic insertion/claim happens before AI execution. Competing requests cannot both
own a claim. States: received, processing, completed, retryable, uncertain, rejected.
Record per-operation intent/completion for AI, Sheets, Calendar and outbound messages,
using stable operation keys and claim-owner checks. Do not rerun completed operations.

- Duplicate completed or actively owned message: acknowledge without business work.
- Confirmed pre-effect recoverable failure: bounded, controlled retry with a new owner.
- Interrupted execution before any effect could occur: safely reclaim after ownership
  expiry, provided a stale worker cannot resume the action.
- Interrupted call or crash between effect and completion recording: mark uncertain;
  do not automatically replay. Require reconciliation/manual resolution.
- Expired ownership alone never proves a remote operation did not happen.

A local transaction cannot atomically commit a Calendar/WHAPI operation and its inbox
receipt. SQLite or PostgreSQL alone cannot promise exactly-once remote effects. Until
provider idempotency/reconciliation exists, preventing repeats requires sacrificing
automatic recovery for uncertain outcomes. Do not relabel ambiguous failures as safe
retries. API-result redesign and broader recovery orchestration remain later milestones.

Retain deduplication tombstones without automatic expiry for the demonstration. Replayed
IDs are blocked across restarts; this is not cryptographic replay protection. Fresh IDs
with identical text may be legitimate distinct requests and are not silently collapsed.

## Implementation after approval

1. Add the boundary/authentication contract and separate SQLite adapter with schema,
   atomic claims, operation ledger and explicit retry/uncertain outcomes.
2. Generate inactive `workflows/milestone4.json` from preserved M3; add ingress validation,
   item normalization, claim gate and completion/failure recording while retaining M3
   action authorization. Integrate guarded operation dispatch so duplicate retries cannot
   resend notifications. No live credentials, database service or workflow activation.
3. Extend isolation gates narrowly for the owned test volume and run actual simultaneous
   n8n executions against the same SQLite store. Test process/container restart and
   injected failures before versus after possible side effects.
4. Run all 15 requested security/deduplication cases plus preserved M2/M3 protections.
   Use unique IDs for distinct turns in legacy fixtures; some earlier synthetic fixtures
   reused one ID across unrelated messages. Preserve original fixtures and document the
   changed M4 contracts instead of hiding intentional duplicate rejection as regressions.
5. Report request outcomes, operation counts, ownership/concurrency evidence, before/after
   comparisons and untouched later-milestone failures. No live services or publication.

## Approved scope

Approve the separate single-host SQLite inbox, local authentication/ingress adapter,
dedicated disposable Docker volume and conservative uncertain-outcome handling described
above. The user subsequently approved this scope; implementation proceeded under that
approval. See `milestone4.md` and `milestone4-results.md` for the delivered result.
