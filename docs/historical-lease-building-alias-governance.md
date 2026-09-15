# Historical Lease Building Identity Governance

## Purpose

Historical lease rows preserve source-era building names as text, while the current building inventory uses `public.buildings.id` as the canonical identity. This document defines the controlled, auditable bridge between those representations.

The historical transaction source table is not rewritten during identity resolution.

## Authoritative objects

- `public.lease_transactions_history`: governed historical source records; identity resolution must not rewrite these rows.
- `public.buildings`: current building/project inventory.
- `public.lease_building_name_map`: exact historical alias -> one current `building_id`.
- `public.lease_building_project_map`: verified project/complex alias -> one or more current building members where project identity is certain but tower attribution is not.
- `public.lease_building_record_map`: source_uid-level override used only for true same-name/multi-building exceptions that can be resolved from row context without polluting the global alias map.
- `public.lease_building_alias_review`: governance ledger for historical aliases, candidates, evidence, inventory gaps and review state.
- `public.buildings.former_names`: user-visible historical/legacy aliases confirmed for a current entity. In this system it is an identity/search field, not a legal/corporate-name-history field.
- `public.lease_transactions_read_v1`: service-only canonical read model. For history it resolves identity in precedence order: record-level override -> exact alias -> project membership -> unmapped.

## Resolution states and read precision

Alias review states:

- `AUTO_VERIFIED`: deterministic exact mapping to one current building.
- `MANUAL_VERIFIED`: exact mapping explicitly confirmed through human review.
- `AUTO_VERIFIED_PROJECT`: deterministic project/complex association where exact tower attribution is not justified.
- `INVENTORY_GAP`: external/current building identity is confirmed, but the current 642-building inventory has no safe canonical/former-name carrier.
- `NEEDS_REVIEW`: evidence is insufficient or genuinely ambiguous.

The read layer exposes `building_match_scope`:

- `exact`: one current building is safely known, including source_uid-level overrides.
- `project`: the project/complex is known, but one exact current tower is not asserted.
- `unmapped`: no safe current association is available.

## Evidence hierarchy

Automatic resolution deliberately does **not** use a generic fuzzy-similarity threshold to create identity.

Strong evidence includes:

1. normalized exact identity: punctuation, whitespace, case or full-width formatting only;
2. exact match to a verified `former_names` value;
3. unique canonical-name expansion or contraction with no competing sibling entity;
4. exact parenthetical/English acronym identity such as `IFC` or `PVG` when current metadata and location context agree;
5. current address / coordinate coincidence plus rename evidence;
6. official or current company/building sources documenting a rename;
7. historical tenant/address/context corroboration;
8. current project structure proving a historical tower belongs to one current aggregate entity;
9. verified project membership when a historical project-level name cannot honestly be assigned to a current tower;
10. source_uid-level contextual resolution for a reused historical label, for example a submarket that uniquely distinguishes two current buildings.

Dense-area proximity alone never proves identity. Address/building-number/project evidence overrides nearest-neighbour distance.

## Granularity rule

The unsafe direction is intentionally prohibited: a historical project-level name must not be forced into one current tower simply because only one candidate looks convenient.

Examples:

- historical `华贸中心` must not be arbitrarily assigned to `华贸中心三座` or `华贸中心 (一座、二座)`;
- historical `环球贸易中心` is a project association across current tower groups unless a row contains stronger tower evidence;
- historical `月坛中心` is associated to the current project surface without pretending that every historical deal occurred in the currently inventoried E座.

## Same-name/multi-building exception

A global alias map is not sufficient when the same historical label was reused for different physical buildings.

`平安金融中心` is the reference case:

- rows with `sub_market in ('丽泽', '丽泽商务区')` resolve at source_uid level to `丽泽平安金融中心`;
- rows with `sub_market='燕莎'` resolve at source_uid level to `平安国际金融中心`;
- CBD and no-submarket rows remain unresolved.

No global `平安金融中心 -> building_id` alias is created.

## Inventory gaps

`INVENTORY_GAP` means the identity problem is understood but the current building inventory is incomplete. These rows are not candidates for forced nearest-neighbour matching.

The review ledger stores, when known:

- `external_canonical_name`
- `external_address`
- `external_lat`
- `external_lng`
- `evidence_snapshot`

This makes the gap pool a structured input to future building-inventory expansion.

