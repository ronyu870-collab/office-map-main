import type { MapStatsState } from './mapDomain';

export function marketObservationLabel(periods?: Record<string, number>): string {
  const quarters = Object.keys(periods ?? {}).filter(q => /^\d{4}Q[1-4]$/.test(q)).sort();
  if (!quarters.length) return '筛选存量 · 季度未收录';
  if (quarters.length === 1) return `筛选存量 · 最新正式 ${quarters[0]}`;
  return `筛选存量 · ${quarters[0]}–${quarters.at(-1)} 混合季度`;
}

export function compactMarketArea(stats: MapStatsState): { value: string; unit: string; exact?: string } {
  const area = stats.stockArea === undefined ? Number(stats.totalArea.replaceAll(',', '')) : stats.stockArea;
  if (area == null || !Number.isFinite(area) || area < 0) return { value: stats.totalArea, unit: '㎡' };
  const exact = Math.round(area).toLocaleString('zh-CN');
  return area >= 10000 ? { value: (area / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 }), unit: '万㎡', exact }
    : { value: exact, unit: '㎡', exact };
}
