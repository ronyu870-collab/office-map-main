import type { MaterialCategory, SalesMaterial } from './model';

export function materialCategories(material: SalesMaterial): MaterialCategory[] {
  return material.content_types?.length ? material.content_types : ['availability'];
}

/** A later upload of an older sheet must not displace a newer business snapshot. */
export function currentMaterials(records: SalesMaterial[], category: MaterialCategory): SalesMaterial[] {
  const series = new Map<string, SalesMaterial>();
  const historical: SalesMaterial[] = [];
  for (const material of records) {
    if (!materialCategories(material).includes(category)) continue;
    if (material.historical_context) { historical.push(material); continue; }
    const key = material.series_key || 'general';
    const previous = series.get(key);
    const rank = (record: SalesMaterial) => `${record.data_date || record.document_date || ''}|${record.created_at}|${record.id}`;
    if (!previous || rank(material) > rank(previous)) series.set(key, material);
  }
  return [...series.values(), ...historical].sort((a,b)=>(a.scope_label || a.title).localeCompare(b.scope_label || b.title, 'zh-CN'));
}
