# Milestone 7 review corrections

These changes address the three findings from the final checkpoint review. They do not introduce a migration, change a workflow candidate, activate integrations, or expand recovery beyond the isolated mock environment. The expected Git parent remains `dc1666c6c7fc73168470cc6b73d823aee7029401`; no checkpoint is created by this work.

## Artifact privacy boundary

Previously, the host could export first-phase evidence before the container's final privacy scan, and could export evidence even after that scan failed. The new `tests/harness/private-export.js` collector validates the entire approved selection inside the container before serializing any artifact bytes. It checks current authority and persisted worker secrets, existing synthetic privacy canaries, file names/types, JSON syntax, symlinks and the aggregate size bound. Missing secret inventories or any validation error fail closed with one constant diagnostic; raw exceptions are not serialized.

The host exporter requires the validated envelope and independently checks paths, sizes and known privacy markers across the entire decoded response before writing files. Failed validation produces only `export-failure.json` with `EXPORT_PRIVACY_FAILURE`; safe failure diagnostics remain available when validation succeeds. The same exporter handles failure, restart and final-success paths. The container also scans before its restart return, retaining its final privacy scan. Raw Docker logs are no longer fetched by this runner.

Negative tests invoke the actual collector with synthetic customer canaries, authority tokens and worker secrets, and exercise the actual host runner's success, failure, interruption and both restart export paths through mocked Docker control calls. The stopped-container path exports no runtime artifacts. Existing evidence directories are not removed or retroactively declared sanitized by this change.

## Recovery ownership

Previously, reconciliation could interrupt an earlier request and delete its canonical claim before discovering that the new request was stale or ineligible. Takeover is now gated on the current plan being eligible and its snapshot matching, within the same `BEGIN IMMEDIATE` transaction. The prior owner's joined status must also have a matching trusted target/request binding. Current worker identity remains verified before claim handling. Rejected requests can add their own blocked audit entry but leave prior claims, request history and business records unchanged. A later failure in takeover or binding rolls back the whole transaction.

Unit coverage exercises stale snapshots, ineligible operations, missing ownership bindings, active owners and conflicting request IDs. Native n8n coverage includes stale/ineligible requests against an actual interrupted recovery claim, existing overlapping workers, duplicate requests, authorization rejection and valid reconciled takeover.

## Shared retry accounting

Previously, a follow-up continuation that created the first notification was counted as both an original send and a recovery dispatch. The planner now identifies that origin from the existing append-only continuation dispatch journal. Both job and notification aliases use the same canonical history without adding a second initial attempt. No schema change or new retry allowance is introduced. The three-attempt limit, persisted one-/five-second backoff, idempotent requests and uncertainty restrictions remain in force.

Tests cover ordinary and recovery-originated first sends, failed sends and eligible retries, the shared budget, accepted/uncertain outcomes, duplicate requests, interrupted sends and fresh database connections. Native scenarios compare mock transport calls with planner counts, verify the third send is permitted and the fourth blocked, and reconcile interrupted sends without resending. Durable dispatch intent remains conservative after interruption; uncertain sends cannot be retried just because no response was recorded. Read-only reconciliation also consumes the existing bounded provider-transport budget.

## Verification

The initial baseline was rerun before changes: **119 unit tests and 18 safety tests passed**. After corrections, **126/126 unit tests and 21/21 safety tests passed**, with no skips. Both workflow-builder consistency checks passed.

The complete corrected native M7 run passed **84/84 scenarios and 594/594 assertions**. It recorded **225 n8n executions: 215 successful, six intentional errors, and four controlled interruptions**. Every prior M7 scenario and assertion outcome matches the saved 78-scenario/552-assertion baseline; six new scenarios add 42 passing assertions.

Accepted evidence: `.harness-results/m7s2-4c45f8bf8974/` (ignored by Git). Workflow SHA-256: `504c995fb989ffb03c5b991da11b0d4f56185ba70f9b92fffa64be50da62299c`. Source/harness digest: `70a860586d5006952fb969ff494a26e0f2709beb58cb6f1df3655e299e5e806a`.

| Added native scenario | Outcome |
| --- | --- |
| `recovery-claim-preserved-stale` | 7/7 assertions passed |
| `recovery-claim-preserved-ineligible` | 7/7 assertions passed |
| `recovery-first-send-budget` | 7/7 assertions passed |
| `recovery-first-send-accepted` | 7/7 assertions passed |
| `recovery-first-send-uncertain` | 7/7 assertions passed |
| `recovery-first-send-interrupted` | 7/7 assertions passed |

Both pre-restart and final export boundaries executed in the native run. Accepted evidence passed the current authority/worker-secret checks and a separate host-side canary scan. Completed success/error execution-data retention stayed at **zero rows**; the maximum private interrupted in-flight count was **four**. These interrupted rows were confined to disposable runtime storage and were not exported.

