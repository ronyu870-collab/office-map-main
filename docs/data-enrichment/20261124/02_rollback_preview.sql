-- Colliers AI enrichment batch-specific rollback / NO PRODUCTION REVERT BY DEFAULT.
-- Batch: ai_brochure_submarket_20261124_100_v1
-- This script EXECUTES the 100 inverse DML operations inside a transaction,
-- checks per-field protection, then ROLLS BACK. It does not undo the live batch.
-- To actually revert later, separately authorize and deliberately replace the
-- final ROLLBACK with COMMIT after verifying these guards against current state.
-- Keeps the original audit trail; any eventual committed revert adds 100
-- compensating audit events and marks this batch's provenance as not current.

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';

DO $ai_rollback$
DECLARE
  v_batch CONSTANT text := 'ai_brochure_submarket_20261124_100_v1';
  v_original_audits integer;
  v_valid integer;
  v_updates integer;
  v_provenance_marked integer;
  v_compensating_audits integer;
BEGIN
  SELECT count(*) INTO v_original_audits
  FROM public.audit_logs a
  WHERE a.action_type = 'AI_FIELD_FILL'
    AND a.details->>'batch_id' = v_batch;

  IF v_original_audits <> 100 THEN
    RAISE EXCEPTION 'Rollback blocked: original audit count %, expected 100',
      v_original_audits;
  END IF;

  -- Check EACH field's exact write, original NULL, latest target-row timestamp,
  -- source lineage, absence of subsequent target-specific audits and field
  -- provenance. Any manual later edit (including another brochure field edit)
  -- updates the target row timestamp and blocks the entire batch rollback.
  SELECT count(*) INTO v_valid
    FROM public.audit_logs a
    JOIN public.building_brochure_data d ON d.id::text = a.target_id
    JOIN public.building_data_field_provenance p
      ON p.id::text = a.details->>'provenance_id'
     AND p.brochure_data_id = d.id
     AND p.building_id = d.building_id
   WHERE a.action_type = 'AI_FIELD_FILL'
     AND a.details->>'batch_id' = v_batch
     AND a.target_table = 'building_brochure_data'
     AND a.details->>'field_name' = 'submarket'
     AND a.old_values ? 'submarket'
     AND a.old_values->'submarket' = 'null'::jsonb
     AND a.new_values->>'submarket' = d.submarket
     AND p.target_table = 'building_brochure_data'
     AND p.field_name = 'submarket'
     AND p.field_value = to_jsonb(d.submarket)
     AND p.source_type = 'other'
     AND p.verification_status = 'legacy_backfill'
     AND p.is_current = TRUE
     AND d.updated_at = (a.details->>'target_updated_at_after')::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM public.audit_logs later
       WHERE later.id > a.id
         AND later.target_table = 'building_brochure_data'
         AND later.target_id = a.target_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.building_data_field_provenance later_p
       WHERE later_p.building_id = p.building_id
         AND later_p.target_table = 'building_brochure_data'
         AND later_p.field_name = 'submarket'
         AND later_p.id <> p.id
         AND later_p.created_at >= p.created_at
     );

  IF v_valid <> 100 THEN
    RAISE EXCEPTION 'Rollback blocked: only % / 100 original fields passed all safety checks; investigate subsequent edits', v_valid;
  END IF;

  UPDATE public.building_brochure_data d
     SET submarket = NULL
    FROM public.audit_logs a,
         public.building_data_field_provenance p
   WHERE a.action_type = 'AI_FIELD_FILL'
     AND a.details->>'batch_id' = v_batch
     AND a.target_table = 'building_brochure_data'
     AND a.target_id = d.id::text
     AND p.id::text = a.details->>'provenance_id'
     AND p.brochure_data_id = d.id
     AND p.is_current = TRUE
     AND d.submarket = a.new_values->>'submarket'
     AND d.updated_at = (a.details->>'target_updated_at_after')::timestamptz;

  GET DIAGNOSTICS v_updates = ROW_COUNT;
  IF v_updates <> 100 THEN
    RAISE EXCEPTION 'Rollback aborted: only % target rows updated', v_updates;
  END IF;

  UPDATE public.building_data_field_provenance p
     SET is_current = FALSE
    FROM public.audit_logs a
   WHERE a.action_type = 'AI_FIELD_FILL'
     AND a.details->>'batch_id' = v_batch
     AND p.id::text = a.details->>'provenance_id'
     AND p.target_table = 'building_brochure_data'
     AND p.field_name = 'submarket'
     AND p.is_current = TRUE;
  GET DIAGNOSTICS v_provenance_marked = ROW_COUNT;
  IF v_provenance_marked <> 100 THEN
    RAISE EXCEPTION 'Rollback aborted: % provenance records marked, expected 100', v_provenance_marked;
  END IF;

  INSERT INTO public.audit_logs(
    user_id, action_type, details, request_source, module,
    target_table, target_id, target_name, old_values, new_values,
    event_id, actor_kind, actor_name
  )
  SELECT 'chatgpt', 'AI_FIELD_ROLLBACK',
         jsonb_build_object(
           'batch_id', v_batch || ':rollback',
           'reverts_batch_id', v_batch,
           'original_audit_id', a.id,
           'original_provenance_id', a.details->>'provenance_id',
           'building_id', a.details->>'building_id',
           'field_name', 'submarket',
           'source_was_legacy_backfill', TRUE,
           'original_field_was_null', TRUE,
           'fully_safety_checked', TRUE
         ),
         'chatgpt_mcp', 'building_data_ai_enrichment',
         'building_brochure_data', a.target_id, a.target_name,
         a.new_values, a.old_values,
         v_batch || ':rollback:' || (a.details->>'building_id'),
         'tool', 'ChatGPT（工具执行）'
    FROM public.audit_logs a
   WHERE a.action_type = 'AI_FIELD_FILL'
     AND a.details->>'batch_id' = v_batch;
  GET DIAGNOSTICS v_compensating_audits = ROW_COUNT;
  IF v_compensating_audits <> 100 THEN
    RAISE EXCEPTION 'Rollback aborted: % compensating audits generated', v_compensating_audits;
  END IF;
END
$ai_rollback$;

-- This is INTENTIONALLY a dry run. No production change survives.
ROLLBACK;

-- Persisted readback MUST still show all 100 original writes after preview.
SELECT count(*) AS original_audit_count,
       count(*) FILTER (
         WHERE d.submarket = a.new_values->>'submarket'
           AND p.field_value = to_jsonb(d.submarket)
           AND p.is_current
       ) AS values_still_live,
       count(*) FILTER (WHERE d.submarket IS NULL) AS erroneously_reverted
  FROM public.audit_logs a
  JOIN public.building_brochure_data d ON d.id::text = a.target_id
  JOIN public.building_data_field_provenance p
    ON p.id::text = a.details->>'provenance_id'
 WHERE a.action_type = 'AI_FIELD_FILL'
   AND a.details->>'batch_id' = 'ai_brochure_submarket_20261124_100_v1';
