# Historical Lease Building Alias Governance

## Purpose

Historical lease rows preserve source-era building names as text, while the current building inventory uses `public.buildings.id` as the canonical project identity. This document defines the controlled bridge between those two representations.

The historical transaction source table is not rewritten during identity resolution.

## Authoritative objects

- `public.lease_transactions_history`: governed historical source records; unchanged by alias resolution.
- `public.buildings`: current building/project inventory.
- `public.lease_building_name_map`: machine-readable alias -> `building_id` relation used by the lease read layer.
- `public.lease_building_alias_review`: review ledger for historical aliases, evidence, candidates and resolution status.
- `public.buildings.former_names`: user-visible historical/legacy aliases confirmed for the current building entity. In this system the field may include a historical tower/phase label that resolves to a current project-level entity; it must not be interpreted as a legal/corporate-name-history field.

## Resolution statuses

- `AUTO_VERIFIED`: deterministic, unique mapping under the conservative rules below.
- `MANUAL_VERIFIED`: mapping explicitly confirmed through human review.
- `NEEDS_REVIEW`: no safe automatic decision; must not enter the canonical alias map.
- `NO_MATCH`: reviewed and confirmed to have no current building entity.

## Automatic matching rules

Automatic matching deliberately does **not** use fuzzy similarity to create a relationship.

Allowed deterministic cases:

1. Normalized exact identity: punctuation, whitespace, case or full-width formatting only.
2. Exact normalized match to an already registered `former_names` value.
3. Exact match to a unique parenthetical alias embedded in the current building name, e.g. `IFC` -> `国际财源中心（IFC）`.
4. Unique `北京` / `中国` leading-prefix difference when location context does not conflict.
5. Unique trailing parenthetical annotation only, with no competing current sibling entity.
6. Tightly constrained `大厦` / `中心` suffix difference only when the historical core is sufficiently specific, there is one candidate, and a single historical submarket agrees with the current building submarket.
7. Historical subunit -> current project-level entity only when the historical name is the current project name plus a recognized tower/phase suffix, the candidate is unique, location context does not conflict, and the current inventory contains no competing sibling entity under that project base name.

The reverse direction is intentionally unsafe: a historical project-level name must not be automatically assigned to one current tower. For example, a historical `华贸中心` row cannot be forced into either `华贸中心三座` or `华贸中心 (一座、二座)` without additional evidence.

## Production result — 2026-09-15

Starting unresolved universe: 1,583 distinct historical building names.

After deterministic automatic resolution:

- 137 historical names were `AUTO_VERIFIED`.
- Those names cover 567 formerly-unmapped historical lease rows.
- Total historical rows linked to a current `building_id`: 2,779 / 6,543 (42.5%).
- 1,446 names covering 3,764 rows remain `NEEDS_REVIEW`.
- 203 unresolved names have non-binding candidate suggestions in `candidate_snapshot`.
- 1,243 unresolved names have no conservative prefix candidate.

The history table remains 6,543 rows with 6,543 unique `source_uid` values. No historical source row was updated or deleted.

## Human review order

Review `NEEDS_REVIEW` rows by `historical_row_count DESC` so the highest-impact aliases are resolved first. Candidate snapshots are suggestions only and must not be treated as mappings.

High-impact examples include:

- `华贸中心` — 101 rows; multiple current building entities.
- `东方广场` — 88 rows; current East / Central / West entities.
- `环球贸易中心` — 77 rows; multiple current tower groups.
- `恒通商务园` — 45 rows; no conservative candidate.
- `WFC` — 42 rows; abbreviation requires human confirmation.
- `望京SOHO` — 41 rows; current inventory is more specific than the historical project-level name.
- `保利国际广场` — 40 rows; current inventory is more specific than the historical project-level name.
- `盈科中心` — 39 rows; multiple current entities.
- `大族广场` — 35 rows; multiple current tower groups.

## Manual verification contract

A human-approved mapping should:

1. update the review row to `MANUAL_VERIFIED` with the chosen `matched_building_id`, basis, reviewer note and resolution time;
2. insert the alias into `lease_building_name_map` with `verification_status='MANUAL_VERIFIED'`;
3. append the confirmed alias to `buildings.former_names` when it is useful for user-facing identity/history lookup;
4. never rewrite the historical transaction's original `new_building` text;
5. preserve the ability to audit which historical string produced the relationship.

## Safety boundary

Do not broaden automatic rules merely to improve the coverage percentage. A missing relationship is preferable to a wrong building identity because Map building profiles, tenant histories, company migration paths, expiry analysis and future AI queries all inherit this relation.
