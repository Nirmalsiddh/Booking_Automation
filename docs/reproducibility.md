# Reproducing the isolated M1–M6 demonstration

The supported path is the Docker/n8n harness. It tests actual n8n routing, expressions,
custom nodes and SQLite against synthetic providers. It does not validate real provider
contracts, credentials, native Gemini/memory behavior or production deployment.

## Prerequisites

- Linux and a working local Docker daemon, on the same architecture as the local Node binary.
- Node.js 24 (the saved acceptance environment used 24.19.0), Python 3.10+ and `ldd`.
- A trusted local installation of n8n **2.44.6**, including
  `node_modules/sqlite3/build/Release/node_sqlite3.node` and its required shared libraries.
- Several GB of disk capacity and sufficient free inodes. Docker vfs copies many runtime
  files; run one build/test container at a time. Do not solve resource problems with
  global Docker pruning or by deleting user data.

Host domain tests need only Node built-ins, including `node:sqlite`. Python orchestration
and safety tests use the standard library. There is no root `package.json` or root
`npm install` step. Do not commit `node_modules`, n8n data or Docker image archives.

## Acquire dependencies separately

Skip this step when a suitable trusted installation already exists. This example is a
manual, network-using provisioning step, not a test command and not something the harness
runs automatically. It does not contact Google, Gemini, WHAPI or customer services.

```bash
runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/booking-n8n-runtime.XXXXXX")
npm install --prefix "$runtime_dir" --save-exact --no-audit --no-fund n8n@2.44.6
```

Use the same shell for the next step, or replace `$runtime_dir` with the actual installation
path. The cloud checkpoint used `/workspace/.booking-automation/runtime`; that path is an
example from one environment, not a dependency supplied by this Git repository. Do not
use any persistent n8n instance/data directory alongside it.

Pinning n8n alone does not pin transitive npm resolution. Preserve the resulting dependency
lockfile outside this checkout, Node version, native module compatibility and image identity
if exact runtime retention matters. No reviewed cross-platform dependency lock or signed
runtime image is provided by this repository. Fresh dependency acquisition has not been
retested as part of the documentation hardening; do not claim byte-identical fresh builds.

## Bootstrap and build

From the repository root, with the trusted runtime path set above:

```bash
node --version
python3 --version
docker version
python3 tests/harness/run.py init --runtime "$runtime_dir" --node "$(command -v node)"
python3 tests/harness/run-milestone6.py build
```

`init` validates the local Node/n8n versions, SQLite module and shared libraries. It builds
`local/booking-harness-runtime:2.44.6-lean` from provisioned files, then the baseline test
layer. It does not pull a registry image or install dependencies during the build.
The lean image omits source maps/declaration files, preserving executable JavaScript.
M6's builder uses this local base with networking disabled and packages the candidates,
custom nodes, domain modules and mock adapters. Missing dependencies fail the build.

No Docker image or installation command above is a production deployment artifact.

## Custom-node installation and inactive workflow import

The M6 builder handles installation into the isolated image. It copies:

```text
/harness/custom/
  Inbox.node.js                 src/n8n
  SecureWebhook.node.js         src/n8n
  Booking.node.js               src/n8n
  Outreach.node.js              src/n8n
  Mock.node.js                  test-only adapters
  M4Mock.node.js
  HarnessIngress.node.js
  OutreachControl.node.js
/harness/inbox/                 src/inbox
/harness/booking/               src/booking
/harness/outreach/              src/outreach
/harness/action-authorization.js
/harness/state-profile.js
/harness/webhook-boundary.js
/harness/BookingProvider.js      test-only provider
/harness/OutreachProvider.js     test-only provider
```

The execution child environment sets `N8N_CUSTOM_EXTENSIONS=/harness/custom`. Relative
imports such as `../booking/store` require this supporting layout. Copying only the four
production-facing `.node.js` files, or importing JSON alone, is insufficient. The builder
source in `tests/harness/run-milestone6.py` is the definitive packaging manifest.

The runner reads `workflows/milestone6.json`, checks its digest against the image, replaces
external integrations with approved mock nodes, strips credential bindings, removes the
inactive schedule trigger from the test copy and introduces a Manual Trigger. The test
child runs n8n CLI `import:workflow` against `/data/test-workflow.json`, followed by
`execute --id=offlineBaseline --rawOutput`. Operator scenarios use a separate generated
inactive operator workflow. n8n data lives in disposable container storage, not a host
instance. No manual UI import or workflow activation is needed.

There is no standalone custom-node npm package or verified live installation guide.
A future live installation would require separate packaging, credential, access-control,
provider-contract and operational review. This guide intentionally supplies no activation
or live messaging instructions.

## Execute and inspect

```bash
node --test tests/*.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/harness -p 'test_*.py' -v
node scripts/build-milestone6.js --check
python3 tests/harness/run-milestone6.py run eligible-followup
python3 tests/harness/run-milestone6.py run all
```

Each M6 run includes mandatory pending-job/container-restart verification. Single-scenario
execution is therefore more than one n8n process. Due times use an explicit virtual clock,
so no 24–72 hour sleep is required. The final candidate is always inactive.

Inspect each new `.harness-results/m6-*` directory: summary JSON, generated workflow,
transformation manifest, per-case execution logs, SQLite state snapshots, mock provider
operations, source/image digests and isolation evidence. A successful run proves the
asserted mock-backed behavior, not live availability, provider compatibility or delivery.

Exit codes are 0 for passing M6 assertions, 1 for behavioral failures and 2 for setup,
isolation or unexpected execution failure. Insufficient inodes, stale images and missing
local dependencies are failures; the runner does not bypass those gates. Do not delete
existing artifacts to hide a failed attempt. Rebuild stale local images only after review.

Prior suite commands and their intentional historical failures are documented in
`tests/harness/README.md` and the milestone reports. Keep raw output local. Curated
Markdown summaries in `docs/` are source-controlled; their old UUID evidence paths refer
to saved local runs and are not bundled with a fresh clone. Run the harness to create new
local evidence, without expecting identical IDs or wall-clock metadata.

## Configuration and services

No user environment variables, secrets, provider accounts or customer records are required
for the isolated tests. The runner constructs its own test-only n8n settings. Business
configuration is in `config/validation.json`, `config/reservations.json` and
`config/followups.json`: the reference timezone is Asia/Dubai, with one synthetic resource
and promotional opt-in required. These settings are demonstration policy, not live client
configuration. Rule changes and workflow regeneration belong to later approved work.

Outside the test harness, the preserved design names Gemini, WHAPI, Google Sheets and
Google Calendar. Their real credentials/payloads remain unverified. New adapter defaults
are unconfigured, and inherited native provider nodes must never be treated as a safe
credential-free live fallback. Keep all workflows inactive and use the isolated runner.
