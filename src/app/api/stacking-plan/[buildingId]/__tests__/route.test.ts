import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  resolveIdentity: vi.fn(),
  sessionGuard: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/src/lib/server/impersonationAuth', () => ({
  IMPERSONATION_REQUEST_HEADER: 'x-colliers-impersonate-user',
  resolveEffectiveRequestIdentity: mocks.resolveIdentity,
}));
vi.mock('@/src/lib/intelligence/adminSession', () => ({
  createAdminSessionGuard: mocks.sessionGuard,
}));

import { GET, PATCH, POST } from '../route';

const ID = '9ee3e3ff-4845-41a1-a78f-390c11b1917a';
const SPACE = '11111111-1111-4111-8111-111111111111';
const req = (method = 'GET', body?: unknown, headers?: Record<string, string>) =>
  new NextRequest(`http://localhost/api/stacking-plan/${ID}`, {
    method, headers: { Authorization: 'Bearer testing', 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const params = { params: Promise.resolve({ buildingId: ID }) };
const identity = (role: string, impersonating = false) => ({
  identity: { caller: { id: 'tester' }, callerRole: role, effectiveRole: role, isImpersonating: impersonating },
});

describe('Stacking Plan identity and read/write boundary', () => {
  const guard = vi.fn(async () => undefined);
  const source = { id: 'src', source_as_of: null, review_state: 'pending_source_date',
    evidence_storage_path: null, evidence_sha256: null, evidence_filename: null, evidence_mime: null };
  const sourceRecord = { eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: source, error: null })) })) };
  const sources = { select: vi.fn((selection: string) =>
    selection.startsWith('id,building_id')
      ? { eq: vi.fn(async () => ({ data: [source], error: null })) }
      : { eq: vi.fn(() => sourceRecord) }
  ) };
  const towers = { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [], error: null })) })) })) };
  const buildings = { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: ID, name: '霄云路33号' }, error: null })) })) })) };
  const insert = vi.fn(async () => ({ error: null }));
  const exportsTable = { insert };
  const rpc = vi.fn(async () => ({ data: { id: SPACE, revision: 2, notes: '更新' }, error: null }));
  const upload = vi.fn(async () => ({ data: { path: 'private' }, error: null }));
  const download = vi.fn(async () => ({ data: new Blob(['test']), error: null }));
  const getBucket = vi.fn(async () => ({ data: { public: false }, error: null }));
  const createBucket = vi.fn(async () => ({ data: { name: 'stacking-plan-evidence' }, error: null }));
  const storage = { getBucket, createBucket, from: vi.fn(() => ({ upload, download })) };
  const db = { storage, from: vi.fn((table: string) => {
    if (table === 'buildings') return buildings;
    if (table === 'stacking_plan_sources') return sources;
    if (table === 'stacking_plan_towers') return towers;
    if (table === 'stacking_plan_export_events') return exportsTable;
    throw new Error('Unexpected table ' + table);
  }), rpc };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-service-secret';
    mocks.createClient.mockReturnValue(db);
    mocks.sessionGuard.mockResolvedValue(guard);
    mocks.resolveIdentity.mockResolvedValue(identity('admin'));
  });

  it.each(['viewer', 'editor', 'unknown'])('rejects %s before reading privileged tables', async role => {
    mocks.resolveIdentity.mockResolvedValue(identity(role));
    const response = await GET(req(), params);
    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rejects impersonation even if caller and target say admin', async () => {
    mocks.resolveIdentity.mockResolvedValue(identity('admin', true));
    expect((await GET(req(), params)).status).toBe(403);
    expect((await POST(req('POST', { action: 'export', format: 'xlsx' }), params)).status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects the impersonation header even when identity resolution reports admin', async () => {
    expect((await GET(req('GET', undefined, { 'x-colliers-impersonate-user': 'another-user' }), params)).status).toBe(403);
  });

  it('keeps the unconfirmed source date in its authorized read response', async () => {
    const response = await GET(req(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const payload = await response.json();
    expect(payload.sources[0].source_as_of).toBeNull();
    expect(payload.towers).toEqual([]);
    expect(guard).toHaveBeenCalled();
  });

  it('keeps the date-confirmed unverified source visible until the additive evidence migration is deployed', async () => {
    sources.select.mockImplementationOnce((() => ({
      eq: vi.fn(async () => ({ data: null, error: { code: '42703', message: 'column does not exist' } })),
    })) as never);
    const response = await GET(req(),params);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.sources[0].source_as_of).toBeNull();
    expect(result.sources[0].evidence_storage_path).toBeNull();
    expect(result.basis).toBe('source_snapshot_unverified');
    expect(sources.select).toHaveBeenCalledTimes(2);
  });

  it('rejects non-whitelisted patches before RPC', async () => {
    const response = await PATCH(req('PATCH', {
      space_id: SPACE, expected_revision: 1, patch: { verification_status: 'verified' },
    }), params);
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('writes a checked admin draft with the expected version and returns the revised row', async () => {
    const response = await PATCH(req('PATCH', {
      space_id: SPACE, expected_revision: 1, patch: { notes: '更新' },
    }), params);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('stacking_plan_space_save', expect.objectContaining({
      p_space_id: SPACE, p_building_id: ID, p_expected_revision: 1,
    }));
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it('rejects non-admin evidence uploads before accessing private Storage', async () => {
    mocks.resolveIdentity.mockResolvedValue(identity('viewer'));
    const response = await POST(req('POST', { action: 'source_evidence' }), params);
    expect(response.status).toBe(403);
    expect(getBucket).not.toHaveBeenCalled();
  });

  it('rejects missing evidence and invalid original download requests without touching storage', async () => {
    const form = new FormData();
    form.set('source_id','src');
    const request = new NextRequest('http://localhost/api/stacking-plan/' + ID, {
      method:'POST',headers:{Authorization:'Bearer testing'},body:form,
    });
    expect((await POST(request,params)).status).toBe(400);
    const downloadRequest = new NextRequest('http://localhost/api/stacking-plan/' + ID + '?original=src', {
      headers:{Authorization:'Bearer testing'},
    });
    expect((await GET(downloadRequest,params)).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it('accepts a valid administrator original file and binds it to the source with an audited RPC', async () => {
    const form = new FormData();
    form.set('source_id', 'src');
    const pngSignature = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
    form.set('file', new File([pngSignature], 'source.png', { type:'image/png' }));
    const request = new NextRequest('http://localhost/api/stacking-plan/' + ID, {
      method:'POST',headers:{Authorization:'Bearer testing'},body:form,
    });
    const result = await POST(request,params);
    expect(result.status).toBe(200);
    expect(getBucket).toHaveBeenCalledWith('stacking-plan-evidence');
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining(ID + '/src/'),
      expect.anything(),
      expect.objectContaining({ contentType:'image/png',upsert:false }),
    );
    expect(rpc).toHaveBeenCalledWith('stacking_plan_source_attach', expect.objectContaining({
      p_building_id: ID, p_source_id:'src', p_actor:'tester',
      p_mime:'image/png', p_size:12,
    }));
    expect(guard).toHaveBeenCalledTimes(3);
  });

  it('checks export authorization and records only a valid explicit export intent', async () => {
    expect((await POST(req('POST', { action: 'export', format: 'pdf' }), params)).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
    expect((await POST(req('POST', { action: 'export', format: 'xlsx' }), params)).status).toBe(200);
    expect(insert).toHaveBeenCalledWith({ building_id: ID, actor_id: 'tester', export_format: 'xlsx' });
  });
});
