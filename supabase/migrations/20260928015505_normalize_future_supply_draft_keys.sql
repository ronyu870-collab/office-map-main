begin;

create table backup_q3_20260928.update_drafts_post_relabel_pre_key_normalization as
select * from public.update_drafts;

with rewritten as (
  select
    d.id,
    coalesce(
      (
        select jsonb_object_agg(
          coalesce(a.future_supply_id::text, e.key),
          e.value
        )
        from jsonb_each(coalesce(d.draft_data->'__futureSupply__', '{}'::jsonb)) e
        left join public.future_supply_assignments a
          on a.id::text = e.key
      ),
      '{}'::jsonb
    ) as normalized_future
  from public.update_drafts d
  where jsonb_typeof(d.draft_data->'__futureSupply__') = 'object'
)
update public.update_drafts d
set draft_data = jsonb_set(
      d.draft_data,
      '{__futureSupply__}',
      r.normalized_future,
      true
    )
from rewritten r
where d.id = r.id
  and coalesce(d.draft_data->'__futureSupply__', '{}'::jsonb)
      is distinct from r.normalized_future;

commit;
