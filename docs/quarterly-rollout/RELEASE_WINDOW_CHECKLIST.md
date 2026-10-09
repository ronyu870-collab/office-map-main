# Release-window checklist

This document is a conditional checklist, not an instruction to execute production
changes merely because a time has arrived. Use the current explicit release
approval and immutable artifact hashes. Never run phase C automatically.

## Preconditions for any publication or live step

- Verify the approved GitHub repository, branch, deployment project and database
  target. Do not infer a target from an unverified name or URL.
- Verify artifact SHA-256 hashes and the exact upstream base. If upstream moved,
  reconcile and rerun checks; do not force-push over other work.
- Run the normal-runner Verify workflow against the exact candidate commit.
  Local type/audit/lint/tests and synthetic SQL passed; local build/browser checks
  were constrained by the sandbox and are not production verification.
- Review the actual target schemas, constraints, policies and trigger order. The
  synthetic schema does not cover the entire production migration chain.
- Ensure a suitable restore point and securely preserve before-state evidence.
  Keep any actual rows/identifiers/hashes in a private operations location, never
  commit them to the repository or synthetic test fixtures.
- Check active/idle-in-transaction sessions, lock waiters and current errors.
  Do not cancel transactions, disconnect brokers or force page refreshes.
- Preserve counts and per-existing-row hashes for drafts and formal submissions,
  plus configured period and legacy function definitions. After the operation,
  distinguish legitimate concurrent business activity from migration changes;
  never restore an old snapshot over newly entered broker data.

## A: additive preservation only

1. Confirm that A has not already been applied. Partial/uncertain state requires
   investigation, not DROP/recreate or blind replay.
2. Confirm expansion leaves legacy save/submit/rollover function definitions
   untouched and introduces no draft-table column alteration.
3. The final boundary acquires SHARE ROW EXCLUSIVE on update_drafts, copies every
   current row and installs preservation triggers atomically. It temporarily
   blocks writers, not ordinary readers. lock_timeout=500ms and
   statement_timeout=2s are per-statement bounds, not a whole-transaction promise.
4. Execute once only in an approved suitable window. On timeout, contention,
   unexpected schema/trigger errors or uncertain outcome: stop, inspect and
   report. Do not retry automatically or increase the timeout.
5. Verify committed object definitions, enabled trigger identities, owner-only
   read policies, baseline snapshots and unchanged legacy function definitions.
   Do not submit synthetic business rows to production as a smoke test.

A improves preservation but can still add trigger overhead/failure modes to old
writes. Without full-schema multi-session testing, do not claim proven zero-loss
live compatibility. If the remaining uncertainty is outside the approved risk
boundary, pause before A and ask for the missing environment/window.

## B: separately approved quarter-configuration freeze

- Confirm the operator approved this temporary restriction and that no old
  quarter-setter call is in flight. The new wrapper cannot retroactively stop an
  already-running function body.
- Apply the exact B script once. Verify both setter entrypoints report frozen and
  ordinary broker save/submit contracts remain unchanged.
- Record the freeze commit time and verify that transactions capable of carrying
  an older setter invocation have finished before mixed-client enablement.
  No automatic kill/cancel or inference from a single quiet activity snapshot.
- If the absence/drain cannot be established, do not proceed. Keep the restriction
  or roll it back only under an explicitly reviewed operator plan.

## New frontend enablement

- Verify A/B prerequisites, matching RPC names and the exact reviewed deployment.
- Existing old tabs are not refreshed or modified. New pages offer read-only
  original-draft preview until the account/browser/release acknowledgement.
- Explain that acknowledging saved/closed old editing pages is a user declaration,
  not server proof. An old tab can still retain unsaved local input.
- If mixed-client risk is not accepted by the reviewed release conditions, pause
  frontend enablement and report the need for coordinated saved-session drain.

## C: only after verified old-client and in-flight drain

- Obtain specific phase-C approval and coordinated confirmation that old editing
  sessions have saved/closed; midnight, quiet requests, database snapshots and
  the one-time browser marker are insufficient by themselves.
- Apply the exact C script only after those prerequisites. It closes the legacy
  validation bypass and enables preserving rollover through the old signature.
- Legacy transport retries still lack caller idempotency IDs. New clients always
  use stable v2 request IDs and never fall back after ambiguous results.
- Retain the append-only archive, request ledger, provenance and all business
  rows. Do not DROP, prune or overwrite them during rollback or cleanup.

## Pause/report outcome

Report which stages actually completed, exact commit/migration hashes, before/after
preservation checks, which checks passed, which did not run, and the specific
remaining gate. A successful code push is not a production migration; A is not B/C;
a READY deployment is not evidence that broker input was verified safe.
