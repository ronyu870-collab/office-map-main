import type { BuildingRow } from '@/src/services/apiClient';

export function normalizeBuildingQuery(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s·・.()\-—]/g, '');
}

export function buildingChoices(buildings: readonly BuildingRow[]) {
  return buildings.filter(b => b.name).map(b => ({
    value: b.id,
    label: b.name,
    detail: [b.district, b.submarket, b.grade, b.address].filter(Boolean).join(' · '),
    keywords: [b.name, ...(b.former_names ?? [])].map(normalizeBuildingQuery),
    aliases: b.former_names ?? [],
  })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN') || a.detail.localeCompare(b.detail, 'zh-CN'));
}

export function matchesBuildingChoice(choice: { keywords?: readonly string[] }, query: string) {
  const key = normalizeBuildingQuery(query);
  return !key || Boolean(choice.keywords?.some(candidate => candidate.includes(key)));
}

export function uniqueNamedBuilding(buildings: readonly BuildingRow[], name: string) {
  const matches = buildings.filter(item => item.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}
