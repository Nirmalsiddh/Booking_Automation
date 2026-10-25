# GitHub sharing review — M1–M6

Status: documentation and ignore-rule hardening are prepared, but **the existing Git
history is not privacy-cleared for publication**. No commit, push, deployment, history
rewrite or workflow activation is part of this hardening task.

The preserved checkpoint is `0d9a2d02444aad13737c1e4b25cf3794851dfa3a` on
`checkpoint/milestones-1-6`. Documentation work uses the separate branch
`hardening/github-sharing-m1-m6`. The original workflow, M2–M6 candidates and simulation
video remain unchanged. All candidates stay inactive.

## Workflow and configuration findings

Automated structured review covered `workflow.json`, all five candidate exports and all
three configuration JSON files. Pattern/entropy review of the checkpoint's text additions
found no apparent live keys, private keys, exported credential values or real customer
records. Synthetic authentication strings remain in test code by design.

| Export | n8n credential reference sections | `webhookId` / `versionId` / `instanceId` fields |
|---|---:|---:|
| Original | 25 | 7 |
| M2 | 25 | 6 |
| M3 | 26 | 6 |
| M4 | 26 | 6 |
| M5 | 26 | 6 |
| M6 | 26 | 6 |

Credential reference objects contain only `id` and `name`, not secret credential data.
Those identifiers and labels are environment metadata and should be reviewed before
public distribution. Workflow, node, webhook/wait and instance metadata also remain.
Existing references were deliberately not edited: changing verified exports would change
their hashes and could break imports or behavior.

Account-looking Calendar email values in these exports are placeholders. Detected URL
hosts in workflow parameters are the public Google Docs and WHAPI service hosts; no
private deployment URL or non-placeholder customer email was identified in the JSON
review. API host literals in adapter source are intended provider endpoints, not proof
of live compatibility. Test loopback URLs and reserved network-probe addresses are local
harness mechanisms.

`config/` holds synthetic business policy, including Asia/Dubai and a capacity-one
synthetic resource. `/inbox`, `/harness` and `/data` paths are container configuration.
Cloud workspace paths and old evidence UUIDs in historical documentation are environment
references, not dependencies included in a clone. The new reproducibility guide supplies
a portable runtime-directory example. No user environment file is required for testing.

Before publishing exports, consider separately approved sanitized demonstration copies:
remove credential bindings and nonessential instance/account metadata in those copies,
keep graph/reference consistency, and rerun their isolated tests. Keep the checkpoint
exports intact. No automatic sanitizer or credential-reference rewrite was introduced.
A scanner reporting no secret is not clearance of every binary or historical commit.

## Simulation video — privacy clearance withheld

Reviewed asset: the already-tracked `Simulation_video_booking_automation.mp4`, approximately
503.13 seconds (8:23), 1280×720 H.264 at 30 fps, with a stereo 48 kHz AAC audio stream.
The source file was read only and remains unchanged.

Visual review used **252 locally extracted frames at two-second intervals**, Tesseract
OCR and a deliberately blurred layout overview. Raw frame content, email addresses,
numeric identifiers and conversation text are not included in this report or committed
artifacts. Private inspection frames were kept outside the repository in a restricted
local temporary directory.

OCR flags, counted by sampled frame rather than by unique person/identifier:

| Category | Flagged sampled frames | Interpretation |
|---|---:|---|
| Email-like text | 103 | May include identifying values; not cleared as synthetic |
| Phone-like numbers or numeric identifiers | 19 | Ambiguous account/phone data; owner review required |
| Account, URL or webhook UI indicators | 25 | Environment/account context may be visible |
| Conversation/message UI indicators | 224 | Conversation content may require privacy review |
| Recognizable provider-key shapes | 0 | Not proof that no key appears in unsampled or unreadable content |

A second OCR pass on selected flagged frames corroborated non-placeholder email-like
text in table-related screens. Examples requiring visual owner review include **03:58,
04:40 and 07:26**. Numeric identifier flags occur around **02:22, 04:18 and 06:22**.
No identifying values are printed. OCR cannot establish whether a visible address/number
belongs to a real person or is authorized demonstration data; do not assert either.

Audio was decoded across the entire available stream to float32 PCM. All **48,295,936
interleaved sample values were zero** (peak absolute amplitude 0.0). The decoded audio
therefore contains digital silence; no speech transcript was needed or produced. No
local speech-recognition engine/model was installed. This result concerns decoded audio,
not visual privacy or arbitrary hidden metadata.

