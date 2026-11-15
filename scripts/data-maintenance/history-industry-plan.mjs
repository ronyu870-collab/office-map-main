/** One-time maintenance plan. No app/runtime dependency and no provider credentials. */
import { readFileSync } from 'node:fs';
const aliases=JSON.parse(readFileSync(new URL('./history-industry-aliases.json',import.meta.url),'utf8'));
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export function industryPlanSql() {
 return `with taxonomy as (select distinct industry_level1 industry from public.industry_classification),
 aliases(raw,industry) as (values ${Object.entries(aliases).map(([raw,value])=>`(${literal(raw)},${literal(value)})`).join(',')}),
 sub as(select sub_industry,min(industry_level1) industry from public.industry_classification group by sub_industry having count(distinct industry_level1)=1),
 seeds as(select h.id,trim(h.company) company,coalesce(nullif(trim(h.industry),''),t.industry,a.industry,s.industry) industry
 from public.lease_transactions_history h
 left join taxonomy t on t.industry=trim(h.source_industry_raw)
 left join aliases a on a.raw=trim(h.source_industry_raw)
 left join sub s on s.sub_industry=trim(h.sub_industry)),
 known as (select company,min(industry) industry,array_agg('history:'||id::text order by id::text) source_ids
 from seeds where industry in(select industry from taxonomy) and length(company)>=4 and company !~ '(未知|不详|保密|匿名|待定|公司名称|企业名称|客户名称|暂无|未提供)'
 group by company having count(distinct industry)=1),
 candidates as (select h.id,coalesce(t.industry,a.industry,s.industry,k.industry) proposed_industry,
 case when t.industry is not null then 'original_category' when a.industry is not null then 'original_alias' when s.industry is not null then 'stored_subindustry' when k.industry is not null then 'exact_name_consensus' end method,
 jsonb_strip_nulls(jsonb_build_object('source_industry_raw',h.source_industry_raw,'sub_industry',h.sub_industry,
 'supporting_record_ids',case when coalesce(t.industry,a.industry,s.industry) is null then to_jsonb(k.source_ids) else null end)) evidence
 from public.lease_transactions_history h
 left join taxonomy t on t.industry=trim(h.source_industry_raw)
 left join aliases a on a.raw=trim(h.source_industry_raw) and a.industry in(select industry from taxonomy)
 left join sub s on s.sub_industry=trim(h.sub_industry)
 left join known k on k.company=trim(h.company)
 where nullif(trim(h.industry),'') is null)
 select * from candidates where proposed_industry is not null`;
}
export function industryPlanSummarySql(){return `select method,count(*) as candidate_rows from (${industryPlanSql()}) plan group by method order by method;`;}