Examples include 石榴中心、东方梅地亚中心、通泰大厦、方正国际大厦、金隅嘉华大厦（历史嘉华大厦）、京泰大厦、南新仓商务大厦、四惠大厦、大恒科技大厦、学院国际大厦、银网中心、国华投资大厦、中关村新兴产业联盟大厦、北京世茂大厦 and 国际财经中心.

## Production result — 2026-09-15

Historical source remains:

- 6,543 rows
- 6,543 unique `source_uid`

Canonical historical read result after v18:

- exact: 3,852 rows
- project: 1,058 rows
- safely usable exact + project: 4,910 / 6,543 = 75.0%
- unmapped: 1,633 rows
- source_uid-level exact overrides: 8 rows

Governance ledger:

- `AUTO_VERIFIED`: 374 names / 1,632 source rows
- `AUTO_VERIFIED_PROJECT`: 127 names / 1,058 source rows
- `INVENTORY_GAP`: 46 names / 303 source rows
- `NEEDS_REVIEW`: 1,036 names / 1,338 name-level source rows

v18 propagated only previously verified exact/project seeds through non-semantic formatting or suffix variants. It resolved 14 historical names covering 18 rows: 5 exact aliases covering 7 rows and 9 project aliases covering 11 rows.

One intended v18 candidate, `金地中心 A`, was deliberately not resolved by the migration. Its configured seed `金地中心A` exists only in `lease_building_project_map`, while the exact-propagation branch reads only `lease_building_name_map`; therefore the row stayed `NEEDS_REVIEW` instead of being upgraded across precision levels. This is a safe no-op, not a partial or incorrect write.

The alias-review row total is not the same as the read-layer unmapped total because one globally unresolved alias can have selected source_uids safely resolved by `lease_building_record_map`. The read layer is authoritative for row-level coverage.

Current unified read count is 6,872 = 329 live + 6,543 history, with 6,872 unique `read_id` values.

## Examples of verified identity resolution

Exact examples:

- 君康人寿大厦 -> 富泽人寿大厦
- 金泰大厦 -> 能+中心金泰
- 东亿国际 / 东亿国际传媒产业园 -> 东亿文化科技产业园
- 中航资本大厦 -> 中航产融大厦
- 万豪中心 / 万豪 / 万豪写字楼 -> 荷华明城大厦
- 用友软件园 -> 用友产业园
- 中关村一号 -> 中关村壹号
- 海航实业大厦 / 海航实业 -> 横琴人寿大厦
- 盘古大厦 -> 钰珵大厦
- PVG / 侨福 -> 北京侨福芳草地

Project-scope examples include 东方广场W1/W2/E3、鼎好、凯德汇新、诺金、融科资讯、骏豪中央广场、环贸中心/环球贸易中心、光华国际中心/远洋光华国际、远洋光华国际中心、月坛中心/金融街月坛中心/金融街月坛、中航技广场系列 and 兆泰国际中心系列.

## Manual verification contract

A human-approved exact mapping should:

1. update the review row to `MANUAL_VERIFIED` with evidence and resolution time;
2. insert the alias into `lease_building_name_map` with `verification_status='MANUAL_VERIFIED'`;
3. append the confirmed semantic alias to `buildings.former_names` when useful for user-facing identity/search;
4. never rewrite historical `new_building` source text;
5. preserve auditability from historical string/source_uid to the chosen identity.

A human-approved project mapping should use `lease_building_project_map` and must not create a fake exact `building_id`.

A row-specific decision for a reused ambiguous label should use `lease_building_record_map`; it must not create a global alias that changes unrelated rows.

## Security boundary

- `lease_transactions_history` service role: SELECT + INSERT only.
- exact/project mapping tables: runtime service role SELECT only.
- review and record-override governance tables: service role SELECT + INSERT + UPDATE only; no DELETE/TRUNCATE.
- `anon` / `authenticated` receive no direct grants on historical source/governance/read tables.
- governance tables are RLS-enabled with no client policy by design.
- `lease_transactions_read_v1` uses `security_invoker=true`.
- the historical identity layer introduces no `SECURITY DEFINER` function.

Do not broaden matching rules merely to improve a percentage. A missing relationship is preferable to a wrong building identity because Map building profiles, tenant histories, company migration paths, expiry analysis and future AI queries inherit this relation.
