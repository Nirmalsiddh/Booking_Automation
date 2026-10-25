# Offline n8n baseline harness — Milestone 1

For the separate inactive AI-validation candidate, see [Milestone 3](../../docs/milestone3.md).
Use `python3 tests/harness/run.py list --workflow milestone3` to list its 32 scenarios.
The current build creates a distinct M3 image and retains existing M1/M2 images.

For the inactive Milestone 2 candidate and matching extended comparisons, see
[Milestone 2](../../docs/milestone2.md). Baseline mode and the original eleven
scenario fixtures are preserved. New runtime images omit source maps and TypeScript
declarations to reduce inode use; the host dependency installation is unchanged.

This harness runs a **generated testing copy** of the fitness-studio workflow through
actual n8n 2.44.6. It does not activate, import into, or execute your production n8n
instance. The original root `workflow.json` is read, hashed, and left unchanged.
No PostgreSQL, new booking rules, or production fixes are included.

## Architecture and fidelity

```text
Python runner → verify stopped Docker container configuration → start with network=none
  → verify interfaces/routes and failed IPv4/IPv6 probes inside container
  → generate inactive test workflow → import into disposable n8n SQLite
  → execute via n8n CLI → collect operation ledger, node execution data, assertions
```

The original Code, Set, Switch, IF, Merge, and NoOp nodes and main connections are
retained. External nodes become a test-only custom n8n node (`CUSTOM.mock`). The
adapter uses n8n's own parameter-expression evaluation on original parameter objects.
An added Manual Trigger feeds a synthetic WHAPI payload through the original normalizer.
The model and memory subnode connections are removed; scripted AI output replaces
the Agent. The original memory-key expression is evaluated and recorded, but **native
Agent/model/memory behavior is not tested**. The transformation manifest enumerates
every original and resulting node type.

Wait nodes become virtual-clock adapters. They advance recorded time without sleeping.
The reply-during-follow-up scenario runs a second, actual n8n CLI execution on the
same disposable store during the first virtual wait, using a different runner broker
port. It then resumes the original execution. This tests stale business-state handling,
not n8n's native durable Wait/resume implementation.

All mocks are local filesystem operations; none uses an HTTP client or provider SDK.
The ledger records evaluated parameters, results, errors, sequence, turn, and virtual
time. Original `Last_Updated` expressions and n8n execution metadata use real time;
these timestamps and generated n8n IDs are not byte-for-byte deterministic. Mock AI
responses, mock IDs, operation ordering, assertions, and virtual elapsed time are deterministic.

## Prerequisites and installation

- Linux, Python 3.10+, Node.js 24, `ldd`, and a working local Docker daemon.
- A locally provisioned **n8n 2.44.6** npm installation, including its SQLite native module.
- Several GB of disk space. Docker's `vfs` storage driver can make builds and container
  creation/removal slow because it copies runtime files.
- No Google, WHAPI, Gemini, n8n account, or API credentials.

The current cloud workspace already has the dependency tree at
`/workspace/.booking-automation/runtime`. Do not use its persistent n8n data directory.

On another machine, provision dependencies separately if needed:

```bash
# This optional provisioning command downloads npm packages; it is NOT a test command.
# Run it only where dependency downloads are authorized.
npm install --prefix /tmp/booking-harness-runtime --save-exact --no-audit --no-fund n8n@2.44.6
```

From the repository root:

```bash
python3 tests/harness/run.py init --runtime /workspace/.booking-automation/runtime
# Or use --runtime /tmp/booking-harness-runtime on your own machine.
```

`init` uses the local Node binary, required system libraries, and the supplied npm
dependency tree to import a Docker root filesystem. It then adds only harness files
and the workflow export. It does not pull a base image, run a package manager, or use
Dockerfile RUN instructions. `--node /absolute/path/to/node` selects another local
Node 24 binary. The host dependency installation must be trusted; this is not a
production container image or a complete dependency supply-chain audit. Transitive
npm resolution is not pinned by this repository; retain the provisioned dependency
tree/image for exact runtime reproduction.

