# 2026-11-13 AI Building Field Backfill — v3 Production Receipt

> **Status: PRODUCTION COMMITTED, FULLY RECONCILED, ROLLBACK DRY-RUN PASSED.**
> No frontend deployment, schema/RLS/permission changes, or merge into `main`.

## 1. Immutable identifiers

- GitHub repository: `ronyu870-collab/office-map-main`
- Working branch: `codex/ai-building-field-backfill-20261113-v3`
- Supabase project: `qhgxougfzzmgqjzzwudf` (production)
- Audit batch: `ai_building_field_backfill_20261113_v3`
- AI actor: `user_id=codex`, `actor_kind=tool`, `request_source=codex_mcp`, `actor_name=Codex（工具执行）`
- Date: 2026-11-13 (Beijing local / UTC+08)
- Previous batches `ai_building_field_backfill_20261113_100_v1` and `_v2` each retained their original 100 audit entries; this batch is separate.

## 2. Actual committed outcome (NOT a proposed list)

| Metric | Production result |
|---|---:|
| Target distinct originally-SQL-NULL fields | **100** |
| Actual distinct fields committed | **100** |
| Distinct active stock buildings | **62** |
| Fields in `building_brochure_data` | **92** |
| Fields in `buildings` | **8** |
| Internal archived project-material facts | **50** |
| Official 2026 Q3 survey + curated main PM agreement, exact | **9** |
| Official 2026 Q3 PM agreement after removing only the main's parenthetical note | **4** |
| Existing curated main LEED -> brochure LEED | **30** |
| Existing brochure LEED -> main LEED | **7** |
| Newly searched/verified external internet facts in this batch | **0** |
| New per-field provenance rows | **100** |
| New `AI_FIELD_FILL` audit rows | **100** |
| Additional permanent rollback audits | **0** |

The 50 project-material values came from 16 uniquely linked, already archived and confirmed `building_sales_materials` records; the SQL checks `association_status='confirmed'`, `status='ready'`, building identity, page-specific fact references and approved value. The 13 PM values were selected directly in Supabase from **2026Q3** formal records; *no raw Broker submission content was committed to GitHub*. Thirty-seven existing LEED text values were copied between fields that are independently consumed by relevant business modules. They were counted only where the receiving field was genuinely SQL NULL.

## 3. Field family counts

| Field | Committed values |
|---|---:|
| `leed_certification` | 37 |
| `property_management` | 13 |
| `gfa_total` | 9 |
| `floor_height` | 6 |
| `floors_above`, `floors_below`, `parking_total` | 4 each |
| `elevator_passenger` | 3 |
| `building_height`, `clear_height`, `elevator_freight`, `gfa_office`, `hvac_fresh_air_capacity`, `parking_underground`, `standard_floor_area` | 2 each |
| `building_floors`, `gfa_retail`, `hvac_cooling_water_24h`, `hvac_system`, `leasable_area`, `parking_above` | 1 each |

## 4. Provenance, evidence and conservative verification

Every one of the 100 production edits carries a new `building_data_field_provenance` row with building/tower foreign keys, `target_table`, `field_name`, typed `field_value`, `source_type`, tier, source name, archived material file/page or internal original table+record ID, original document date if actually present, lookup/recording timestamps, scope, unit, confidence, verification status, AI batch, and evidence group.

The corresponding `audit_logs` entry contains original `{field: null}`, exact new JSON value, target ID/name, source record ID, AI identity, `reversible=true` and evidence group ID. **All 100 new provenance records use `verification_status=legacy_backfill`**. No internal historical data was falsely labeled `cross_verified`, even when an original upstream record had prior external verification. A missing original document publication date remains NULL; it was not inferred from a directory name.

The following scope/precision cautions were explicitly recorded, not glossed over:

