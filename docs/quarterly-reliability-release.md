# Quarterly reliability repair and release checklist

## Scope and safety boundary

Source baseline: `05ba67bb28bc2434cbd286bb7a389bfc80b3470d` (rechecked on 2026-10-08).
This change repairs broker entry, administrator monitoring and the write boundary.
It does not repair, delete, relabel or automatically resubmit historical business
records. Tests use synthetic fixtures only. No production database writes or
migration application were used for development or verification.

The release is split into explicit operator stages. Expansion A adds preservation
and v2 RPCs while leaving all three legacy RPC definitions unchanged. It performs
no draft-table column alteration; the baseline/archive-trigger boundary is last,
with 500ms lock and 2s statement timeouts. B is an explicitly approved quarter
configuration freeze. C tightens the legacy submission contract only after a
verified old-client/in-flight drain. B/C scripts are outside automatic migrations.
See [the staged operator plan](quarterly-rollout/README.md).

The new client requires v2 and never silently falls back to legacy after an
ambiguous request. Publication is separate from production enablement. Midnight,
quiet logs, and a per-browser acknowledgement are not proof that old tabs contain
no unsaved keystrokes. Do not report all legacy risks eliminated before C.

## Audit-to-regression matrix

| # | Fault / ambiguity | Repair | Evidence |
|---|---|---|---|
| 1 | Draft read failure cleared entered values | Preserve memory/local copy; explicit read error; no guessed revision | `quarterlyDraftStore.test.ts` offline/reload tests |
| 2 | Category switch ignored save failure | Stay on current category until acknowledged flush | Workspace rendered integration test |
| 3 | In-flight save dropped newer edits | Serialized drain loop, immutable payload per write, acknowledged revision | Store delayed-save / duplicate-flush tests |
| 4 | Typing postponed autosave; errors never retried | Stable cadence, bounded exponential backoff, online retry | Workspace continuous-typing/backoff tests |
| 5 | Refresh/browser restart lost edits | Synchronous scoped local recovery; quota warnings; export/clear controls | Store restart, identity, retention and quota tests |
| 6 | Late load replaced newer input or another category | Independent account/period/category controllers; edit-version guards | Store late-read and workspace category-race tests |
| 7 | Duplicate/retried submits created extra rows | Durable immutable request IDs, Web Locks, idempotent v2 ledger | Submission-attempt tests; SQL replay/atomicity assertions |
| 8 | Submission claimed cloud preservation despite failed save | Require verified draft flush; strict submission receipt; explicit unresolved state | Workspace save-failure and submission receipt tests |
| 9 | Calendar fallback/unfinished settings exposed wrong period | Require valid configured period and all assignment reads before editing | Workspace missing/error settings and future-task tests |
| 10 | Relabeled historical drafts appeared current | Preserve historical reference separately; configured-period confirmation marker; no automatic copy | Store legacy quarantine and early configured-quarter tests; SQL marker/rollover tests |
| 11 | Formal records were invisible from entry page | Owner/period-scoped paginated read-only formal list; explicit restore with backup | Workspace formal-data isolation test |
| 12 | Filled draft counted as submitted | Separate draft completeness from formal record coverage | Workspace labels and independent formal query |
| 13 | Historical recovery could be mistaken for fresh entry | No retrospective inference; neutral unknown source; new v2 provenance has exact submission IDs | SQL exact-ID provenance tests; no timestamp-based provenance joins |
| 14 | Admin defaulted to calendar quarter | Configured defaults, retained manual viewing period, refreshed after config save | Admin configured-period/remount tests |
| 15 | Unknown total area became invented area 1 | Null total/rate when unknown; visible informational warning | Data-entry zero/null/area test |
| 16 | Numeric zero/string zero/null had different meaning | Presence-based completeness and nullable finite conversion | Data-entry and mobile zero-submit tests |
| 17 | Visible owner/PM defaults submitted as null | Submit exactly the displayed fallback on entered rows; mobile fields included | Workspace owner/PM zero-submit integration |
| 18 | Server accepted wrong assignment/category/invalid numbers | v2 validates owner assignment, category, future period/status, duplicate IDs, numeric bounds; legacy guards wait for explicit C | SQL `validation.sql` |
| 19 | Old reference called “previous quarter”; zero hidden | Actual reference-period labels; strictly earlier metrics; visible valid zero | Period safety/data-entry tests; inspected desktop/mobile rendering |
| 20 | Admin read errors appeared as zero/empty/unassigned | Key-scoped result states; fail-visible errors; export requires complete read | Admin failure and pagination tests |
| 21 | Admin stale period cache/log/export race | Cancellable keyed reads, scoped exports, retained viewing period | Admin deferred-response tests |
| 22 | Legacy draft parser broke UUID/future rows | Named regular/future entries, UUID/legacy alias normalization, period/revision metadata | Admin draft parser tests |
| 23 | Empty legacy log table implied no activity | Current audit event source, explicit owner/period scope | Admin event-source tests |
| 24 | Coverage implied completeness/freshness or omitted roles | Current-assignment intersection, all-role scope, explicit coverage definition and unknown historical origin | Admin reassignment/inactive/unassigned fixture and wording assertions |

