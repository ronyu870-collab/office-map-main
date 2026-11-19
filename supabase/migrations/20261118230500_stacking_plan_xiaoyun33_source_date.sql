-- 用户于 2026-11-18 明确确认霄云路33号 A/B 座截图的业务数据截至日期为当天。
-- 此确认只适用于来源资料日期，不等于所有截图租户、租金和空间状态均已核验。
-- 空间逐条 verification_status 继续 source_unverified；不回写成交、销控或季度指标。
begin;
alter table public.stacking_plan_sources
  drop constraint if exists stacking_plan_sources_review_state_check;
alter table public.stacking_plan_sources
  add constraint stacking_plan_sources_review_state_check
  check (review_state in ('pending_source_date', 'date_confirmed', 'verified', 'rejected'));
update public.stacking_plan_sources
  set source_as_of = date '2026-11-18',
      as_of_kind = 'source_data_as_of',
      review_state = 'date_confirmed',
      source_note = '2026-11-18：用户在会话中确认这份霄云路33号 A/B 座截图的数据截至日期为当天；确认的是业务时点，非业主签章或租约逐项核验。个别图片难辨名称、面积和历史成交差异仍保留待核验。'
where id = 'xiaoyun33-initial-screenshot'
  and building_id = '9ee3e3ff-4845-41a1-a78f-390c11b1917a'::uuid
  and (source_as_of is null or source_as_of = date '2026-11-18');
commit;
