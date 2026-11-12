begin;

-- Internal assessment only. No foreign keys or writes to lease records or identities.
create table public.lease_company_ai_assessments (
  id bigint generated always as identity primary key,
  policy_key text not null check (length(policy_key) between 1 and 64),
  key_a text not null check (length(key_a) between 2 and 100),
  key_b text not null check (length(key_b) between 2 and 100),
  name_a text not null check (length(name_a) between 2 and 100),
  name_b text not null check (length(name_b) between 2 and 100),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'claimed' check (status in ('claimed', 'scored', 'failed')),
  relation text check (relation in ('same_company', 'related_company', 'unrelated', 'uncertain')),
  strength text check (strength in ('strong', 'uncertain')),
  reviewed_relation text check (reviewed_relation in ('same_company', 'related_company', 'unrelated', 'uncertain')),
  review_evidence text,
  unique (policy_key, key_a, key_b),
  check (key_a collate "C" < key_b collate "C"),
  check (
    (status = 'claimed' and completed_at is null and relation is null and strength is null) or
    (status = 'failed' and completed_at is not null and relation is null and strength is null) or
    (status = 'scored' and completed_at is not null and relation is not null and strength is not null)
  ),
  check (
    (reviewed_relation is null and review_evidence is null) or
    (reviewed_relation is not null and coalesce(length(btrim(review_evidence)), 0) > 0
      and status = 'scored' and strength = 'strong' and relation in ('same_company', 'related_company'))
  )
);

alter table public.lease_company_ai_assessments enable row level security;
create policy lease_company_ai_service_only on public.lease_company_ai_assessments
  for all to service_role using (true) with check (true);
revoke all on public.lease_company_ai_assessments from public, anon, authenticated, service_role;
grant select, insert (policy_key, key_a, key_b, name_a, name_b)
  on public.lease_company_ai_assessments to service_role;
revoke all on sequence public.lease_company_ai_assessments_id_seq from public, anon, authenticated, service_role;
grant usage on sequence public.lease_company_ai_assessments_id_seq to service_role;
grant update (completed_at, status, relation, strength)
  on public.lease_company_ai_assessments to service_role;

create index lease_company_ai_assessments_reverse_idx
  on public.lease_company_ai_assessments (policy_key, key_b);
create index lease_company_ai_assessments_calibration_idx
  on public.lease_company_ai_assessments (policy_key, relation, completed_at, id)
  where status = 'scored' and strength = 'strong';
create index lease_company_ai_assessments_budget_idx
  on public.lease_company_ai_assessments (created_at);

-- One claim per unordered pair/policy. Cap new pairs across instances and models
-- to 120 per UTC day. The lock covers admission only, never the model call.
create function public.lease_company_ai_claim_v1(
  p_policy text, p_query_key text, p_query_name text, p_candidates jsonb
)
returns table (assessment_id bigint, name_a text, name_b text)
language plpgsql security invoker set search_path = ''
as $$
declare
  remaining integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(725934, 1);
  select greatest(120 - count(*), 0)::integer into remaining
    from public.lease_company_ai_assessments as a
    where a.created_at >= date_trunc('day', now(), 'UTC');

  return query
    with candidates as (
      select c.key, min(c.name) as name
      from jsonb_to_recordset(p_candidates) as c(key text, name text)
      where c.key <> p_query_key
      group by c.key
    ), ordered as (
      select
        least(p_query_key collate "C", c.key collate "C") as first_key,
        greatest(p_query_key collate "C", c.key collate "C") as second_key,
        case when p_query_key collate "C" < c.key collate "C" then p_query_name else c.name end as first_name,
        case when p_query_key collate "C" < c.key collate "C" then c.name else p_query_name end as second_name
      from candidates as c
    )
    insert into public.lease_company_ai_assessments as a (policy_key, key_a, key_b, name_a, name_b)
    select p_policy, o.first_key, o.second_key, o.first_name, o.second_name
    from ordered as o
    where not exists (
      select 1 from public.lease_company_ai_assessments as existing
      where existing.policy_key = p_policy and existing.key_a = o.first_key and existing.key_b = o.second_key
    )
    order by o.first_key collate "C", o.second_key collate "C"
    limit least(remaining, 4)
    on conflict (policy_key, key_a, key_b) do nothing
    returning a.id, a.name_a, a.name_b;
