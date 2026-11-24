-- Colliers Beijing | AI-assisted internal-field enrichment | 2026-11-24
-- Batch: ai_brochure_submarket_20261124_100_v1
-- Target: exactly 100 originally-NULL building_brochure_data.submarket fields.
-- Source: public.buildings.submarket, a current internal catalog classification.
-- This is NOT public-web verification and must NOT be called cross_verified.
-- Execution is authorized only for the specifically named production project.
-- First execute with the final COMMIT replaced by ROLLBACK for a full DML dry run.
-- No schema, RLS, business logic, or frontend changes.

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $ai_fill$
DECLARE
  v_batch CONSTANT text := 'ai_brochure_submarket_20261124_100_v1';
  v_written integer := 0;
  v_provenance integer := 0;
  v_audit integer := 0;
BEGIN
  -- No replay or overwrite of this batch.
  IF EXISTS (SELECT 1 FROM public.audit_logs
             WHERE action_type = 'AI_FIELD_FILL'
               AND details->>'batch_id' = v_batch)
     OR EXISTS (SELECT 1 FROM public.building_data_field_provenance
                WHERE evidence_note LIKE '%batch=' || v_batch || ';%')
  THEN
    RAISE EXCEPTION 'Batch % already exists; refusing replay', v_batch;
  END IF;

  WITH eligible AS MATERIALIZED (
    SELECT b.id AS building_id,
           b.name AS building_name,
           b.submarket AS source_value,
           d.id AS brochure_data_id,
           d.name_cn AS brochure_name,
           d.updated_at AS target_updated_at_before,
           row_number() OVER (PARTITION BY b.submarket ORDER BY b.id) AS region_rank
    FROM public.buildings b
    INNER JOIN public.building_brochure_data d ON d.building_id = b.id
    WHERE b.is_active = TRUE
      AND b.tracking_scope = 'tracked'
      AND b.merged_into_id IS NULL
      AND b.project_type = 'stock'
      AND b.is_entered_market = TRUE
      AND btrim(b.name) = btrim(coalesce(d.name_cn, ''))
      AND d.submarket IS NULL
      AND nullif(btrim(b.submarket), '') IS NOT NULL
      AND btrim(b.submarket) <> '其他'
      AND NOT EXISTS (
        SELECT 1 FROM public.building_data_field_provenance existing
        WHERE existing.building_id = b.id
          AND existing.target_table = 'building_brochure_data'
          AND existing.field_name = 'submarket'
          AND existing.is_current = TRUE
      )
  ),
  selected AS MATERIALIZED (
    SELECT * FROM eligible
    ORDER BY region_rank ASC, source_value ASC, building_id ASC
    LIMIT 100
  ),
  filled AS (
    UPDATE public.building_brochure_data AS d
       SET submarket = s.source_value
      FROM selected s
     WHERE d.id = s.brochure_data_id
       AND d.building_id = s.building_id
       AND d.submarket IS NULL
       AND EXISTS (
         SELECT 1 FROM public.buildings source_b
         WHERE source_b.id = s.building_id
           AND source_b.name = s.building_name
           AND source_b.submarket = s.source_value
           AND source_b.is_active = TRUE
           AND source_b.tracking_scope = 'tracked'
           AND source_b.merged_into_id IS NULL
       )
    RETURNING d.id, d.building_id, d.submarket, d.updated_at
  ),
  provenance_inserted AS (
    INSERT INTO public.building_data_field_provenance (
      id, building_id, brochure_data_id, target_table,
      field_name, field_value, source_type, source_tier, source_name,
      source_url, source_file_name, source_published_date,
      source_retrieved_at, value_recorded_at, verification_status,
      evidence_group_id, evidence_note, is_current
    )
    SELECT gen_random_uuid(), f.building_id, f.id, 'building_brochure_data',
           'submarket', to_jsonb(f.submarket), 'other', 'legacy_unknown',
           '高力国际楼宇主表既有子市场分类（楼书管理同步）',
           NULL, NULL, NULL, statement_timestamp(), statement_timestamp(),
           'legacy_backfill', NULL,
           'AI_ASSISTED_INTERNAL_BACKFILL; batch=' || v_batch ||
           '; source_kind=canonical_master_submarket_to_brochure' ||
           '; source_table=public.buildings' ||
           '; source_record_id=' || s.building_id::text ||
           '; source_field=submarket; target_record_id=' || s.brochure_data_id::text ||
           '; building_name=' || s.building_name ||
           '; tower_scope=exact_existing_building_id_without_invented_tower' ||
           '; old_value=NULL; unit=categorical_submarket' ||
           '; source_period=current_catalog_not_quarterly' ||
           '; verification=internal_exact_identity_sync_only' ||
           '; independently_cross_verified=false',
           TRUE
      FROM filled f
      JOIN selected s ON s.brochure_data_id = f.id
    RETURNING id, building_id, brochure_data_id, field_value
  )
  INSERT INTO public.audit_logs (
    user_id, action_type, details, request_source, module,
    target_table, target_id, target_name, old_values, new_values,
    event_id, actor_kind, actor_name
  )
  SELECT 'chatgpt', 'AI_FIELD_FILL',
         jsonb_build_object(
           'batch_id', v_batch,
           'batch_ref', v_batch,
           'ai_assisted', TRUE,
           'ai_generated', FALSE,
           'executor', 'ChatGPT connected Supabase tool',
           'building_id', f.building_id::text,
           'building_name', s.building_name,
           'tower_scope', 'existing building_id; no separate tower inferred',
           'target_table', 'building_brochure_data',
           'target_record_id', f.id::text,
           'field_name', 'submarket',
           'old_is_null', TRUE,
           'old_value', NULL,
           'new_value', f.submarket,
           'unit', '子市场分类（无物理单位）',
           'source_type', 'other',
           'source_kind', 'canonical_master_submarket_to_brochure',
           'source_table', 'buildings',
           'source_record_id', s.building_id::text,
           'source_field', 'submarket',
           'source_name', '高力国际楼宇主表既有子市场分类',
           'source_url', NULL,
           'source_period', '当前既有分类；非租赁季度事实',
           'source_retrieved_at', statement_timestamp(),
           'source_published_date', NULL,
           'confidence', 'internal_current_catalog; no external validation',
           'verification_status', 'legacy_backfill',
           'source_tier', 'legacy_unknown',
           'provenance_id', p.id::text,
           'reversible', TRUE,
           'target_updated_at_before', s.target_updated_at_before,
           'target_updated_at_after', f.updated_at
         ),
         'chatgpt_mcp', 'building_data_ai_enrichment',
         'building_brochure_data', f.id::text, s.building_name,
         jsonb_build_object('submarket', NULL),
         jsonb_build_object('submarket', f.submarket),
         v_batch || ':' || f.building_id::text || ':submarket',
         'tool', 'ChatGPT（工具执行）'
    FROM filled f
    JOIN provenance_inserted p ON p.brochure_data_id = f.id
    JOIN selected s ON s.brochure_data_id = f.id;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  SELECT count(*) INTO v_provenance
    FROM public.building_data_field_provenance
   WHERE evidence_note LIKE '%batch=' || v_batch || ';%'
     AND is_current = TRUE;
  SELECT count(*) INTO v_audit
    FROM public.audit_logs
   WHERE action_type = 'AI_FIELD_FILL'
     AND details->>'batch_id' = v_batch;

  IF v_written <> 100 OR v_provenance <> 100 OR v_audit <> 100 THEN
    RAISE EXCEPTION 'Atomic batch count mismatch: writes=%, provenance=%, audit=%',
      v_written, v_provenance, v_audit;
  END IF;
END
$ai_fill$;

COMMIT;

-- Independent persisted-state readback after COMMIT.
SELECT count(*) AS audit_count,
       count(DISTINCT a.details->>'building_id') AS distinct_buildings,
       count(*) FILTER (
         WHERE d.submarket = a.new_values->>'submarket'
           AND p.field_value = to_jsonb(d.submarket)
           AND p.is_current = TRUE
           AND p.target_table = 'building_brochure_data'
           AND p.field_name = 'submarket'
           AND p.verification_status = 'legacy_backfill'
           AND p.source_type = 'other'
           AND b.submarket = d.submarket
           AND b.id = d.building_id
       ) AS values_provenance_and_source_consistent,
       count(DISTINCT p.id) AS provenance_count
FROM public.audit_logs a
LEFT JOIN public.building_brochure_data d
  ON d.id::text = a.target_id
LEFT JOIN public.buildings b ON b.id = d.building_id
LEFT JOIN public.building_data_field_provenance p
  ON p.id::text = a.details->>'provenance_id'
WHERE a.action_type = 'AI_FIELD_FILL'
  AND a.details->>'batch_id' = 'ai_brochure_submarket_20261124_100_v1';
