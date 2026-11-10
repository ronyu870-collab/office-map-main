const base = ['auth', 'json', 'handler'];
const routePhases = new Map([
  ['/api/map/data', [...base, 'database', 'overrides', 'photos', 'brochures']],
  ['/api/oss', [...base, 'object-list', 'sign', 'audit']],
  ['/api/lease-transactions/read', [...base, 'database']],
  ['/api/intelligence/recommend', [...base, 'vocabulary', 'candidates', 'model', 'rank', 'audit']],
  ['/api/admin/users', [...base, 'profiles', 'auth-directory', 'stock-assignments', 'future-assignments']],
]);

export function isMeasuredApi(pathname) {
  return routePhases.has(pathname);
}

// Accept only exact app metrics with bounded numeric durations. Never retain
// the raw header, descriptions, platform metrics, or unrecognized names.
export function parseServerTiming(pathname, header) {
  const allowed = routePhases.get(pathname);
  if (!allowed || !header || header.length > 4096) return null;
  const values = {};
  for (const entry of header.split(',')) {
    const match = /^colliers-([a-z-]+);dur=(\d{1,6}(?:\.\d{1,3})?)$/.exec(entry.trim());
    if (match && allowed.includes(match[1]) && !Object.hasOwn(values, match[1])) values[match[1]] = Number(match[2]);
  }
  return Object.keys(values).length ? values : null;
}