end;
$$;

create function public.lease_company_ai_complete_v1(p_policy text, p_results jsonb)
returns void
language sql security invoker set search_path = ''
as $$
  update public.lease_company_ai_assessments as a
  set status = case when r.relation is null then 'failed' else 'scored' end,
      completed_at = statement_timestamp(), relation = r.relation, strength = r.strength
  from jsonb_to_recordset(p_results) as r(assessment_id bigint, relation text, strength text)
  where a.id = r.assessment_id and a.policy_key = p_policy and a.status = 'claimed'
$$;

-- The cohort is fixed by the first 100 strong completed predictions per relation.
-- Operators must review the full cohort; unknown and wrong relations count as misses.
create function public.lease_company_ai_review_sample_v1(p_policy text, p_relation text)
returns table (
  assessment_id bigint, name_a text, name_b text, reviewed_relation text, review_evidence text
)
language sql stable security invoker set search_path = ''
as $$
  select a.id, a.name_a, a.name_b, a.reviewed_relation, a.review_evidence
  from public.lease_company_ai_assessments as a
  where a.policy_key = p_policy and a.status = 'scored' and a.strength = 'strong'
    and a.relation = p_relation and p_relation in ('same_company', 'related_company')
  order by a.completed_at, a.id
  limit 100
$$;

create function public.lease_company_ai_hints_v1(p_policy text, p_query_key text, p_source text)
returns table (company text, relation text)
language sql stable security invoker set search_path = ''
as $$
  with eligible as materialized (
    select r.kind
    from (values ('same_company'), ('related_company')) as r(kind)
    cross join lateral (
      select count(s.reviewed_relation) as reviewed,
        count(*) filter (where s.reviewed_relation = r.kind) as correct
      from public.lease_company_ai_review_sample_v1(p_policy, r.kind) as s
    ) as evidence
    where evidence.reviewed = 100 and evidence.correct >= 95
  ), matches as materialized (
    select a.relation, a.id,
      case when a.key_a = p_query_key then a.key_b else a.key_a end as candidate_key
    from public.lease_company_ai_assessments as a
    join eligible as e on e.kind = a.relation
    where a.policy_key = p_policy and (a.key_a = p_query_key or a.key_b = p_query_key)
      and a.status = 'scored' and a.strength = 'strong'
      and (a.reviewed_relation is null or a.reviewed_relation = a.relation)
    order by case when a.relation = 'same_company' then 0 else 1 end, a.id
    limit 8
  )
  select visible.company, m.relation
  from matches as m
  cross join lateral (
    -- Re-check current visibility even if an admin originally generated the assessment.
    -- Use the actual stored name (not a model output or a cached display name).
    select btrim(l.company) as company
    from public.lease_transactions_read_v1 as l
    where p_source in ('live', 'history', 'all')
      and (p_source = 'all' or l.record_source = p_source)
      and lower(regexp_replace(normalize(btrim(l.company), NFKC), ' +', ' ', 'g')) = m.candidate_key
    order by l.company
    limit 1
  ) as visible
  order by case when m.relation = 'same_company' then 0 else 1 end, m.id
  limit 4
$$;

revoke all on function public.lease_company_ai_claim_v1(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lease_company_ai_complete_v1(text, jsonb) from public, anon, authenticated;
revoke all on function public.lease_company_ai_review_sample_v1(text, text) from public, anon, authenticated;
revoke all on function public.lease_company_ai_hints_v1(text, text, text) from public, anon, authenticated;
grant execute on function public.lease_company_ai_claim_v1(text, text, text, jsonb) to service_role;
grant execute on function public.lease_company_ai_complete_v1(text, jsonb) to service_role;
grant execute on function public.lease_company_ai_review_sample_v1(text, text) to service_role;
grant execute on function public.lease_company_ai_hints_v1(text, text, text) to service_role;

commit;