Additional regressions cover mobile owner/PM parity, authentication changes,
server-row deletion conflicts, other-window local-cache preservation, terminal
SQL rejection versus ambiguous timeout, receipt-persistence failure, pagination
under a smaller server cap, and exact committed replay after rollover/assignment
changes.

## Data and permission design

- Existing formal rows remain unchanged. Existing drafts are copied into an
  append-only recovery history before future replacement; v2 rollover never
  relabels them, while unchanged legacy rollover remains a disclosed risk until B/C. No retention/deletion job is added to database history.
- Server-injected `draft_data.__quarterly_meta__` confirms only a guarded v2 save
  whose version, period and revision exactly match the current row. Old saves or
  relabels invalidate the marker. It does not assert that metrics are verified or
  fresh. Unconfirmed legacy values remain visibly available, with explicit restore.
- Before editing, a one-time account/browser/release acknowledgement asks the
  broker to save and close other legacy editing pages. Read-only preview remains
  available. This guard neither closes pages nor proves they were drained.
- New v2 provenance identifies an explicit submission flow, linked to exact
  generated submission IDs. Legacy rows remain unclassified. Owner-only
  provenance access additionally requires an existing account with an allowed role; retained evidence is not readable by a deleted account’s still-valid JWT. administrator screens do not infer a source
  from an inaccessible/missing marker or broaden permissions.
- Local recovery is keyed by account, year, quarter, category and project IDs.
  It stores business fields and request IDs, never authentication tokens.
  Unsynced work and conflict snapshots do not silently expire. Acknowledged
  current copies expire after 30 inactive days; explicit browser-copy removal
  is available after sync, with an irreversible-history warning and export.
- Partial submissions remain possible. Invalid numbers, negative values,
  vacant area exceeding a known total and ratios outside their bounds are
  blocked. The existing net-rent calculation uses a **36-month lease model**;
  its free-rent field is therefore restricted to 0–36 months. This is a model
  assumption, not a universal legal/business rule.

## Verification and known environment limits

Final local run on 2026-10-08: audit coverage passed, TypeScript passed, lint had 0 errors / 794 warnings, and all 98 Vitest suites / 558 tests passed. All thirteen staged SQL regression steps passed (including unchanged legacy contracts after A and explicit B/C behavior). The aggregate command then reached the environment-limited production build described below.

Run `npm run verify`, which includes audit coverage, typecheck, lint, all Vitest
suites and production build. The CI workflow also runs the isolated SQL regression runner using pinned PGlite 0.3.14. Run isolated SQL tests using the exact instructions
in `supabase/tests/quarterly-reliability/README.md`.

A pre-existing typecheck failure in `/api/health` used unsupported Supabase
`db.retry`. The smallest compatibility repair moves `.retry(false)` to the
actual query; its health contract test was updated.

The local production build compiles, then is blocked during `/api/oss` page-data
collection because the sandbox denies `os.networkInterfaces()` inside ali-oss
(`uv_interface_addresses` EPERM). This is not a passed build. Chromium launch is
also blocked by sandbox socket restrictions and an executor mount failure;
no real-browser smoke result or screenshots are claimed. Rendered React tests
are not a substitute for that browser stage.

PGlite tests verify SQL behavior against isolated synthetic schema fixtures.
They do not prove the complete production migration chain, managed Supabase
advisors, or real multi-session database concurrency. Those limits are explicit;
no tests contact production or use real user fixtures.

## Publication / deployment sequence

Use the detailed gates in [the operator plan](quarterly-rollout/README.md) and
[the release-window checklist](quarterly-rollout/RELEASE_WINDOW_CHECKLIST.md).
Publish only with current explicit approval, using the immutable tested manifest.
Do not merge/deploy merely because a preview is READY or because the clock reaches
the agreed window. Check the exact commit's normal-runner CI and correct target.

A requires backup/preservation checks, schema/trigger review and the bounded
archive boundary. A busy timeout aborts the whole transaction; do not retry it
automatically. B additionally requires approved quarter-configuration freeze and
no pre-existing setter invocation in flight. Do not enable mixed clients before
B is verified. C requires separately verified old-client/in-flight drain and
approval; it is never automatic after A, midnight, quiet logs, or the new UI
acknowledgement. If these conditions cannot be established, pause and report the
remaining coordinated-drain requirement. Preserve all business/history/request
records when aborting or rolling back UI code.