An earlier native attempt completed 33 passing scenarios before an incorrectly configured new timeout fixture stopped the run. That fixture now uses the recovery adapter's supported `timeoutAfterEffect` mode. Earlier Docker startup failures exhausted VFS inodes before workflow execution. These attempts are preserved separately and are not acceptance evidence. Historical Stage 2 results remain in `milestone7-stage2-results.md`.

### M2–M6 regression comparison

All five preserved-candidate suites were actually rerun after the corrected complete M7 run. Every scenario and ordered assertion outcome matches its saved Stage 2 baseline. Historical failures remain visible.

| Suite | Passing scenarios | Passing assertions | Saved outcomes preserved | Current evidence |
| --- | --- | --- | --- | --- |
| M2 | 17/20 | 37/42 | Exact match | `run-992338cd2774` |
| M3 | 29/32 | 59/63 | Exact match | `run-ea5c44373f08` |
| M4 | 55/56 | 104/106 | Exact match | `m4-84ea427b1636` |
| M5 | 24/24 | 33/33 | Exact match | `m5-142192008cf3` |
| M6 | 35/35 | 35/35 | Exact match | `m6-784e637b9ca9` |

M2–M4 retain their previously documented Calendar, deduplication and/or stale-follow-up defects. No new regression outcome was introduced. M5 and M6 are fully passing. The source/hash-matched M7 result above is a fresh native run, not saved evidence counted as a rerun.

### Reproduction

Use the installation and Docker-isolation requirements in `milestone7-stage2.md`. Dependencies must already be installed locally; the build does not download images or packages.

```bash
node --test tests/*.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/harness -p 'test*guards.py'
node scripts/build-milestone7.js --check
node scripts/build-milestone7-stage2.js --check
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run-milestone7-stage2.py build
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run-milestone7-stage2.py run all
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run.py run all --workflow milestone2 --allow-baseline-failures
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run.py run all --workflow milestone3 --allow-baseline-failures
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run-milestone4.py run all
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run-milestone5.py run all
PYTHONDONTWRITEBYTECODE=1 python3 tests/harness/run-milestone6.py run all
git diff --check
```

M4's expected exit status is 1 for its historical failed assertions. M2/M3 retain every historical failed assertion despite their baseline-aware runner flag. Run suites sequentially on inode-constrained Docker VFS hosts; do not broadly prune user resources. A single new M7 scenario can replace `all` in the M7 run command.

## Scope and limitations

This is an isolated mock implementation. Production provider contracts, operator RBAC, host trust, runtime retention and the original video's acknowledged privacy concerns remain unresolved. Validation protects the defined diagnostic export boundary; it is not a general data-loss prevention system for arbitrary hostile code or a production log sanitizer. Interrupted runtime data remains private to disposable test storage and is not exported.


## Files changed by these corrections

Existing M7 files updated:

- `src/recovery/engine.js`
- `src/recovery/plan.js`
- `tests/harness/RecoveryHarness.node.js`
- `tests/harness/container-milestone7-stage2.js`
- `tests/harness/run-milestone7-stage2.py`
- `tests/harness/scenarios-milestone7-stage2.js`
- `tests/harness/test_milestone7_stage2_guards.py`
- `tests/recovery.test.js`
- `docs/milestone7-stage2-results.md`

New files:

- `tests/harness/private-export.js`
- `docs/milestone7-corrections.md`

No workflow JSON or business node was modified by the corrections. The test-only RecoveryHarness node now records planner attempt counts for assertions. The combined M7 checkpoint inventory grows from 49 to **51 files** (11 tracked modifications and 40 untracked source/documentation files). Generated evidence, databases, caches and image/runtime archives remain outside the proposed checkpoint.

## Checkpoint recommendation

The three targeted findings are corrected and the requested suites were rerun. Subject to review and explicit approval of the updated 51-file allow-list, the implementation is ready for a local checkpoint on `feature/milestone7-stage1`, parent `dc1666c6c7fc73168470cc6b73d823aee7029401`, with message `feat: add operational monitoring and guarded recovery`. No files were staged, committed or pushed. No live provider was used, no workflow activated, and no deployment or Milestone 8 work performed.

The cloud host's Docker VFS quota required preserving and releasing obsolete generated harness image/cache copies and cleaning verified unreferenced copies left by failed container startup. Repository evidence and prior source were preserved. The original local dependency directory was temporarily archived for testing; it has now been restored and successfully checked with `tar --compare` against that preserved archive. The accepted image and base runtime have a checksum-verified local archive at `/tmp/booking-m7-corrected-verified-images.tar`; the pre-correction image remains archived at `/tmp/booking-m7-pre-corrections-image.tar`. After successful verification, the generated harness aliases/image cache and temporary maintenance image were released through Docker; the verified image archive remains available. These are local disposable environment backups, not Git checkpoint contents. This host still needs adequate free inodes for future image builds/runs; use a host with sufficient Docker storage rather than weakening the safety guards. No repository reset or broad user-data cleanup was performed.
