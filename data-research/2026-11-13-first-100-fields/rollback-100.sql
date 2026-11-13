-- Single-batch, conflict-guarded rollback. Do not use as a general-purpose undo.
-- Requires the current value to match the AI-written value for EVERY field;
-- otherwise the entire rollback aborts to avoid overwriting subsequent human work.
-- Keeps provenance history as is_current=false and inserts reversal audit events.
DO $ai_rollback$
DECLARE
  r RECORD;
  prior jsonb;
  expected jsonb;
  current_value jsonb;
  target_uuid uuid;
  updated uuid;
  updated_provenance uuid;
  provenance_group uuid;
  field text;
  n integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(801192,20261113);
  IF EXISTS (SELECT 1 FROM public.audit_logs
      WHERE action_type='AI_FIELD_ROLLBACK'
        AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_100_v1') THEN
    RAISE EXCEPTION 'Rollback already executed';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE action_type='AI_FIELD_FILL'
        AND details->>'batch_ref'='ai_building_field_backfill_20261113_100_v1') <> 100 THEN
    RAISE EXCEPTION 'Missing AI field audit rows; rollback aborted';
  END IF;
  SELECT (details->>'evidence_group_id')::uuid INTO provenance_group
  FROM public.audit_logs
  WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261113_100_v1'
  ORDER BY id LIMIT 1;
  IF provenance_group IS NULL OR
      (SELECT count(*) FROM public.building_data_field_provenance
         WHERE evidence_group_id=provenance_group AND is_current)<>100 THEN
    RAISE EXCEPTION 'Missing active provenance rows; rollback aborted';
  END IF;
  FOR r IN
     SELECT * FROM public.audit_logs
     WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261113_100_v1'
     ORDER BY id DESC
  LOOP
    field := r.details->>'field_name';
    IF r.target_table NOT IN ('buildings','building_brochure_data')
       OR field IS NULL OR r.target_id IS NULL THEN
      RAISE EXCEPTION 'Unrecognized audit record %',r.id;
    END IF;
    target_uuid := r.target_id::uuid;
    prior := r.old_values->field;
    expected := r.new_values->field;
    EXECUTE format('SELECT to_jsonb(t)->%L FROM public.%I t WHERE t.id=$1 FOR UPDATE',
             field,r.target_table) INTO current_value USING target_uuid;
    IF current_value IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'Field changed after import: audit %, field %; no rollback committed',
                r.id,field;
    END IF;
    updated:=NULL;
    EXECUTE format('UPDATE public.%I t SET %I=(jsonb_populate_record(NULL::public.%I,jsonb_build_object(%L,$1))).%I WHERE t.id=$2 AND to_jsonb(t)->%L=$3 RETURNING t.id',
              r.target_table,field,r.target_table,field,field,field)
        INTO updated USING prior,target_uuid,expected;
    IF updated IS NULL THEN
      RAISE EXCEPTION 'Rollback concurrency conflict at %',r.id;
    END IF;
    updated_provenance:=NULL;
    UPDATE public.building_data_field_provenance p SET is_current=false
      WHERE p.evidence_group_id=provenance_group
        AND p.building_id=(r.details->>'building_id')::uuid
        AND p.target_table=r.target_table AND p.field_name=field
        AND p.field_value=expected AND p.is_current
      RETURNING p.id INTO updated_provenance;
    IF updated_provenance IS NULL THEN
      RAISE EXCEPTION 'Provenance rollback mismatch at %',r.id;
    END IF;
    INSERT INTO public.audit_logs
      (user_id,action_type,module,target_table,target_id,target_name,
       old_values,new_values,details,request_source,event_id,occurred_at)
    VALUES ('codex','AI_FIELD_ROLLBACK','building_data_ai_enrichment',
       r.target_table,r.target_id,r.target_name,
       r.new_values,r.old_values,
       jsonb_build_object('rollback_batch_ref','ai_building_field_backfill_20261113_100_v1','rolled_back_audit_id',r.id,
        'field_name',field,'building_id',r.details->>'building_id',
        'original_batch_ref',r.details->>'batch_ref','ai_generated',true),
       'codex_mcp','ai_building_field_backfill_20261113_100_v1:'||r.details->>'candidate_ref'||':rollback',now());
    n:=n+1;
  END LOOP;
  IF n<>100 OR
     (SELECT count(*) FROM public.audit_logs
        WHERE action_type='AI_FIELD_ROLLBACK'
        AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_100_v1')<>100 THEN
     RAISE EXCEPTION 'Rollback row count mismatch: %',n;
  END IF;
END $ai_rollback$;
-- Newly inserted brochure parent rows remain as empty shells to preserve
-- historical provenance FK references; do not delete them automatically.
