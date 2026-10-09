# Quarterly reliability: staged operator rollout

These are preparation artifacts. No production execution is authorized by their
presence, and successful synthetic tests are not production approval.

## A. Expansion migration only

The migration `20261008075610_preserve_quarterly_drafts_and_idempotent_submission.sql`
adds new tables/functions and archive triggers. It does **not** alter the
`update_drafts` columns or replace any of these existing RPCs:

- `save_quarterly_draft`
- `submit_quarterly_batch`
- `set_current_submission_period`

It adds `save_quarterly_draft_v2`, `submit_quarterly_batch_v2`,
`set_current_submission_period_v2`, and authenticated read-only
`get_quarterly_rollout_status()`. The rollout-control flag initially remains false.
New clients must explicitly use v2. Expansion is not a strict legacy-RPC cutover:
old submissions retain their prior numeric/assignment behavior and old rollover
retains its prior relabel behavior until the later operator phases. This temporary
compatibility tradeoff is deliberate; do not claim the legacy bypass is fixed.

All new table/function setup precedes the live draft-table lock. The final section
sets local `lock_timeout = '500ms'` and `statement_timeout = '2s'`, takes a SHARE ROW
EXCLUSIVE lock, copies the baseline, installs the draft archive triggers, and
commits. The lock blocks concurrent draft writes briefly; each statement has the
stated timeout, not a blanket guarantee that the whole transaction takes 2 seconds.
A timeout aborts the whole transaction. Do not automatically retry; inspect
contention and obtain a newly approved execution window. No ACCESS EXCLUSIVE
column migration is performed on `update_drafts`.

Before any live phase, verify a suitable restore point/backups and perform
multi-session concurrency/lock testing on a disposable full-schema environment.
Synthetic PGlite testing cannot prove live lock duration, production triggers,
connection behavior, or client-session drain.

## B. Explicit quarter-configuration freeze

`02_freeze_quarter_configuration.sql` is intentionally outside the migration
folder. Run only with explicit approval for this phase, after confirming that no
quarter-configuration operation is in flight. It replaces only the old quarter
setter with a wrapper to setter_v2, then sets the new freeze flag true atomically.
Both old and new quarter setters then reject configuration changes. It does not
replace the old draft or submission RPC, so ordinary broker saving/submitting
continues with its previous contract.

Already-running legacy function bodies cannot be retroactively frozen by CREATE
OR REPLACE. Confirm no administrator is changing the configured quarter before
executing B. The advisory lock synchronizes v2 operations; it does not magically
synchronize pre-expansion legacy code.

## C. Explicit strict cutover after session drain

`03_enable_legacy_guards_after_drain.sql` requires separate approval, verified
old-client session drain, and review of the new rejected-input recovery UX.
Do not make a workday cutover merely because expansion was successful.

It preserves the old quarter-setter signature by wrapping the draft-preserving
v2 setter, replaces the old submission body with a same-signature strict-v2
wrapper, and lifts the quarter freeze atomically. Only after this phase do both
public submission RPCs enforce the new assignment/category/numeric checks. Old
submission calls generate a fresh request UUID per call, so replay idempotency
still requires the stable caller-supplied UUID supported by v2. New clients must
never silently fall back to the legacy RPC following an ambiguous v2 result.

The legacy save RPC is never replaced by these artifacts. New clients use save_v2;
old clients remain compatible if temporarily encountered after deployment.

## Confirmation metadata and provenance

save_v2 overwrites the reserved `draft_data.__quarterly_meta__` key server-side:
`{version: 2, year, quarter, revision}`. A client accepts confirmation only when
version is exactly 2 and all period/revision values match the row exactly. An old
save increments the row revision without refreshing this marker; legacy rollover
changes its row period without refreshing it. Both invalidate confirmation.
This identifies an explicit configured-period save even before the calendar quarter
starts; it does not establish metric freshness or independently verified facts.

Submission provenance records exact generated submission UUIDs for both regular
and future rows accepted through v2. Historical rows and old RPC writes before
phase C are not retroclassified. `user_confirmed_submission` means the explicit
submission path was used, not that anyone independently verified the metrics.

## Rollback / abort

Never drop tables, purge history/provenance, rewrite existing draft values, or
restore relabel behavior as an automatic rollback. If A times out, its transaction
rolls back atomically; stop instead of retrying. If B or C fails, its transaction
rolls back atomically. If a UI deployment needs rollback, keep the additive tables,
archives and request evidence intact and obtain an operator-approved plan for
which clients/RPCs remain enabled. Keep or re-establish the configuration freeze
when its safety purpose still applies. Any function/flag rollback is a separately
reviewed action, not an unattended cleanup step.


## Known pre-existing identity constraint

`update_drafts` retains both owner/tab uniqueness and `UNIQUE(user_name, tab)`.
Consequently different owners sharing a display name can conflict on the same tab.
The expansion does not drop or alter that constraint: a conflicting save fails
with a uniqueness error and preserves the original owner's draft. Synthetic tests
exercise both old and v2 save paths. Resolving this identity-design constraint
needs separately reviewed post-drain schema work, not an unapproved live cutover.

## Retained-evidence reader boundary

Archive and provenance retention does not preserve account access. Both new SELECT
policies require matching ownership plus an existing auth account with an active
viewer/editor/admin application role. Removing that role or deleting the account
immediately denies retained-evidence reads even if an old JWT remains unexpired.
Owner viewers can still read their own evidence. Existing business-table policies
are unchanged. See [the grant manifest](GRANT_MANIFEST.md).
