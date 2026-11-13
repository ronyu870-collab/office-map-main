import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ParsedRequirement } from '@/src/lib/intelligence/requirementSchema';

const fixture = vi.hoisted(() => ({
  identity: vi.fn(), access: vi.fn(), profiles: vi.fn(), authDirectory: vi.fn(), catalog: vi.fn(),
  evidence: vi.fn(), model: vi.fn(), insert: vi.fn(),
}));
vi.mock('@/src/lib/server/impersonationAuth', () => ({ resolveEffectiveRequestIdentity: fixture.identity }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { admin: { listUsers: fixture.authDirectory } },
  from: (table: string) => ({ select: () => table === 'user_roles' ? { order: fixture.profiles }
    : Promise.resolve({ data: [{ user_id: 'admin', record_year: 2099, record_quarter: 1 }], error: null }) }),
}) }));
vi.mock(import('@/src/lib/intelligence/serverContext'), async importOriginal => ({
  ...await importOriginal(),
  requireIntelligenceAccess: fixture.access,
}));
vi.mock(import('@/src/lib/intelligence/recommendationServer'), async importOriginal => ({
  ...await importOriginal(),
  loadRecommendationCatalog: fixture.catalog,
  loadRecommendationEvidence: fixture.evidence,
}));
vi.mock('@/src/lib/intelligence/deepSeekRequirementParser', () => ({
  IntelligenceAIError: class extends Error {}, parseRequirementWithDeepSeek: fixture.model,
}));

import { GET as listUsers } from '@/src/app/api/admin/users/route';
import { POST as recommend } from '@/src/app/api/intelligence/recommend/route';

const phases = (response: Response) => (response.headers.get('server-timing') ?? '').split(', ')
  .map(entry => entry.match(/^colliers-([a-z-]+);dur=\d+\.\d$/)?.[1]).sort();
const requirement = '只用合成条件在北京找办公楼';
const parsed: ParsedRequirement = {
  city: '北京', locations: [], area: { minSqm: null, maxSqm: null },
  rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' }, moveInMonth: null,
  grades: [], metro: { preferred: false, maxDistanceMeters: null }, greenCertifications: [], otherPreferences: [], unresolved: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PERF_ISOLATED_SERVER_TIMING', 'preview');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://synthetic.invalid');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic');
});
afterEach(() => vi.unstubAllEnvs());

it('separates the admin directory dependencies while preserving the real role gate and assignment counts', async () => {
  const request = new NextRequest('https://example.test/api/admin/users');
  fixture.identity.mockResolvedValueOnce({ identity: { effectiveRole: 'viewer' } });
  const denied = await listUsers(request);
  expect(denied.status).toBe(403);
  expect(denied.headers.get('server-timing')).toBeNull();
  expect(fixture.profiles).not.toHaveBeenCalled();
  fixture.identity.mockResolvedValueOnce({ identity: { effectiveRole: 'admin', caller: { id: 'admin' } } });
  fixture.profiles.mockResolvedValueOnce({ data: [{ user_id: 'admin', role: 'admin' }], error: null });
  fixture.authDirectory.mockResolvedValueOnce({ data: { users: [{ id: 'admin', email: 'test@example.test' }] }, error: null });
  const result = await listUsers(request);
  expect(result.status).toBe(200);
  expect((await result.json()).users).toMatchObject([{ email: 'test@example.test', stock_assignment_count: 1, future_assignment_count: 1 }]);
  expect(phases(result)).toEqual(['auth', 'auth-directory', 'future-assignments', 'handler', 'json', 'profiles', 'stock-assignments']);
});

it('requires access and the catalog before calling the model, then waits for evidence before returning results', async () => {
  const request = () => new NextRequest('https://example.test/api/intelligence/recommend', {
    method: 'POST', body: JSON.stringify({ requirement }),
  });
  fixture.access.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
  const denied = await recommend(request());
  expect(denied.status).toBe(403);
  expect(denied.headers.get('server-timing')).toBeNull();
  expect(fixture.catalog).not.toHaveBeenCalled();
  expect(fixture.evidence).not.toHaveBeenCalled();
  expect(fixture.model).not.toHaveBeenCalled();

  fixture.access.mockResolvedValueOnce({ caller: { id: 'admin' }, catalogScope: 'authorized-fixture', client: { from: () => ({ insert: fixture.insert }) } });
  const vocabulary = { districts: [], submarkets: [], grades: [] };
  let releaseCatalog!: (catalog: { buildings: []; vocabulary: typeof vocabulary }) => void;
  let releaseEvidence!: (evidence: { metrics: []; brochures: []; latestMetricPeriod: string }) => void;
  fixture.catalog.mockImplementationOnce(() => new Promise(resolve => { releaseCatalog = resolve; }));
  fixture.evidence.mockImplementationOnce(() => new Promise(resolve => { releaseEvidence = resolve; }));
  fixture.model.mockResolvedValueOnce({ parsed, meta: { model: 'synthetic', durationMs: 0, inputTokens: 1, outputTokens: 2 } });
  fixture.insert.mockResolvedValueOnce({ error: null });
  let settled = false;
  const pending = recommend(request()).then(response => {
    settled = true;
    return response;
  });
  await vi.waitFor(() => {
    expect(fixture.catalog).toHaveBeenCalledOnce();
    expect(fixture.evidence).toHaveBeenCalledOnce();
  });
  expect(fixture.model).not.toHaveBeenCalled();
  releaseCatalog({ buildings: [], vocabulary });
  await vi.waitFor(() => expect(fixture.model).toHaveBeenCalledWith(
    requirement, { districts: [], submarkets: [], grades: [] }, expect.any(AbortSignal),
  ));
  expect(settled).toBe(false);
  expect(fixture.insert).not.toHaveBeenCalled();
  releaseEvidence({ metrics: [], brochures: [], latestMetricPeriod: '2026 Q3' });
  const result = await pending;
  expect(result.status).toBe(200);
  expect((await result.json()).meta).toMatchObject({ universeCount: 0, returnedCount: 0, latestMetricPeriod: '2026 Q3' });
  expect(fixture.insert).toHaveBeenCalledOnce();
  expect(fixture.insert).toHaveBeenCalledWith(expect.objectContaining({ action_type: 'AI_RECOMMENDATION' }));
  expect(JSON.stringify(fixture.insert.mock.calls)).not.toContain(requirement);
  expect(phases(result)).toEqual(['audit', 'auth', 'candidates', 'handler', 'json', 'model', 'rank', 'vocabulary']);
});
