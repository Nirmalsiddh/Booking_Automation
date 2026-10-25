# Milestone 5 checkpoint — complete

The approved isolated M5 implementation and verification are complete. See
`milestone5.md` for architecture, migration/recovery and reproduction instructions,
and `milestone5-results.md` for all scenario outcomes, exact regression comparisons
and retained diagnostics. The inactive candidate is `workflows/milestone5.json`.

- 24/24 actual n8n scenarios pass, including all 18 approved M5 cases.
- 66 unit tests and nine harness safety tests pass.
- M2, M3 and M4 regression assertion outcomes match prior baselines exactly.
- The original and M2–M4 workflow files are unchanged.
- Live providers, credentials and delivery are unverified; tests use synthetic data,
  network-disabled containers and deterministic providers.
- Remaining stale follow-up/handoff failures belong to M6 and remain visible.
- No production activation, deployment, commit or push occurred.

Stop at M5. No additional milestone is authorized by this completion.

## Archived pre-resume checkpoint (historical, superseded)

# Milestone 5 implementation checkpoint — incomplete

The user approved SQLite reservation authority and the synthetic capacity-one policy.
No further approval is needed to finish that agreed implementation.

Implemented foundation files:

- `src/booking/store.js`: additive domain tables, reservation overlap trigger, transactional
  prepare/dispatch/settle, retained uncertain holds, projection ownership/revisions and
  notification dispatch records. M4 user_version and message tables are preserved.
- `src/booking/verify.js`: draft normalized transport-result classification functions.
  Their trusted metadata/absence/read-back contracts still need real adapter wiring;
  these functions do not establish live provider guarantees.
- `config/reservations.json`: explicitly synthetic resource with capacity one.
- `tests/booking.test.js`: 14 storage/verifier tests, including real concurrent processes,
  failed rescheduling/cancellation, uncertainty after reopening, and M4 record preservation.

Verification executed: `node --test tests/*.test.js` (56 pass), and
`python3 -m unittest discover -s tests/harness -p 'test_*.py'` (7 pass).
No M5 Docker/n8n integration suite has run. These counts do not satisfy M5 acceptance.

Outstanding required work:

1. Harden/version the migration runner and expose read-only uncertain-result reconciliation.
2. Integrate existing business hours, timezone and duration policies with reservation dispatch.
3. Implement trusted Calendar transport normalization, external availability checks and verified
   read-back contracts. Do not trust provider-supplied booleans as proof of absence/no effect.
4. Wire independent projection retries/coalescing and notification failure handling, including
   identity-bound result verification. The current primitives are not a complete coordinator.
5. Generate inactive `workflows/milestone5.json` from M4 while preserving M3 authorization,
   M4 claims, authoritative booking hydration and independent business operation records.
6. Extend the isolated harness with all 18 M5 scenarios, real container restart during a
   pending mutation, provider mocks and absence-of-side-effect assertions. Preserve old fixtures.
7. Rerun prior regression suites, compare outcomes, document migrations/recovery and produce
   the complete M5 report. Keep the M6 follow-up/handoff failures visible.

The reservation engine currently explicitly rejects capacity other than one; capacity is
represented in the resource table but group-capacity allocation is not implemented.
Do not activate or use these foundation modules as a complete booking platform.
No live service, production database, existing workflow, commit or deployment was used.