After editing harness JavaScript or the baseline, rebuild only the small test layer:

```bash
python3 tests/harness/run.py build
```

## Execution

```bash
python3 tests/harness/run.py list
python3 tests/harness/run.py run new-booking
python3 tests/harness/run.py run all
python3 tests/harness/run.py run all --allow-baseline-failures
python3 -m unittest discover -s tests/harness -p 'test_*.py' -v
```

Exit codes:

- **0:** all assertions passed, or only explicitly documented baseline failures occurred
  and `--allow-baseline-failures` was selected.
- **1:** behavioral assertions failed. Known defects are still printed as **FAIL**;
  they are never asserted to be correct behavior or silently marked passing.
- **2:** setup, safety, missing execution output, unexpected execution failure, or
  harness failure. The baseline-failure flag never suppresses these errors.

A run writes a fresh UUID directory under `.harness-results/`, with readable
`summary.md`, machine-readable `summary.json`, and per-scenario artifacts:

- `docker-safety.json`, `isolation.json`: isolation evidence.
- `test-workflow.json`, `transform-manifest.json`: generated copy and source hash.
- `state.json`: synthetic Sheets rows, Calendar events, outgoing messages, operation ledger.
- `execution-*.json`: actual n8n execution results and executed-node data.
- `turn-*.log`, `import.log`, `container.log`: underlying command output.
- `result.json`: positive correctness assertions and their outcomes.
- Interleaved execution artifacts for the reply-during-delay scenario.

For `run all`, one isolated container hosts the suite; mock stores reset before each
scenario and each turn starts a fresh n8n CLI process. The disposable n8n database
retains execution history only. Scenario artifacts are under
`all/scenarios/<scenario-id>/`. Single-scenario runs use
`<scenario-id>/scenarios/<scenario-id>/`. Container safety evidence is also retained
at the outer container-artifact directory. UUID directories prevent result overwrites.

The runner checks the source hash against the image baseline and checks it again after
execution. A stale image is an error: rebuild it rather than interpreting stale results.
The container stays alive briefly so tmpfs artifacts can be copied before removal.
On ordinary completion or failure the runner removes only its own container. If the
runner is forcibly killed, inspect Docker for its orphaned test container; do not use
global container, volume, or image pruning commands.

Reset only generated test artifacts:

```bash
python3 tests/harness/run.py reset
```

Reset refuses a symlink or an existing directory without the exact harness marker.
It never resets an n8n instance, production store, Docker volume, image, or repository file.

## Network and credential safety

Before starting n8n, the runner verifies `network=none`, no host mounts, no published
ports, non-root execution, a read-only root filesystem, dropped capabilities, and
`no-new-privileges`. Writable `/data` and `/tmp` are disposable tmpfs mounts. Runtime
containers use `--pull=never`; a missing local image is a failure, not a registry pull.
No host environment variables or credential directories are forwarded.

Inside the container, execution is refused unless only loopback exists and the IPv4
route table is empty. Connections to reserved IPv4/IPv6 documentation addresses must
fail immediately with network-unreachable errors. A timeout is inconclusive and fails
the safety gate. These probes do not target real application services.

No environment variables are required from the user. Test-only n8n settings are
constructed in `container.js`: `/data` storage, custom mock extension directory,
disabled diagnostics/templates/version checks, and `Asia/Dubai` timezone. Existing
production variables and configuration are not modified. The reply interleaving uses
broker port 5681 inside the network-isolated container; no host port is exposed.

## Mock contracts and configurable failures

Edit synthetic fixtures in `scenarios.js`, then run `build`:

