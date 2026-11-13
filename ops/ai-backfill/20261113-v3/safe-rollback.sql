-- Colliers AI Building Field Fill v3 / GUARDED MANUAL ROLLBACK
-- Batch: ai_building_field_backfill_20261113_v3
-- IMPORTANT: DO NOT EXECUTE WITHOUT a separate user instruction. This file is a recovery instrument.
-- DRY RUN only: replace the final COMMIT with ROLLBACK, execute in a single SQL call.
-- Conditions before each reversal:
-- (1) original audit says field was SQL NULL;
-- (2) current field equals precisely the value written by this batch;
-- (3) provenance id/group + value still agree and are current;
-- (4) no later non-batch audit on that field or human audit on the target row;
-- (5) for brochure rows, updated_at has not changed since this batch.
-- Restores the original SQL NULL, marks provenance as non-current, appends AI_FIELD_ROLLBACK audits;
-- never erases the original audits or provenance.
-- Main buildings has no updated_at: detects audited post-batch edits + current-value mismatch,
-- but cannot mathematically detect unlogged, same-value manual rewrites.

BEGIN;
SET LOCAL lock_timeout='8000ms';
SET LOCAL statement_timeout='90000ms';
SET LOCAL application_name='colliers_ai_field_rollback_v3_dryrun';
LOCK TABLE public.buildings, public.building_brochure_data, public.building_data_field_provenance, public.audit_logs IN SHARE ROW EXCLUSIVE MODE;

DO $ai_rollback$
DECLARE
 r record;
 p public.building_data_field_provenance%ROWTYPE;
 current_value jsonb;
 new_value jsonb;
 row_updated timestamptz;
 max_batch_ts timestamptz;
 count_orig int; n_done int := 0;
