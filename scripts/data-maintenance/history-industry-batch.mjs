import { industryPlanSql } from './history-industry-plan.mjs';
import { reviewedManifestSql } from './history-industry-manifest.mjs';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
/** Returns one atomic, audited maintenance transaction. It adds no persistent database object. */
export function buildIndustryBatch({ batch, expectedCount, mode='apply', manifest }) {
 if(!/^[a-z0-9][a-z0-9_-]{5,79}$/.test(batch)||!Number.isSafeInteger(expectedCount)||expectedCount<0||expectedCount>10000||!['apply','rollback'].includes(mode))throw new Error('Invalid batch parameters');
 if(mode==='rollback')return buildRollback(batch,expectedCount);
 if(manifest && manifest.length!==expectedCount)throw new Error('Manifest count mismatch');
 const plan=manifest?reviewedManifestSql(manifest):industryPlanSql();
 return `begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.lease_transactions_history in share row exclusive mode;
create temporary table industry_batch_plan on commit drop as ${plan};
do $check$ begin
 if exists(select 1 from public.audit_logs where action_type='DATA_UPDATE' and target_table='lease_transactions_history' and details->>'batch'=${literal(batch)}) then raise exception 'Batch already applied; use a new reviewed batch or explicit rollback'; end if;
 if (select count(*) from industry_batch_plan)<>${expectedCount} then raise exception 'Candidate count changed; recheck the plan'; end if;
 if exists(select 1 from industry_batch_plan group by id having count(*)>1) then raise exception 'Duplicate candidate'; end if;
end $check$;
create temporary table industry_batch_before on commit drop as
 select h.id,h.industry,h.normalization_notes,h.updated_at from public.lease_transactions_history h join industry_batch_plan p using(id);
update public.lease_transactions_history h set industry=p.proposed_industry,
 normalization_notes=jsonb_set(coalesce(h.normalization_notes,'{}'::jsonb),'{industry_backfill}',jsonb_build_object('batch',${literal(batch)},'method',p.method,'evidence',p.evidence,'applied_at',now(),'executor','codex','nature',case when p.method in('exact_name_consensus','reviewed_name_variant') then 'record_based_inference' when p.method='explicit_business_name' then 'business_name_inference' when p.method='public_business_evidence' then 'public_source_classification' else 'original_source_normalization' end)),
 updated_at=now()
from industry_batch_plan p where h.id=p.id and nullif(trim(h.industry),'') is null;
insert into public.audit_logs(user_id,action_type,details,request_source,module,target_table,target_id,old_values,new_values)
 select 'codex','DATA_UPDATE',jsonb_build_object('table','历史租赁成交','batch',${literal(batch)},'operation','industry_backfill','executor','codex','method',p.method,'evidence',p.evidence),
 'server','lease-submission','lease_transactions_history',h.id::text,
 jsonb_build_object('industry',b.industry,'normalization_notes',b.normalization_notes,'updated_at',b.updated_at),
 jsonb_build_object('industry',h.industry,'normalization_notes',h.normalization_notes,'updated_at',h.updated_at)
 from industry_batch_plan p join industry_batch_before b using(id) join public.lease_transactions_history h using(id);
do $check$ begin
 if(select count(*) from public.audit_logs where target_table='lease_transactions_history' and details->>'batch'=${literal(batch)} and details->>'operation'='industry_backfill')<>${expectedCount} then raise exception 'Incomplete audit'; end if;
 if exists(select 1 from industry_batch_plan p join public.lease_transactions_history h using(id) where h.industry is distinct from p.proposed_industry) then raise exception 'Write verification failed'; end if;
end $check$;
select ${literal(batch)} as batch,count(*) as changed_rows from industry_batch_plan;
commit;`;
}
function buildRollback(batch,expectedCount){return `begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.lease_transactions_history in share row exclusive mode;
create temporary table industry_batch_restore on commit drop as
 select target_id::uuid id,old_values,new_values from public.audit_logs where target_table='lease_transactions_history' and details->>'batch'=${literal(batch)} and details->>'operation'='industry_backfill';
do $check$ begin
 if(select count(*) from industry_batch_restore)<>${expectedCount} then raise exception 'Unexpected rollback count'; end if;
 if exists(select 1 from industry_batch_restore r left join public.lease_transactions_history h using(id) where h.id is null or jsonb_build_object('industry',h.industry,'normalization_notes',h.normalization_notes,'updated_at',h.updated_at) is distinct from r.new_values) then raise exception 'Record changed after backfill; rollback refused'; end if;
end $check$;
update public.lease_transactions_history h set industry=r.old_values->>'industry',normalization_notes=nullif(r.old_values->'normalization_notes','null'::jsonb),updated_at=(r.old_values->>'updated_at')::timestamptz from industry_batch_restore r where h.id=r.id;
insert into public.audit_logs(user_id,action_type,details,request_source,module,target_table,target_id,old_values,new_values)
 select 'codex','DATA_UPDATE',jsonb_build_object('table','历史租赁成交','batch',${literal(batch)},'operation','industry_backfill_rollback','executor','codex'),'server','lease-submission','lease_transactions_history',r.id::text,r.new_values,r.old_values from industry_batch_restore r;
select ${literal(batch)} as batch,count(*) as restored_rows from industry_batch_restore;
commit;`;}
