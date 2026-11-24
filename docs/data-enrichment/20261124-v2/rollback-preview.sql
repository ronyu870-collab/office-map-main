-- Batch-specific rollback PREVIEW ONLY. Final ROLLBACK is intentional.
-- Any later row edit, field provenance revision, or later target audit aborts the whole transaction.
-- Only if separately authorized after a fresh preview may an operator change final ROLLBACK to COMMIT.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='45s';
LOCK TABLE public.building_brochure_data, public.building_data_field_provenance, public.audit_logs IN SHARE ROW EXCLUSIVE MODE;
DO $rb$
DECLARE
  batch constant text:='ai_technical_fields_20261124_v2';
  r record; d record; field text; expected jsonb; actual jsonb; grp uuid;
  n int:=0; np int:=0; changed int; evidence_count int;
BEGIN
  IF (SELECT count(*) FROM public.audit_logs WHERE details->>'batch_id'=batch AND action_type='AI_FIELD_FILL')<>14 THEN RAISE EXCEPTION 'Unexpected original audit count'; END IF;
  IF EXISTS(SELECT 1 FROM public.audit_logs WHERE details->>'rollback_of_batch'=batch) THEN RAISE EXCEPTION 'Rollback already recorded'; END IF;
  -- Validate every field and every target row before the first update.
  FOR r IN SELECT * FROM public.audit_logs WHERE details->>'batch_id'=batch AND action_type='AI_FIELD_FILL' ORDER BY id LOOP
    field:=r.details->>'field_name'; expected:=r.new_values->field; grp:=(r.details->>'evidence_group_id')::uuid;
    IF r.target_table<>'building_brochure_data' OR field NOT IN ('building_floors','parking_total','floors_above','floors_below','building_height','developer','gfa_total') OR r.old_values->field IS DISTINCT FROM 'null'::jsonb OR expected IS NULL OR expected='null'::jsonb THEN RAISE EXCEPTION 'Unexpected original audit shape: %',r.id; END IF;
    SELECT * INTO STRICT d FROM public.building_brochure_data WHERE id=r.target_id::uuid AND building_id=(r.details->>'building_id')::uuid;
    IF to_jsonb(d)->field IS DISTINCT FROM expected OR d.updated_at IS DISTINCT FROM (r.details->>'target_updated_at_after')::timestamptz THEN RAISE EXCEPTION 'Target has changed after backfill: % %',r.target_id,field; END IF;
    IF EXISTS(SELECT 1 FROM public.audit_logs later WHERE later.target_table=r.target_table AND later.target_id=r.target_id AND later.created_at>=r.created_at AND later.id<>r.id AND coalesce(later.details->>'batch_id','')<>batch) THEN RAISE EXCEPTION 'Later target audit: %',r.target_id; END IF;
    SELECT count(*) INTO evidence_count FROM public.building_data_field_provenance pr WHERE pr.evidence_group_id=grp AND pr.is_current AND pr.building_id=d.building_id AND pr.brochure_data_id=d.id AND pr.target_table='building_brochure_data' AND pr.field_name=field AND pr.field_value=expected AND pr.verification_status=r.details->>'verification_status';
    IF evidence_count<>(r.details->>'provenance_count')::int OR (SELECT count(*) FROM public.building_data_field_provenance pr WHERE pr.evidence_group_id=grp)<>evidence_count THEN RAISE EXCEPTION 'Evidence changed: % %',r.target_id,field; END IF;
    IF EXISTS(SELECT 1 FROM public.building_data_field_provenance pr WHERE pr.brochure_data_id=d.id AND pr.field_name=field AND pr.evidence_group_id IS DISTINCT FROM grp AND (pr.is_current OR pr.created_at>=r.created_at)) THEN RAISE EXCEPTION 'Other current or later field provenance: % %',r.target_id,field; END IF;
  END LOOP;
  FOR r IN SELECT * FROM public.audit_logs WHERE details->>'batch_id'=batch AND action_type='AI_FIELD_FILL' ORDER BY id LOOP
    field:=r.details->>'field_name'; expected:=r.new_values->field; grp:=(r.details->>'evidence_group_id')::uuid;
    EXECUTE format('UPDATE public.building_brochure_data SET %1$I=NULL WHERE id=$1 AND to_jsonb(%1$I)=$2 RETURNING coalesce(to_jsonb(%1$I),''null''::jsonb)',field) INTO actual USING r.target_id::uuid,expected;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 OR actual IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Rollback mismatch: % %',r.target_id,field; END IF;
    UPDATE public.building_data_field_provenance SET is_current=false WHERE evidence_group_id=grp AND is_current;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>(r.details->>'provenance_count')::int THEN RAISE EXCEPTION 'Rollback evidence mismatch'; END IF;
    np:=np+changed;
    INSERT INTO public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,details)
      VALUES('chatgpt','AI_FIELD_ROLLBACK','chatgpt_mcp','building_data_ai_enrichment',r.target_table,r.target_id,r.target_name,r.new_values,r.old_values,batch||':rollback:'||r.target_id||':'||field,
      jsonb_build_object('rollback_of_batch',batch,'executor','ChatGPT MCP','ai_assisted',true,'original_audit_id',r.id,'field_name',field,'building_id',r.details->>'building_id','evidence_group_id',grp));
    n:=n+1;
  END LOOP;
  IF n<>14 OR np<>21 THEN RAISE EXCEPTION 'Rollback count mismatch'; END IF;
END;
$rb$;
WITH a AS (SELECT * FROM public.audit_logs WHERE details->>'batch_id'='ai_technical_fields_20261124_v2' AND action_type='AI_FIELD_FILL')
SELECT count(*) AS tested_fields,
 count(*) FILTER(WHERE to_jsonb(d)->(a.details->>'field_name')='null'::jsonb) AS restored_nulls,
 (SELECT count(*) FROM public.audit_logs WHERE details->>'rollback_of_batch'='ai_technical_fields_20261124_v2') AS compensating_audits,
 (SELECT count(*) FROM public.building_data_field_provenance pr WHERE NOT pr.is_current AND pr.evidence_group_id IN (SELECT (details->>'evidence_group_id')::uuid FROM a)) AS retired_evidence
FROM a JOIN public.building_brochure_data d ON d.id=a.target_id::uuid;
ROLLBACK;
