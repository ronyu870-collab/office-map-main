export const BROKER_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function mapBuildingHref(id: string, options: { future?: boolean; section?: 'brochure' | 'availability' | 'deals'; back?: string } = {}) {
  const params = new URLSearchParams({ [options.future ? 'future' : 'building']: id });
  if (options.section) params.set('section', options.section);
  if (options.back) params.set('back', options.back);
  return `/map?${params}`;
}

export function dealHistoryHref(filter: { company: string } | { id: string; name: string }, back?: string) {
  const params = 'company' in filter
    ? new URLSearchParams({ exactCompany: filter.company })
    : new URLSearchParams({ buildingId: filter.id, buildingName: filter.name });
  if (back) params.set('back', back);
  return `/lease-submission/history?${params}`;
}

export function brokerReturn(value: string | null | undefined): string | undefined {
  if (!value || value.length > 3000 || !/^\/(map|search|lease-submission\/history)(\?|$)/.test(value) || /[\\\u0000-\u001f]/.test(value)) return;
  return value;
}