| Adapter | Success behavior | Failure configuration |
|---|---|---|
| WHAPI inbound | Supplies a synthetic webhook body to the original normalizer | `faults.inbound` or exact node name |
| Gemini/Agent | Returns the fixture's raw `ai` string | `faults.ai`, malformed strings, or raw JSON edge cases |
| Sheets | Phone-keyed lookup/upsert, persistent across turns within a scenario | `faults.sheet` or exact node name |
| Calendar | Deterministic create/update/delete and event IDs | `faults.calendar` or exact node name |
| WHAPI outbound | Validates/records recipient and body; returns a synthetic message ID | `faults.outbound` or exact node name |

For example, `faults: {calendar: 'unavailable'}` throws a synthetic failure. The
adapter honors original `continueOnFail`, returning an error item where enabled.
Each failure is recorded. Sheets converts null/undefined mapped cells to empty strings,
matching the inspected installed Sheets append/upsert behavior; it does not silently
fix destructive profile updates. Unsupported adapter operations fail explicitly.

These mocks approximate documented operation shapes; they do not verify OAuth, provider
response schemas, HTTP error classification, message delivery, or calendar timezone behavior.

## Scenarios and known baseline defects

Assertions describe desired behavior, not desired reproduction of bugs.

| Scenario | Main coverage |
|---|---|
| new-inquiry | Normalizer, new-lead lookup, AI parsing, Interested branch and virtual follow-ups |
| existing-inquiry | Existing row lookup, Needs Info branch, profile preservation |
| multi-turn-qualification | Two executions sharing mock storage; profile and session-key continuity |
| new-booking | Booking router, create branch, calendar merge, confirmation and event ID |
| reschedule | Existing-event update, sheet status, outgoing confirmation |
| cancellation | Event deletion, cancellation status and response |
| decline | Closed lead and single closing response |
| invalid-ai | Invalid JSON fallback with no booking |
| calendar-failure | Continued calendar error and false-success prevention |
| duplicate-webhook | Repeated identical provider message ID across executions |
| reply-during-follow-up | Real second inbound execution during virtual delay; stale follow-up/escalation |

Known defects expected to surface include profile erasure, session-key discontinuity,
false calendar confirmations, lack of deduplication, and stale follow-ups. See the
generated report and `BASELINE.md` for observed results. Do not reinterpret a known
failure as passing functionality.

## Deliberately unsupported / unverified

- Real provider integrations, credentials, signatures, webhook HTTP transport, or delivery.
- Native Gemini/Agent behavior, conversation-memory persistence, and prompt quality.
- Native Wait durability/restart semantics and multi-worker concurrency guarantees.
- Full Sheets API behavior, provider errors, and calendar free/busy conflict enforcement.
- Every possible branch: the 11 representative scenarios do not cover all statuses,
  malformed payloads, or calendar update variants.

This milestone establishes evidence. It intentionally does not repair the workflow's
business logic, add PostgreSQL, redesign state, or implement a multi-business platform.

## Milestone 4

The approved durable-inbox extension uses a separate runner and an explicitly owned
disposable Docker volume. See [M4 setup, guarantees and limitations](../../docs/milestone4.md)
and [observed results](../../docs/milestone4-results.md). Earlier fixtures and commands
remain available unchanged.

## Milestone 5

The inactive reservation-authority candidate, verified Calendar/projection/notification
contracts, migrations, and isolated test commands are documented in
[Milestone 5](../../docs/milestone5.md). See [observed results](../../docs/milestone5-results.md)
for all 18 approved scenarios, additional compatibility checks, and unchanged earlier
regression outcomes. Generated M4/M5 test copies now initialize the pinned JS runner
before early exits; original workflow exports and fixture assertions are preserved.

## Milestone 6

The inactive M6 candidate replaces delayed outreach with SQLite jobs and explicit
promotional consent. See [Milestone 6](../../docs/milestone6.md) for architecture,
operator/recovery constraints, versioned rules, isolated execution and reproduction.
Use `python3 tests/harness/run-milestone6.py build` and then `run all`, sequentially.
No credentials are needed. Native n8n scenarios use virtual time and mock providers;
they do not verify live delivery or activate a schedule.
