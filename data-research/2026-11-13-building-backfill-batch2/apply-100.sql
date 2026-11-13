-- Colliers Intelligence Platform 2026-11-13 SECOND production batch.
-- BATCH: ai_building_field_backfill_20261113_100_v2
-- This script contains NO proprietary broker-submitted owner/PM values: those are read
-- only from the authorised production Supabase database at transaction time.
-- Selection: 48 safe empty master fields from formal quarterly submissions,
-- plus 52 empty brochure PM fields from building master, of which 36 match recent survey.
-- Excluded suspicious/truncated: 中固大厦 owner/PM, 泰和国际 PM, 西环广场T3 owner.
-- All values, source provenance, and audit events are atomic: any failure rolls back.
DO $ai_b2$
DECLARE
  batch_ref text := 'ai_building_field_backfill_20261113_100_v2';
  batch_evidence_id uuid := gen_random_uuid();
  payload jsonb;
  v record;
  building_row record;
  source_actual jsonb;
  target_id uuid;
  old_json jsonb;
  changed_id uuid;
  actual_json jsonb;
  rows_written integer := 0;
  evidence_tier text;
  source_label text;
  source_notes text;
  evidence_count integer;
  audit_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(801192,20261113);
  IF EXISTS(SELECT 1 FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'=batch_ref) THEN
    RAISE EXCEPTION 'Batch already exists: %',batch_ref;
  END IF;

  WITH latest_survey AS (SELECT DISTINCT ON (building_id) id,building_id,owner,property_management,record_year,record_quarter,created_at
 FROM public.quarterly_submissions
 WHERE NULLIF(btrim(owner),'') IS NOT NULL OR NULLIF(btrim(property_management),'') IS NOT NULL
 ORDER BY building_id,record_year DESC,record_quarter DESC,created_at DESC,id DESC),latest_pm AS (SELECT DISTINCT ON (building_id) id,building_id,property_management,record_year,record_quarter,created_at
 FROM public.quarterly_submissions
 WHERE NULLIF(btrim(property_management),'') IS NOT NULL
 ORDER BY building_id,record_year DESC,record_quarter DESC,created_at DESC,id DESC),
 main_candidates AS(
   SELECT b.id AS building_id,b.name AS building_name,'buildings'::text AS target_table,
     fld.field_name,to_jsonb(CASE WHEN fld.field_name='owner' THEN q.owner ELSE q.property_management END) AS new_value,
     'quarterly_submissions'::text AS source_table,q.id AS source_id,
     'broker_formal_quarterly'::text AS source_kind,q.record_year,q.record_quarter,q.created_at AS original_record_time,
     NULL::uuid AS corroborating_survey_id
   FROM public.buildings b JOIN latest_survey q ON q.building_id=b.id
   CROSS JOIN LATERAL(VALUES('owner'::text),('property_management'::text)) fld(field_name)
   WHERE b.is_active AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
     AND (CASE WHEN fld.field_name='owner' THEN NULLIF(btrim(b.owner),'') IS NULL ELSE NULLIF(btrim(b.property_management),'') IS NULL END)
     AND (CASE WHEN fld.field_name='owner' THEN NULLIF(btrim(q.owner),'') IS NOT NULL ELSE NULLIF(btrim(q.property_management),'') IS NOT NULL END)
     AND b.id<>'71f99700-1954-4b16-b853-4c255f9d6fb2'::uuid
     AND NOT(b.id='c3cd9dc0-f853-44ec-bb6d-e332eac9480c'::uuid AND fld.field_name='property_management')
     AND NOT(b.id='51a3bb4f-bae5-4156-a9e3-2293586c10ab'::uuid AND fld.field_name='owner')
 ),
 brochure_ranked AS(
   SELECT b.id AS building_id,b.name AS building_name,'building_brochure_data'::text AS target_table,
     'property_management'::text AS field_name,to_jsonb(b.property_management) AS new_value,
     'buildings'::text AS source_table,b.id AS source_id,
     CASE WHEN q.id IS NOT NULL THEN 'building_master_survey_matched'::text ELSE 'building_master_standalone'::text END AS source_kind,
     q.record_year,q.record_quarter,q.created_at AS original_record_time,q.id AS corroborating_survey_id,
     ROW_NUMBER() OVER(ORDER BY CASE WHEN q.id IS NOT NULL THEN 0 ELSE 1 END,b.name,b.id) AS ord
   FROM public.buildings b JOIN public.building_brochure_data br ON br.building_id=b.id
   LEFT JOIN latest_pm q ON q.building_id=b.id AND btrim(q.property_management)=btrim(b.property_management)
   WHERE b.is_active AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
     AND NULLIF(btrim(b.property_management),'') IS NOT NULL
     AND NULLIF(btrim(br.property_management),'') IS NULL
     AND (q.id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM latest_pm q2 WHERE q2.building_id=b.id))
 ),
 selected AS(
   SELECT building_id,building_name,target_table,field_name,new_value,source_table,source_id,source_kind,record_year,record_quarter,original_record_time,corroborating_survey_id FROM main_candidates
   UNION ALL SELECT building_id,building_name,target_table,field_name,new_value,source_table,source_id,source_kind,record_year,record_quarter,original_record_time,corroborating_survey_id FROM brochure_ranked WHERE ord<=52
 )

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.target_table,s.building_name,s.field_name),'[]'::jsonb)
    INTO payload FROM selected s;

  IF jsonb_array_length(payload)<>100 THEN
    RAISE EXCEPTION 'Expected exactly 100 eligible field slots but found %', jsonb_array_length(payload);
  END IF;
  IF EXISTS(SELECT 1 FROM (SELECT x.building_id,x.target_table,x.field_name,count(*) AS n
      FROM jsonb_to_recordset(payload) AS x(building_id uuid,target_table text,field_name text)
      GROUP BY 1,2,3 HAVING count(*)>1) d) THEN
    RAISE EXCEPTION 'Duplicated target fields';
  END IF;

  FOR v IN SELECT * FROM jsonb_to_recordset(payload) AS r(
      building_id uuid,building_name text,target_table text,field_name text,
      new_value jsonb,source_table text,source_id uuid,source_kind text,
      record_year integer,record_quarter integer,original_record_time timestamptz,
      corroborating_survey_id uuid)
  LOOP
    IF v.target_table NOT IN ('buildings','building_brochure_data')
       OR v.field_name NOT IN ('owner','property_management')
       OR (v.target_table='building_brochure_data' AND v.field_name<>'property_management')
       OR v.new_value IS NULL OR v.new_value='null'::jsonb OR v.new_value='""'::jsonb THEN
      RAISE EXCEPTION 'Invalid field/scope for building %',v.building_id;
    END IF;

    SELECT * INTO building_row FROM public.buildings
      WHERE id=v.building_id FOR UPDATE;
    IF NOT FOUND OR building_row.name IS DISTINCT FROM v.building_name
      OR NOT building_row.is_active OR building_row.tracking_scope<>'tracked'
      OR building_row.merged_into_id IS NOT NULL THEN
      RAISE EXCEPTION 'Target building identity changed: %',v.building_id;
    END IF;

    IF v.source_kind='broker_formal_quarterly' THEN
      SELECT CASE WHEN v.field_name='owner' THEN to_jsonb(q.owner)
                  ELSE to_jsonb(q.property_management) END INTO source_actual
        FROM public.quarterly_submissions q
        WHERE q.id=v.source_id AND q.building_id=v.building_id;
      source_label:=format('%sQ%s 季度正式填报（Broker原记录）',v.record_year,v.record_quarter);
      evidence_tier:='primary';
    ELSIF v.source_kind IN ('building_master_survey_matched','building_master_standalone') THEN
      IF v.target_table<>'building_brochure_data' OR v.source_id<>v.building_id THEN
        RAISE EXCEPTION 'Source invalid for brochure field %',v.building_id;
      END IF;
      source_actual:=to_jsonb(building_row.property_management);
      source_label:='高力国际已收录的楼宇主档';
      evidence_tier:=CASE WHEN v.source_kind='building_master_survey_matched'
        THEN 'authoritative_secondary' ELSE 'legacy_unknown' END;
      IF v.corroborating_survey_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM public.quarterly_submissions q
          WHERE q.id=v.corroborating_survey_id AND q.building_id=v.building_id
            AND to_jsonb(q.property_management)=v.new_value) THEN
        RAISE EXCEPTION 'Quarterly corroboration changed for %',v.building_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Unrecognized source kind %',v.source_kind;
    END IF;
    IF source_actual IS DISTINCT FROM v.new_value THEN
      RAISE EXCEPTION 'Source value changed for %.%',v.building_id,v.field_name;
    END IF;

    IF v.target_table='buildings' THEN
      target_id:=v.building_id;
    ELSE
      SELECT id INTO target_id FROM public.building_brochure_data
       WHERE building_id=v.building_id FOR UPDATE;
      IF NOT FOUND OR (SELECT count(*) FROM public.building_brochure_data
          WHERE building_id=v.building_id)<>1 THEN
        RAISE EXCEPTION 'Brochure record missing/ambiguous for %',v.building_id;
      END IF;
    END IF;

    EXECUTE format('SELECT to_jsonb(t)->%L FROM public.%I t WHERE t.id=$1 FOR UPDATE',
       v.field_name,v.target_table) INTO old_json USING target_id;
    IF old_json IS NOT NULL AND old_json<>'null'::jsonb AND old_json<>'""'::jsonb THEN
      RAISE EXCEPTION 'Preexisting value: % %.%',v.building_id,v.target_table,v.field_name;
    END IF;
    IF EXISTS(SELECT 1 FROM public.building_data_field_provenance p
       WHERE p.building_id=v.building_id AND p.target_table=v.target_table
         AND p.field_name=v.field_name AND p.is_current) THEN
      RAISE EXCEPTION 'Active provenance already attached to %.%',v.building_id,v.field_name;
    END IF;

    changed_id:=NULL;
    EXECUTE format('UPDATE public.%I AS t SET %I=(jsonb_populate_record(NULL::public.%I,jsonb_build_object(%L,$1))).%I WHERE t.id=$2 AND nullif(btrim(to_jsonb(t)->>%L),'''') IS NULL RETURNING t.id',
         v.target_table,v.field_name,v.target_table,v.field_name,v.field_name,v.field_name)
       INTO changed_id USING v.new_value,target_id;
    IF changed_id IS NULL THEN
      RAISE EXCEPTION 'Concurrent modification at %.%',v.building_id,v.field_name;
    END IF;
    EXECUTE format('SELECT to_jsonb(t)->%L FROM public.%I t WHERE t.id=$1',
       v.field_name,v.target_table) INTO actual_json USING target_id;
    IF actual_json IS DISTINCT FROM v.new_value THEN
      RAISE EXCEPTION 'Post-write mismatch at %.%',v.building_id,v.field_name;
    END IF;

    source_notes:=concat(
      'AI_ASSISTED_INTERNAL_BACKFILL; batch=',batch_ref,
      '; original_table=',v.source_table,
      '; original_record_id=',v.source_id::text,
      '; original_field=',v.field_name,
      '; source_kind=',v.source_kind,
      '; report_period=',coalesce(v.record_year::text||'Q'||v.record_quarter::text,'not_applicable'),
      '; original_record_created_at=',coalesce(v.original_record_time::text,'unknown'),
      '; corroborating_survey_id=',coalesce(v.corroborating_survey_id::text,'none'),
      '; qualification=internal_source_not_independent_external_verification',
      '; fill_only_blank=true'
    );

    INSERT INTO public.building_data_field_provenance(
       building_id,brochure_data_id,target_table,field_name,field_value,
       source_type,source_tier,source_name,source_url,source_retrieved_at,
       value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current
    ) VALUES (
       v.building_id,CASE WHEN v.target_table='building_brochure_data' THEN target_id ELSE NULL END,
       v.target_table,v.field_name,v.new_value,
       'other',evidence_tier,source_label,NULL,now(),
       now(),'legacy_backfill',batch_evidence_id,source_notes,true
    );

    INSERT INTO public.audit_logs(
       user_id,action_type,module,target_table,target_id,target_name,
       old_values,new_values,details,request_source,event_id,occurred_at
    ) VALUES (
       'codex','AI_FIELD_FILL','building_data_ai_enrichment',
       v.target_table,target_id::text,v.building_name,
       jsonb_build_object(v.field_name,old_json),jsonb_build_object(v.field_name,v.new_value),
       jsonb_build_object('batch_ref',batch_ref,'field_name',v.field_name,
        'building_id',v.building_id,'source_kind',v.source_kind,
        'source_table',v.source_table,'source_record_id',v.source_id,
        'source_period',CASE WHEN v.record_year IS NOT NULL THEN v.record_year::text||'Q'||v.record_quarter::text ELSE NULL END,
        'source_record_created_at',v.original_record_time,
        'corroborating_survey_id',v.corroborating_survey_id,
        'ai_generated',false,'ai_assisted',true,'reversible',true,
        'evidence_group_id',batch_evidence_id),
       'codex_mcp',batch_ref||':'||v.building_id::text||':'||v.target_table||':'||v.field_name,now()
    );
    rows_written:=rows_written+1;
  END LOOP;

  SELECT count(*) INTO evidence_count FROM public.building_data_field_provenance
    WHERE evidence_group_id=batch_evidence_id;
  SELECT count(*) INTO audit_count FROM public.audit_logs
    WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'=batch_ref;
  IF rows_written<>100 OR evidence_count<>100 OR audit_count<>100 THEN
     RAISE EXCEPTION 'Count mismatch writes % evidence % audit %',rows_written,evidence_count,audit_count;
  END IF;
END $ai_b2$;
