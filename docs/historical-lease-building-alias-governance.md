# Historical Lease Building Identity Governance

## Purpose

Historical lease rows preserve source-era building names as text, while the current building inventory uses `public.buildings.id` as the canonical identity. This document defines the controlled, auditable bridge between those representations.

The historical transaction source table is not rewritten during identity resolution.

## Authoritative objects

- `public.lease_transactions_history`: governed historical source records; identity resolution must not rewrite these rows.
- `public.buildings`: canonical building/project entity master. `tracking_scope='tracked'` identifies operational inventory; `tracking_scope='reference_only'` identifies canonical entities retained only for historical identity resolution.
- `public.operational_buildings_v1`: authenticated operational read surface containing active tracked entities only; reference-only entities are excluded by construction.
- `public.lease_building_name_map`: exact historical alias -> one current `building_id`.
- `public.lease_building_project_map`: verified project/complex alias -> one or more current building members where project identity is certain but tower attribution is not.
- `public.lease_building_record_map`: source_uid-level override used only for true same-name/multi-building exceptions that can be resolved from row context without polluting the global alias map.
- `public.lease_building_alias_review`: governance ledger for historical aliases, candidates, evidence, inventory gaps and review state.
- `public.buildings.former_names`: user-visible historical/legacy aliases confirmed for a current entity. In this system it is an identity/search field, not a legal/corporate-name-history field.
- `public.lease_transactions_read_v1`: service-only canonical read model. For history it resolves identity in precedence order: record-level override -> exact/reference alias -> project membership -> unmapped.

## Resolution states and read precision

Alias review states:

- `AUTO_VERIFIED`: deterministic exact mapping to one current building.
- `MANUAL_VERIFIED`: exact mapping explicitly confirmed through human review.
- `AUTO_VERIFIED_PROJECT`: deterministic project/complex association where exact tower attribution is not justified.
- `INVENTORY_GAP`: transitional governance state used when an external/current building identity is confirmed but no canonical carrier exists yet. v19 materialized the verified 2026-09-15 gap population into reference-only building entities, so no rows remain in this state after v19.
- `NEEDS_REVIEW`: evidence is insufficient or genuinely ambiguous.

The read layer exposes `building_match_scope`:

- `exact`: one operational tracked building is safely known, including source_uid-level overrides.
- `project`: the operational project/complex is known, but one exact current tower is not asserted.
- `reference`: one canonical physical entity is safely known, but it is reference-only and therefore excluded from the current map, quarterly collection, recommendations and brochure operations.
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

## Inventory gaps and reference-only entities

`INVENTORY_GAP` means the identity problem is understood but the canonical building master does not yet contain a safe entity. Such rows are never forced onto the nearest tracked building.

The review ledger stores, when known:

- `external_canonical_name`
- `external_address`
- `external_lat`
- `external_lng`
- `evidence_snapshot`

v19 converted the verified gap pool into canonical reference-only entities instead of expanding the operational map inventory:

- 46 verified historical aliases
- 38 canonical reference-only entities
- 303 historical lease rows
- `project_type='reference'`
- `tracking_scope='reference_only'`
- `is_active=false`
- zero `building_assignments`

Reference-only entities can carry a stable `building_id`, coordinates, district and aliases without becoming map markers or quarterly collection obligations. Promotion into the operational inventory is a separate onboarding action and must explicitly change the tracking scope after the normal building data is completed.

## Production result — 2026-09-21

Historical source remains:

- 6,543 rows
- 6,543 unique `source_uid`

Canonical historical read result after v23:

- exact operational building: 3,978 rows
- operational project scope: 1,071 rows
- reference-only canonical entity: 303 rows
- total safely resolved identity: 5,352 / 6,543 = 81.80%
- operational exact + project coverage: 5,049 / 6,543 = 77.17%
- unmapped: 1,191 rows
- source_uid-level exact overrides: 8 rows

Building master:

- tracked operational entities: 642
- reference-only entities: 38
- total canonical building entities: 680
- reference-only quarterly assignments: 0

Governance ledger:

- `AUTO_VERIFIED`: 522 names / 2,061 source rows
- `AUTO_VERIFIED_PROJECT`: 137 names / 1,071 source rows
- `INVENTORY_GAP`: 0 names after v19 materialization
- `NEEDS_REVIEW`: 924 names / 1,199 name-level source rows

v19 materialized the verified inventory-gap pool as 38 reference-only canonical entities and moved exactly 303 historical rows into `reference` scope.

v20/v21 resolved the single-candidate pool using deterministic normalization, internal context and external evidence. v22 then propagated previously verified identity families into 50 additional aliases / 60 exact rows without creating new fuzzy identities.

v23 addressed the next highest-ROI parent-project bucket. Six parent labels covering 9 historical rows were promoted from `unmapped` to `project` scope:

- `远洋乐堤港` -> current tracked 一座 + 二座 project members;
- `学清嘉创` -> A栋 + C栋;
- `首钢园` -> five tracked North District subprojects;
- `远洋国际中心一期` -> current tracked phase-one carrier, without claiming exact tower precision;
- `融科中心` -> 融科资讯中心 A/B/C;
- `融科咨讯中心` -> 融科资讯中心 A/B/C.

For `远洋乐堤港`, the project relation intentionally excludes one duplicate empty `远洋乐堤港一座` building row that has the same coordinates/name but no metrics, assignments, brochure data or leasable area. The active one-seat entity with business data plus 二座 are retained as the meaningful current project members.

The originally proposed seventh parent label, `中海大厦`, was deliberately **not** globally mapped. Its five historical rows span CBD, unknown and Other contexts, while the current name-based tower candidates are the Shijingshan `中海大厦B座` and `中海大厦C、D座`. A global alias would incorrectly attach CBD-era records to Shijingshan. The review ledger now records this as a deferred reused-parent-label case pending row-level evidence or a row-level project mapping mechanism.

The read layer remains authoritative for row-level coverage.

Current unified read count remains 6,876 = 333 live + 6,543 history, with 6,876 unique `read_id` values.

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
- 太平金融中心 / 京汇大厦（太平金融中心） -> 京汇大厦
- 人寿大厦 -> 中国人寿大厦
- 东升 / 东升科技园一期 / 东升科技园B座 / 东升科技园C-8 -> 东升科技园
- 嘉里 / 嘉里中心北塔30F / 嘉里中心北塔8f -> 嘉里中心
- 汉威国际广场三期 / 四期 / 西区2号 -> 汉威国际
- 锐创国际 -> 锐创国际中心
- WFC环球金融中心 -> 环球金融中心
- UBP B18 / UBP中央大厦 / UBP恒通商务园中央大厦 -> 恒通国际商务园
- 国贸1期 -> 国贸写字楼1座
- 国贸二期 -> 国贸写字楼2座
- 卓著大厦 / 卓著金融中心 -> 卓著中心
- 嘉里南楼 -> 嘉里中心
- 汇京双子座东塔 / 汇京双子座西塔 / 双子座东塔 / 双子座西塔 -> 汇京双子座大厦

Project-scope examples include 东方广场W1/W2/E3、鼎好、凯德汇新、诺金、融科资讯、骏豪中央广场、环贸中心/环球贸易中心、光华国际中心/远洋光华国际、远洋光华国际中心、月坛中心/金融街月坛中心/金融街月坛、中航技广场系列、兆泰国际中心系列，以及 v21 的复地金融中心、月坛金融中心、清华同方、电子城研发中心和 v23 的远洋乐堤港、学清嘉创、首钢园、远洋国际中心一期、融科中心、融科咨讯中心。

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
