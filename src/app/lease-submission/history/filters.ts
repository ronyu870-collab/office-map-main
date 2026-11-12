import { BROKER_ID } from '@/src/lib/broker/links';

export type SourceFilter = '' | 'live' | 'history';
export type FilterState = {
  company: string;
  exactCompany?: boolean;
  building: string;
  buildingId?: string;
  yearFrom: string;
  yearTo: string;
  source: SourceFilter;
  areaMin: string;
  areaMax: string;
};

export const DEFAULT_FILTERS: FilterState = {
  company: '', building: '', yearFrom: '2015', yearTo: String(new Date().getFullYear()),
  source: '', areaMin: '', areaMax: '',
};

export function leaseFilterParams(filters: FilterState) {
  const params = new URLSearchParams();
  if (filters.company.trim()) params.set(filters.exactCompany ? 'company_exact' : 'company', filters.company.trim());
  if (filters.buildingId) params.set('building_id', filters.buildingId);
  else if (filters.building.trim()) params.set('building', filters.building.trim());
  if (filters.yearFrom) params.set('year_from', filters.yearFrom);
  if (filters.yearTo) params.set('year_to', filters.yearTo);
  if (filters.source) params.set('record_source', filters.source);
  if (filters.areaMin) params.set('area_min', filters.areaMin);
  if (filters.areaMax) params.set('area_max', filters.areaMax);
  return params;
}

export function historyContextHref(filters: FilterState, page: number, detail?: string, back?: string) {
  const params = leaseFilterParams(filters);
  params.set('resume', '1');
  if (filters.buildingId) params.set('buildingName', filters.building);
  if (page > 0) params.set('page', String(page));
  if (detail) params.set('detail', detail);
  if (back) params.set('back', back);
  return `/lease-submission/history?${params}`;
}

export function readHistoryContext(params: URLSearchParams): { filters: FilterState; page: number; detail: string | null } | null {
  const company = params.get('exactCompany');
  const buildingId = params.get('buildingId') ?? params.get('building_id');
  const resume = params.get('resume') === '1';
  if (!company && !buildingId && !resume) return null;
  const source = params.get('record_source');
  const text = (key: string) => params.get(key)?.slice(0, 200) ?? '';
  const number = (key: string) => /^\d{1,10}(?:\.\d{1,8})?$/.test(text(key)) ? text(key) : '';
  const page = Number(params.get('page') ?? 0);
  return {
    filters: {
      ...DEFAULT_FILTERS,
      company: company?.slice(0, 200) || (resume ? text('company_exact') || text('company') : ''),
      exactCompany: Boolean(company || (resume && text('company_exact'))),
      building: buildingId ? text('buildingName') || '指定楼宇' : resume ? text('building') : '',
      buildingId: buildingId && BROKER_ID.test(buildingId) ? buildingId : undefined,
      yearFrom: resume ? number('year_from') : '',
      yearTo: resume ? number('year_to') : '',
      source: resume && (source === 'live' || source === 'history') ? source : '',
      areaMin: resume ? number('area_min') : '',
      areaMax: resume ? number('area_max') : '',
    },
    page: resume && Number.isSafeInteger(page) && page >= 0 && page <= 10000 ? page : 0,
    detail: resume ? params.get('detail')?.slice(0, 150) ?? null : null,
  };
}

export function readSavedHistory(storage: Storage, key: string, allowArchive: boolean) {
  try {
    const stored = storage.getItem(key);
    if (!stored) return null;
    const params = new URLSearchParams(stored);
    // Only explicit user criteria are stored, never results or credentials.
    const context = readHistoryContext(params);
    if (context && !allowArchive && context.filters.source === 'history') context.filters.source = '';
    return context;
  } catch { return null; }
}
