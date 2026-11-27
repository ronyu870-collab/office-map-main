import { expect, it, vi } from 'vitest';
import type { PitchContext, PitchDependencies } from '../data/store';
import { STUDIO_THEME } from '../design/theme';
import { STUDIO_TEMPLATE } from '../templates/registry';
import { id, period } from '../proposals/__tests__/fixture';
import { handleAiRequest } from './http';
import { createProposalTaskFixture } from './proposal-task-fixture';

const fixture = vi.hoisted(() => ({ rpc: vi.fn(), context: vi.fn(), authorize: vi.fn() }));
vi.mock('../data/store', async original => ({ ...await original<typeof import('../data/store')>(),
  pitchRpc: fixture.rpc, authorizePitch: fixture.authorize }));
vi.mock('../business/adapter', async original => ({ ...await original<typeof import('../business/adapter')>(), loadUnifiedPitchContext: fixture.context }));
vi.mock('@/src/lib/intelligence/query/serverAuthority', async original => ({ ...await original<typeof import('@/src/lib/intelligence/query/serverAuthority')>(),
  loadDataAuthority: async () => ({ grants: ['query:quarter', 'export:internal'], fields: ['netEffectiveRent', 'totalArea', 'vacantArea'],
    permissionRevision: 'authorized/1', policyVersion: 'formal/1' }) }));
vi.mock('@/src/lib/intelligence/query/snapshotReader', async original => ({ ...await original<typeof import('@/src/lib/intelligence/query/snapshotReader')>(),
  readQuerySnapshots: async () => [{ rows: [{ id: id(41), name: '隔离商务大厦', dimensions: { submarket: { value: '燕莎' }, grade: { value: 'A' } } }] }] }));
vi.mock('@/src/lib/intelligence/query/availablePeriods', () => ({ readAvailablePeriodGroups: async () => ({ periods: [{ year: 2026, quarter: 2 }] }) }));
vi.mock('../visual-data/photos', () => ({ getBuildingPhotoChoices: async () => [] }));
vi.mock('../visual-data/derived-assets', () => ({ readPitchLocation: async () => null }));

it('uses the normal AI HTTP actions to review and persist the exact unified pages once', async () => {
  const parentId = id(42), taskId = id(43), date = '2026-06-30';
  const scope = { organizationId: 'isolated', region: '华北', city: '北京', businessLine: 'office' };
  const actor = { client: {}, identity: { actorId: id(44) }, signal: new AbortController().signal } as PitchContext;
  fixture.authorize.mockResolvedValue(actor);
  let resultNumber = 46;
  const field = (value: string | number, unit: string | null = null) => ({ value, unit, state: 'valid', permission: 'authorized', disclosure: 'internal' });
  const binding = { domain: 'quarter', dataVersion: 'reviewed/1', dataAsOf: date, permissionRevision: 'authorized/1', policyVersion: 'formal/1', disclosure: 'internal' };
  fixture.context.mockImplementation(async () => {
    const resultId = id(resultNumber++);
    return { protocol: 'unified-pitch-context/1', request: { city: '北京', submarkets: [] }, period, capturedAt: date + 'T09:00:00Z',
      disclosure: 'internal', isTestData: false, fingerprint: 'isolated/1', bindings: [binding],
      results: [{ id: 'selected-buildings', entityId: '北京', binding, result: { resultId, snapshotId: resultId, operation: 'list',
        parameters: {}, table: { id: 'verified', columns: [], rows: [] }, sources: [], scopeFingerprint: 'scope/1', registryVersion: 'formal/1' } }],
      buildings: [{ buildingId: id(41), name: '隔离商务大厦', static: { name: field('隔离商务大厦'), submarket: field('燕莎'), grade: field('A'),
        address: field('隔离场地'), standardFloorArea: field(1500, 'm2') },
        quarter: { netEffectiveRent: field(210, 'CNY/m2/month'), vacancy: field(0.08, 'ratio') } }] };
  });
  const projects = new Map<string, { parentId: string; slides: unknown[] }>([[parentId, { parentId, slides: [] }]]);
  const writes: Record<string, unknown>[] = [];
  const tasks = createProposalTaskFixture(command => {
    const slides = command.slides as {
      slideId: string; assetId: string; assetVersion: number; content: unknown; scene: unknown;
    }[];
    writes.push(command);
    projects.set(String(command.projectId), { parentId: String(command.parentProjectId), slides: slides.map(slide => ({ id: slide.slideId, asset_id: slide.assetId, asset_version: slide.assetVersion,
      template_id: 'business-content', template_version: 1, content: slide.content, scene: slide.scene })) });
  });
  fixture.rpc.mockImplementation(async (_actor, command) => {
    if (command.action === 'catalog') return { scopes: [{ ...scope, canGenerate: true, canClientExport: false, canExternalAi: false }] };
    if (command.action === 'registry') return { template: { config: STUDIO_TEMPLATE }, theme: { definition: STUDIO_THEME } };
    if (command.action === 'workspace_get') {
      const current = projects.get(command.projectId);
      if (!current) throw new Error('PITCH_DENIED');
      return { project: { id: command.projectId, parent_project_id: current.parentId, title: '隔离项目', version: 1, theme_id: STUDIO_THEME.id,
        theme_version: STUDIO_THEME.version, organization_id: scope.organizationId, region: scope.region, city: scope.city, business_line: scope.businessLine },
        slides: current.slides, workspace: { context: {}, page_settings: {}, active_slide: null }, history: [], tasks: [], exports: [] };
    }
    if (command.action === 'business_generation') return {};
    if (command.action.startsWith('workspace_proposal_')) return tasks.rpc(command);
    throw new Error(`Unexpected action ${command.action}`);
  });

  const call = (payload: Record<string, unknown>) => handleAiRequest(new Request('https://pitch.test/api/intelligence/pitch/ai', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://pitch.test' }, body: JSON.stringify(payload),
  }), {} as PitchDependencies, tasks.schedule);
  const request = { question: '制作隔离商务大厦的项目推介，使用2026年二季度', projectId: parentId, buildingIds: [id(41)] };
  const reviewResponse = await call({ action: 'proposal_plan', input: request });
  const review = await reviewResponse.json();
  expect(reviewResponse.status).toBe(200);
  expect(review).toMatchObject({ status: 'ready', plan: { slides: expect.arrayContaining([expect.objectContaining({ pageKind: 'leasing-evidence' })]) } });
  expect(review).not.toHaveProperty('queryReceipts');
  const confirmation = { projectId: parentId, expectedVersion: 1, request, taskId, planId: review.plan.id, contextFingerprint: review.plan.contextFingerprint };
  const command = { action: 'proposal_generate', confirmation };
  const generated = await call(command);
  expect(generated.status).toBe(200);
  expect(await generated.json()).toEqual({ state: 'queued', taskId });
  expect(writes).toHaveLength(0);
  await tasks.finish();
  const receipt = await (await call(command)).json();
  expect(receipt).toMatchObject({ state: 'completed', taskId });
  expect(writes[0]).toMatchObject({ expectedParentVersion: 1, reviewedPlanId: review.plan.id,
    snapshots: [expect.objectContaining({ binding })], slides: expect.arrayContaining([expect.objectContaining({
      content: expect.objectContaining({ blocks: expect.arrayContaining([expect.objectContaining({ kind: 'metric', value: 210 })]) }),
    })]) });
  expect(await (await call(command)).json()).toEqual(receipt);
  expect(writes).toHaveLength(1);
  expect(fixture.context).toHaveBeenCalledTimes(2);
}, 20_000);