BEGIN
 SELECT count(*) INTO count_orig FROM public.audit_logs
 WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261113_v3';
 IF count_orig <> 100 THEN RAISE EXCEPTION 'expected exactly 100 original audits, got %',count_orig; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_logs
   WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_v3_rollback')
 THEN RAISE EXCEPTION 'this batch appears to have already been rolled back'; END IF;

 FOR r IN
 SELECT a.id,a.target_id,a.target_table,a.target_name,a.occurred_at,a.old_values,a.new_values,
   a.details->>'field_name' field_name,
   (a.details->>'evidence_group_id')::uuid evidence_id,
   (a.details->>'building_id')::uuid building_id
 FROM public.audit_logs a
 WHERE a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261113_v3'
 ORDER BY a.id
 LOOP
   IF r.target_table NOT IN ('buildings','building_brochure_data')
   THEN RAISE EXCEPTION 'unexpected target %',r.target_table; END IF;
   IF r.old_values->r.field_name IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'original value was not NULL at audit %',r.id; END IF;
   new_value := r.new_values->r.field_name;
   IF new_value IS NULL OR new_value='null'::jsonb
   THEN RAISE EXCEPTION 'new value missing from audit %',r.id; END IF;
   IF (SELECT count(*) FROM public.building_data_field_provenance x WHERE x.evidence_group_id=r.evidence_id
       AND x.target_table=r.target_table AND x.field_name=r.field_name AND x.building_id=r.building_id AND x.is_current)=0
   THEN RAISE EXCEPTION 'batch provenance lost or not current audit %',r.id; END IF;
   SELECT x.* INTO STRICT p FROM public.building_data_field_provenance x
   WHERE x.evidence_group_id=r.evidence_id AND x.target_table=r.target_table
     AND x.field_name=r.field_name AND x.building_id=r.building_id AND x.is_current;
   IF p.field_value IS DISTINCT FROM new_value
   THEN RAISE EXCEPTION 'provenance value changed at audit %',r.id; END IF;
   IF EXISTS(SELECT 1 FROM public.building_data_field_provenance x WHERE x.building_id=r.building_id
       AND x.target_table=r.target_table AND x.field_name=r.field_name
       AND x.is_current AND x.id<>p.id)
   THEN RAISE EXCEPTION 'a newer/conflicting provenance exists at audit %',r.id; END IF;

   -- Conservative conflict detection: any later human change on the same target row,
   -- or any later non-batch log touching this particular field (including tool/system).
   IF EXISTS (
     SELECT 1 FROM public.audit_logs later
     WHERE later.target_table=r.target_table AND later.target_id=r.target_id
       AND later.id>r.id
       AND later.details->>'batch_ref' IS DISTINCT FROM 'ai_building_field_backfill_20261113_v3'
       AND (
         coalesce(later.actor_kind,'unknown') NOT IN ('tool','system')
         OR coalesce(later.old_values,'{}'::jsonb) ? r.field_name
         OR coalesce(later.new_values,'{}'::jsonb) ? r.field_name
         OR later.details->>'field_name'=r.field_name
       )
   ) THEN RAISE EXCEPTION 'post-batch audit/manual edit observed, target % field %, abort all',r.target_id,r.field_name; END IF;

   IF r.target_table='building_brochure_data' THEN
      SELECT b.updated_at INTO row_updated FROM public.building_brochure_data b WHERE b.id=r.target_id::uuid;
      SELECT max(a.occurred_at) INTO max_batch_ts FROM public.audit_logs a
      WHERE a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261113_v3'
        AND a.target_table=r.target_table AND a.target_id=r.target_id;
      IF row_updated IS NULL OR max_batch_ts IS NULL OR row_updated > max_batch_ts
      THEN RAISE EXCEPTION 'brochure row modified since fill: target %, audit %, updated %',r.target_id,max_batch_ts,row_updated; END IF;
   END IF;

   EXECUTE format('SELECT to_jsonb(%I) FROM public.%I WHERE id=$1',r.field_name,r.target_table)
     INTO current_value USING r.target_id::uuid;
   IF current_value IS DISTINCT FROM new_value
   THEN RAISE EXCEPTION 'field was edited after AI fill at target % field % expected % got %',r.target_id,r.field_name,new_value,current_value; END IF;

   EXECUTE format('UPDATE public.%I SET %I=NULL WHERE id=$1 AND to_jsonb(%I)=$2',r.target_table,r.field_name,r.field_name)
     USING r.target_id::uuid,new_value;
   IF NOT FOUND THEN RAISE EXCEPTION 'rollback guarded update affected 0, audit %',r.id; END IF;
   UPDATE public.building_data_field_provenance SET is_current=false
    WHERE id=p.id AND is_current;
   IF NOT FOUND THEN RAISE EXCEPTION 'provenance concurrent modification at audit %',r.id; END IF;
   INSERT INTO public.audit_logs(
       id,user_id,action_type,details,request_source,module,target_table,target_id,target_name,
       old_values,new_values,event_id,actor_kind
   ) VALUES(
       nextval('public.audit_logs_id_seq'),'codex','AI_FIELD_ROLLBACK',
       jsonb_build_object(
         'rollback_batch_ref','ai_building_field_backfill_20261113_v3_rollback',
         'original_batch_ref','ai_building_field_backfill_20261113_v3',
         'original_audit_id',r.id,'provenance_id',p.id,
         'field_name',r.field_name,'building_id',r.building_id,'expected_post_fill_value',new_value,
         'ai_assisted',true,'reversible',true
       ),
       'codex_mcp','building_data_backfill',r.target_table,r.target_id,r.target_name,
       jsonb_build_object(r.field_name,new_value),
       jsonb_build_object(r.field_name,NULL),
       'ai_building_field_backfill_20261113_v3_rollback:'||r.id::text,'tool'
   );
   n_done:=n_done+1;
 END LOOP;

 IF n_done<>100 THEN RAISE EXCEPTION 'rollback count % != 100',n_done; END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_ROLLBACK'
        AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_v3_rollback')<>100
 THEN RAISE EXCEPTION 'rollback audit count not 100'; END IF;
 IF (SELECT count(*) FROM public.building_data_field_provenance
        WHERE evidence_note LIKE '%batch=ai_building_field_backfill_20261113_v3;%' AND is_current)<>0
 THEN RAISE EXCEPTION 'rollback provenance still current'; END IF;
 RAISE NOTICE 'All 100 fields successfully reversed WITHIN TRANSACTION; final COMMIT or ROLLBACK controls persistence';
END;
$ai_rollback$;

SELECT
 (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261113_v3') original_ai_fills_retained,
 (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_v3_rollback') rollback_audits_in_transaction,
 (SELECT count(*) FROM public.building_data_field_provenance WHERE evidence_note LIKE '%batch=ai_building_field_backfill_20261113_v3;%' AND is_current) current_provenance_after_rollback;
COMMIT;
