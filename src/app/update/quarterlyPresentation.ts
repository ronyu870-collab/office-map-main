import type { QuarterlyDraftRow } from './quarterlyDataEntry';

const REFERENCE_FIELDS = ['asking_rent', 'management_fee', 'face_rent', 'rent_free_period', 'net_effective_rent', 'vacant_area', 'vacancy_rate'] as const;
type ReferenceField = typeof REFERENCE_FIELDS[number];

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function quarterlyPresentation(draft: QuarterlyDraftRow, totalArea: number, reference: Record<string, unknown> | null | undefined, isFuture = false) {
  const historicalNumber = (field: ReferenceField) => isFuture ? null : numeric(reference?.[field]);
  const historical = Object.fromEntries(REFERENCE_FIELDS.map((field) => {
    const value = historicalNumber(field);
    if (value === null) return [field, '—'];
    if (field === 'vacancy_rate') return [field, `${(value > 1 ? value : value * 100).toFixed(1)}%`];
    if (field === 'vacant_area') return [field, Math.round(value).toLocaleString('zh-CN')];
    return [field, value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })];
  })) as Record<ReferenceField, string>;
  const face = numeric(draft.qFace);
  const free = numeric(draft.qFree);
  const vacant = numeric(draft.qVacArea);
  const net = face !== null && face >= 0 && free !== null && free >= 0 && free <= 36 ? face * (36 - free) / 36 : null;
  const lastNet = historicalNumber('net_effective_rent');
  const lastVacant = historicalNumber('vacant_area');
  const rentDelta = net !== null && lastNet !== null && lastNet > 0 ? (net - lastNet) / lastNet * 100 : null;
  const areaDelta = vacant !== null && vacant >= 0 && lastVacant !== null ? Math.round(vacant - lastVacant) : null;
  const vacancy = vacant !== null && vacant >= 0 && totalArea > 0 ? vacant / totalArea * 100 : null;
  const current = {
    net: net === null ? '—' : net.toFixed(2),
    rentDelta: rentDelta === null ? '—' : `${rentDelta > 0 ? '+' : ''}${rentDelta.toFixed(1)}%`,
    areaDelta: areaDelta === null ? '—' : `${areaDelta > 0 ? '+' : ''}${areaDelta.toLocaleString('zh-CN')}`,
    vacancy: vacancy === null ? '—' : `${vacancy.toFixed(1)}%`,
  };
  return { historical, current };
}
