# Milestone 1 baseline

Baseline source: `workflow.json`, SHA-256
`2b5d405893fec176205a785e9cff4f16013ecfff619aa23e83c5747d84853375`.
Initial branch: `work`; HEAD: `2fd834a5849bde686d9b8b236631e18c0679528d`.
The checkout was clean before implementation. Existing tracked files are unchanged.

Runtime: n8n 2.44.6, Node 24.19.0, actual CLI workflow execution inside a
network-disabled, non-root Docker container. Provider integrations and waits are
replaced by test adapters. These are **mock-backed workflow results, not live
integration verification**.

## Observed scenarios

| Scenario | Result | Observation |
|---|---|---|
| New customer inquiry | PASS | Creates a lead, sends mock reply, and schedules/runs virtual follow-up path without a calendar operation |
| Existing customer inquiry | FAIL | Existing email and goal are cleared by null-valued profile mappings |
| Multi-turn qualification | FAIL | Later extraction clears earlier email; evaluated memory session key changes after the first row is saved |
| New booking | PASS | One mock calendar event; confirmed state references its ID; confirmation branch executes |
| Rescheduling | PASS | Updates the seeded event without creating another event; records rescheduled status and response |
| Cancellation | PASS | Removes seeded event, records cancelled status, and sends a mock response |
| Customer declines | PASS | Closes lead and sends a single closing reply |
| Invalid AI response | PASS | A malformed JSON string produces the existing fallback and no booking |
| Calendar operation failure | FAIL | Recorded calendar failure still proceeds to confirmed state and confirmation branch |
| Duplicate webhook | FAIL | The same provider message is processed twice; the second invocation enters Interested and follow-up processing |
| Reply during follow-up delay | FAIL | A second actual n8n execution books successfully, but the older execution still follows up and overwrites lead status during escalation |

The suite contains 30 positive correctness assertions: 22 pass and 8 fail across
6 passing and 5 failing scenarios. All 14 underlying n8n executions, including the
interleaved reply, complete; successful orchestration does not imply correct business
behavior. Failures remain **FAIL** in output, including when the explicitly opt-in
baseline-failure flag allows a zero exit status.

Five host safety test methods also pass. The unsafe-configuration method checks
multiple rejected networking, credential, privilege, device, namespace, mount, and
entrypoint configurations. Safety checks remain active with `python -O`.
The full suite was executed twice with identical scenario outcomes and executed-node
paths. The first execution's Docker tmpfs artifact-copy mechanism failed; the corrected
run retained full operation ledgers and execution artifacts, with a repeatability record.
The generated copy retains all 14 non-integration/non-wait node definitions unchanged;
all production credential references are removed. The cancellation fixture's `=` event-ID
mapping resolves to an empty string under this pinned runtime; no clearing defect was
observed in that fixture.

## Confirmed defects to carry forward

1. **Destructive profile updates:** AI fields omitted from a later message become null,
   and mapped null cells become empty strings in the mock matching installed Sheets behavior.
2. **Session-key discontinuity:** fresh and existing customer keys differ. Native memory
   persistence is not tested; the expression discontinuity is verified.
3. **False success after API failure:** `continueOnFail` reaches success-state writes
   and confirmation routing without inspecting the external result.
4. **No inbound deduplication:** a repeated webhook invokes AI and messaging again.
5. **Stale follow-up processing:** no eligibility recheck prevents old executions from
   messaging and escalating a customer after a newer booking.

The duplicate path also demonstrates that the existing anti-rebooking fallback changes
a confirmed customer's state through Interested handling instead of preserving booking state.
No defects are repaired in Milestone 1.

## Safety evidence and interpretation

- Host inspection: `network=none`, read-only root, non-root user, no host mounts or
  published ports, dropped capabilities, `no-new-privileges`.
- In-container inspection: only loopback; no IPv4 routes.
- IPv4 and IPv6 reserved-address probes: `ENETUNREACH`.
- No production credentials, webhook activation, messages, or bookings are used.
- Original workflow hash matches the image baseline and remains unchanged.

Per-run evidence is generated under `.harness-results/`; see `README.md` for commands,
artifact layout, failure exit codes, and reset safeguards. Do not infer Google/WHAPI
compatibility, model quality, webhook authenticity, conflict prevention, or native
Wait durability from these passing mock scenarios. The invalid-AI case covers malformed
JSON, not full schema validation. Additional branches and failure combinations remain untested.