- `泰康金融大厦.gfa_total=73000`, `泰康人寿大厦.leasable_area=19000`, and `恒通国际商务园.gfa_total=310000` are *historical approximate* areas; their internal evidence notes preserve that qualifier.
- `金地 启汇中心.gfa_total=194400` describes the **whole A–F project, including self-held components**, not the A/B subset.
- `嘉铭奥森产业园` passenger/freight elevator totals aggregate the explicitly identified two towers (3+3 and 1+1) into one whole-project record; the original floor-level and tower distinctions remain in the source.
- `中国电子大厦.floors_above=17` uses reported **physical floors**, not the 19th-floor marketing/elevator label.
- `北京佳隆国际大厦` parking figures remain `parking_total=278`, `parking_above=22`, `parking_underground=256`, with total = 22 + 256.
- A documented `total_area` in formal quarterly submissions was **not** copied into `buildings.leasable_area`, because total GFA and rentable area are different metrics.
- Stock projects only; future-supply concept documents, unclear tower-specific floor-area ranges, pre-certifications and source conflicts were not treated as confirmed completed facts.

## 5. Dry-run, production commit and readback

1. The guarded `production-fill.sql` was tested as a full transaction with the final `COMMIT` replaced by `ROLLBACK`. It applied the 100 hypothetical updates with sources and audits, then left **zero** persisted v3 source/audit records.
2. The *same corrected script* then executed with `COMMIT`, and Supabase returned the exact source-kind breakdown `50 + 9 + 4 + 7 + 30 = 100`.
3. Independent production readback through `verification.sql` returned:

```text
ai_field_audits              100
buildings_covered             62
unique_target_fields         100
provenance_rows              100
source_cardinality_errors      0
business_mismatches            0
provenance_mismatches          0
nonempty_originals             0
inactive_provenance            0
identity_errors                0
actor_errors                   0
unclaimed_verification_levels  0
traceability_errors            0
missing_archived_filename      0
```

4. A dedicated `safe-rollback.sql` first checks **all 100** fields for later human edits, conflicting provenance, original NULL status and unchanged new values. It also guards `building_brochure_data.updated_at`. Only after **all** checks pass does it simulate resetting fields to SQL NULL, retiring their current provenance and appending `AI_FIELD_ROLLBACK` audits.
5. The first rollback *implementation test* caught its own row-update timestamp when checking later fields on the same building. This was not a real user edit: the entire test was rolled back, and an independent readback confirmed that row's timestamp and all edited fields remained unchanged. The script was fixed to separate **preflight-all** and **apply-all** phases. The subsequent full rollback rehearsal passed and was rolled back: **100 original fills still persisted, 100 current provenance rows persisted, zero rollback audits persisted**.

**Rollback readiness:** The tested script is reversible *provided no relevant subsequent edits intervene*. It deliberately aborts if a field, its evidence, a later audit, or a brochure row timestamp conflicts. `buildings` does not expose `updated_at`; for those 8 fields, the script can detect differing values and logged changes, but cannot prove the absence of unlogged same-value manual rewrites. That is a schema-level limitation, not a claim of perfect future undo.

## 6. Files and branch

- `field-specs.json`: 50 reviewed, non-Broker static physical-fact specifications with archive record IDs and unit/scope.
- `production-fill.sql`: guarded 100-value transaction, source references extracted in-DB, and AI audits; **already committed to production once**. Its guards prevent a second run from overwriting any field.
- `verification.sql`: repeatable, read-only reconciliation queries.
- `safe-rollback.sql`: separately authorized future recovery script; **dry run ONLY** was executed.
- `README.md`: this status receipt.

All files live only on `codex/ai-building-field-backfill-20261113-v3` and are not merged into `main`. No frontend or service was deployed.

## 7. Follow-up human verification (do not silently upgrade statuses)

1. **37 LEED cross-table fields:** historic Gold/Platinum/Silver values and some generic `LEED` strings should be checked against official USGBC/GBI certification documentation, certification scheme, building/tower and current standing. The batch does **not** claim new independent verification.
2. **50 archived engineering fields:** some source presentations date to earlier years; reconfirm changed equipment, management and floor arrangements against current developer/owner documentation. Preserve the approximate-area caveats above.
3. **13 PM fields:** four Q3 values had a parenthetical affiliation/owner note removed from the curated master company name; have a project owner/property manager confirm the current registered operating entity if legal-name exactness is essential.
4. **Existing out-of-scope discrepancies:** do not automatically overwrite pre-existing `gfa_office`, building marketing floor numbers, planned/actual completion dates, LEED pre-certifications, or differing multi-tower project aggregate areas. They require a separate field-specific investigation.

No external URL was invented and no external source was misclassified as newly searched and cross-verified in this run.
