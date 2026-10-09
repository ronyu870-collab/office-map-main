# Quarterly reliability synthetic SQL tests

The runner uses fresh in-memory PostgreSQL (PGlite) and synthetic data. It has no
connection-string input and never connects to Supabase. It loads a minimal schema,
the original RPCs, expansion migration, and separately staged operator scripts.
This is not a full production migration-chain or concurrent-client verification.

```sh
npm install --prefix /tmp/quarterly-db-tests --save-exact @electric-sql/pglite@0.3.14
PGLITE_MODULE=/tmp/quarterly-db-tests/node_modules/@electric-sql/pglite/dist/index.js \
  node supabase/tests/quarterly-reliability/run.mjs
```

Thirteen stages verify:

- Expansion leaves the three old RPC definitions byte-identical, without a draft
  table column alteration or an automatically enabled configuration freeze
- Old save/submission behavior remains compatible after expansion, including
  formerly accepted negative numeric data, until explicit operator cutover
- Server-injected save_v2 metadata is tied to the exact period and revision;
  old saves and legacy relabels invalidate it, while early future-quarter saves
  made through v2 remain recognizable
- Immutable owner-readable draft snapshots, baseline/replace/delete recovery,
  optimistic conflicts, and identity-filled legacy insert attribution
- v2 rollover retains original draft metadata and excludes entered-market supply
- Exact request replay, including after rollover/assignment changes, and rejection
  of changed payloads under the same key
- Assignment/category/status/duplicate/numeric guards on v2, with null/incomplete
  fields and legitimate zeros preserved, and no fabricated total-area denominator
- Actual second-leg insert failure rolls back submissions, provenance and ledger
- Exact formal-submission UUID provenance, owner-only reads, no client fabrication
- Phase B freezes both quarter setters while ordinary legacy saves/submits work
- Phase C alone enables strict legacy submission guards and preserving rollover;
  valid legacy calls keep the original response shape

See [the staged rollout plan](../../../docs/quarterly-rollout/README.md) for exact
contracts and operator prerequisites. Operator SQL lives outside migrations and
must never be treated as an automatically authorized follow-on to expansion.
No production apply, advisors, full-schema replay, lock-contention tests, or
multi-session proof has been performed by this synthetic test suite.


The synthetic fixture includes the pre-existing `UNIQUE(user_name, tab)` draft
constraint in addition to the owner/tab index installed by the earlier migration.
It also models relevant live foreign keys, required columns, quarter checks,
revision default zero, UUID submission/assignment IDs, identity-fill timing, and
submission updated-at triggers. Two distinct owners using the same display name
and tab receive a visible uniqueness error in both save RPCs; tests prove the
existing draft and archive are unchanged. This is a known pre-existing identity
constraint, not corrected by the expansion. Any replacement of that constraint
requires a separately reviewed post-drain schema change.

The latest legacy quarter-setter definition is extracted from its repository
migration without running that migration's historical data corrections. Private
catalog evidence is not copied into the repository or fixture.


`reader-security.sql` verifies owner-viewer access and denial for role-disabled
or deleted accounts while retaining their old simulated token identity. Retained
history/provenance are not deleted; cross-owner and anonymous-helper denial remain
in force. Only the two new evidence-table SELECT policies receive this boundary.
