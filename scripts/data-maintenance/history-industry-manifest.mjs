/** A reviewed private manifest is supplied at execution time; never commit business records. */
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
export function reviewedManifestSql(manifest) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 10000) throw new Error('Invalid manifest size');
  const ids = new Set();
  for (const row of manifest) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(row.id) || ids.has(row.id)) throw new Error('Invalid or duplicate manifest ID');
    ids.add(row.id);
    if (typeof row.expected_company !== 'string' || !row.expected_company.trim() || typeof row.industry !== 'string' || !row.industry.trim()) throw new Error('Missing identity or category');
    if (!['explicit_business_name', 'public_business_evidence', 'reviewed_name_variant'].includes(row.method)) throw new Error('Unsupported evidence method');
    if (!row.evidence || typeof row.evidence.basis !== 'string' || !row.evidence.basis.trim()) throw new Error('Missing evidence basis');
    if (row.method === 'reviewed_name_variant' && (!Array.isArray(row.evidence.supporting_record_ids) || !row.evidence.supporting_record_ids.length || row.evidence.supporting_record_ids.some(id => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)))) throw new Error('Name variants require source record IDs');
    if (row.method === 'public_business_evidence' && (!Array.isArray(row.evidence.urls) || !row.evidence.urls.length || row.evidence.urls.some(url => { try { return !['https:', 'http:'].includes(new URL(url).protocol); } catch { return true; } }))) throw new Error('Public evidence requires source URLs');
  }
  return `with input as(select * from jsonb_to_recordset(${literal(JSON.stringify(manifest))}::jsonb) as x(id uuid,expected_company text,industry text,method text,evidence jsonb))
select i.id,i.industry proposed_industry,i.method,i.evidence from input i
join public.lease_transactions_history h on h.id=i.id and h.company=i.expected_company
where nullif(trim(h.industry),'') is null and exists(select 1 from public.industry_classification c where c.industry_level1=i.industry)
and (i.method<>'reviewed_name_variant' or not exists(select 1 from jsonb_array_elements_text(i.evidence->'supporting_record_ids') source(id) left join public.lease_transactions_history known on known.id=source.id::uuid where known.id is null or known.industry is distinct from i.industry))`;
}