A continuous manual frame-by-frame review was not performed. Two-second sampling can miss
brief fields, small text, OCR errors, unrecognized key formats and private conversations.
The video is **not privacy-cleared**. Full owner review or a separately approved synthetic
replacement/public derivative is required before distribution. Do not use the blurred
inspection overview as evidence that the original file is redacted.

The video is already present in ancestor commits. Removing its README link, ignoring it,
or later deleting it in a new commit does not remove it from history. No deletion,
replacement, redaction or history rewrite was performed. If the asset cannot be cleared,
do not push the current history; request approval for a separate privacy-safe distribution
strategy that preserves the private checkpoint.

## Ignore rules and publication discipline

The expanded `.gitignore` excludes local environment settings, SQLite databases and
explicit WAL/SHM/journal suffixes, common root credential exports/private material, n8n
runtime/data locations, dependency installations, logs, caches and temporary/generated
execution directories. It preserves `.env.example` naming for placeholder-only examples.
Do not put real values in examples.

Source modules, workflows, business configuration, `.sql` migrations, schema JSON,
dependency lockfiles, harness definitions and curated Markdown evidence remain eligible
for Git. Existing files were not removed or overwritten by an ignore operation. Rules
cannot protect already tracked content, unknown secret filenames or old commits. Use an
explicit reviewed staging allow-list and a fresh secret review before publication.

Raw execution evidence stays under ignored `.harness-results/`. Historical Markdown
summaries remain tracked so their limitations and known failures remain visible. Private
video inspection material and external runtime/image archives must never be copied into
a public checkpoint.

## Reproducibility and validation scope

See [reproducibility](reproducibility.md) for prerequisites, separate dependency acquisition,
local image bootstrap, automatic custom-node installation, inactive import and scenario
commands. There is no standalone production deployment package. Transitive dependencies
are not locked in this repository, and fresh external dependency acquisition was not
performed during hardening. No provider credentials or customer services were used.

The saved M6 acceptance report remains historical evidence: 35 passing scenarios across
108 native n8n executions, including interruption and restart. A documentation change is
not a fresh integration run. Verification performed for this hardening change is recorded
below after completion; workflows and their runtime-source digests must still match.

## Publication decision and next steps

1. Review the local documentation/ignore diff and approve a separate hardening commit.
   No commit or push is automatic.
2. Resolve video privacy for the entire history intended for publication. Decide explicitly
   whether to retain the reviewed history or approve a separate sanitized distribution.
3. Review credential-reference metadata and any approved public export copies; keep the
   checkpoint's original candidates unchanged.
4. Recheck the final staged allow-list, secret scan, current tests and documentation links.
   Include curated summaries, exclude raw recordings/inspection artifacts that lack clearance.
5. Only after explicit publication approval, verify the remote/visibility and publish the
   reviewed branch or distribution. Do not activate workflows or use customer credentials.

M7 remains unimplemented and requires separate approval. No open-source license choice,
provider certification or production-readiness claim is made by this documentation work.

## Verification performed for this hardening change

- Reran **93/93 Node unit tests** and **12/12 Python harness safety tests** successfully.
  Safety reset tests touched only their own temporary fixtures, not existing evidence.
- All five M2–M6 builder `--check` commands passed. The original and all candidate exports
  remain byte-identical to the checkpoint and inactive. M5/M6 runtime-source digests match
  their saved acceptance reports.
- Tested ignore behavior against **54 excluded-path examples** and **93 preserved-path
  examples**, including all 81 checkpoint files and additional source/schema/lockfile cases.
- Local Markdown links and key-pattern checks passed; `git diff --check` passed. No raw
  video identifiers, conversation text or authentication values were added to documentation.
- The 79 checkpoint files outside the two intentionally edited files (`README.md` and
  `.gitignore`) remain unchanged. All **6,410 pre-existing ignored files** retain their
  content checksums. The original simulation video remains unchanged.
- The checkpoint branch still points to `0d9a2d02444aad13737c1e4b25cf3794851dfa3a`, which
  remains reachable. The hardening branch has no new commit and nothing staged.

The Docker/n8n integration suites were **not rerun** for these documentation-only changes;
their saved mock results are identified separately above. No new dependency download,
live API call, workflow activation, commit, push, deployment or M7 implementation occurred.
