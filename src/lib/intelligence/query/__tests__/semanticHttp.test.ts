import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptAuditContent } from '../auditCrypto';
import { queryReplySchema } from '@/src/services/trustedQueryClient';
import type { AuditKeys } from '../auditStore';
import type { Quarter } from '../contracts';

const identityState = vi.hoisted(() => ({
  actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', effectiveUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', modelConfigured: false, modelIntent: null as unknown,
}));
vi.mock('../serverAuthority', async importOriginal => ({
  ...await importOriginal<typeof import('../serverAuthority')>(),
  verifyQueryIdentity: vi.fn(async () => ({ actorId: identityState.actorId, effectiveUserId: identityState.effectiveUserId,
    sessionId: identityState.sessionId, expiresAt: Date.now() + 60000 })),
}));
vi.mock('../modelIntent', async importOriginal => ({
  ...await importOriginal<typeof import('../modelIntent')>(),
  semanticModelConfigured: () => identityState.modelConfigured,
  understandWithModel: vi.fn(async () => ({ intent: identityState.modelIntent, usage: { model: 'synthetic-intent', inputTokens: 30, outputTokens: 40, calls: 1 } })),
}));
import { handleQuerySubmission } from '../http';
import { understandWithModel } from '../modelIntent';

const keys: AuditKeys = { keyId: 'semantic-http-fixture', encryptionKey: new Uint8Array(32).fill(31), digestKey: new Uint8Array(32).fill(32) };
type RpcArgs = Record<string, unknown>;
type Event = { request_id: string; event_id: string; sequence: number; kind: string; cipher: unknown };
type Stream = { actor: string; effective: string; digest: string; state: string; events: Event[] };
type Submission = { idempotencyKey: string; question: string; conversation: { id: string; parentRequestId?: string } };
const quarters: Quarter[] = [{ year: 2025, quarter: 4 }, { year: 2026, quarter: 1 }, { year: 2026, quarter: 2 }, { year: 2026, quarter: 3 }];
const quarterKey = (p: Quarter) => `${p.year}Q${p.quarter}`;

/** An in-memory RPC contract fixture, not a database/auth/RLS integration claim.
 * The HTTP router, audit encryption/store, context decoder, planner, snapshot
 * normalization, executor, deterministic calculations and delivery sealing are real. */
function harness() {
  const streams = new Map<string, Stream>();
  const config = { revision: 'a'.repeat(64), enabled: true, allSubmarkets: true, submarkets: ['CBD', '金融街'],
    fields: ['height', 'floors', 'parking', 'totalArea', 'vacantArea', 'netEffectiveRent'],
    failRpc: null as string | null, failKind: null as string | null, modelBudget: true, available: [...quarters],
    availableByFields: {} as Record<string, Quarter[]>,
    afterAppend: null as ((kind: string) => void) | null, afterContextRead: null as (() => void) | null };
  const result = (data: unknown) => ({ data, error: null });
  const failure = (code = 'XX000', message = 'synthetic service failure') => ({ data: null, error: { code, message } });
  function receipt(event: Event, replayed = false) { return result({ event_id: event.event_id, sequence: event.sequence, event_hash: 'b'.repeat(64), replayed }); }
  function append(args: RpcArgs, kind: string, stream: Stream) {
    const event: Event = { request_id: args.p_request_id as string, event_id: args.p_event_id as string,
      sequence: stream.events.length + 1, kind, cipher: args.p_cipher };
    stream.events.push(event);
    if (['received', 'running', 'succeeded', 'denied', 'failed', 'cancelled'].includes(kind)) stream.state = kind;
    config.afterAppend?.(kind);
    return receipt(event);
  }
  const rpc = vi.fn((name: string, args: RpcArgs) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (name === config.failRpc || (name === 'ai_query_audit_append' && args.p_kind === config.failKind)) return failure();
    if (name === 'ai_query_record_intake' || name === 'ai_query_record_ingress') return result({});
    if (name === 'ai_query_audit_receive') {
      const id = args.p_request_id as string, old = streams.get(id);
      if (old) return old.digest === args.p_payload_digest ? receipt(old.events[0], true) : failure('22023', 'audit idempotency conflict');
      const stream: Stream = { actor: args.p_actor as string, effective: args.p_effective as string, digest: args.p_payload_digest as string, state: 'received', events: [] };
      streams.set(id, stream); return append(args, 'received', stream);
    }
    if (name === 'ai_query_audit_append') {
      const stream = streams.get(args.p_request_id as string);
      return stream ? append(args, args.p_kind as string, stream) : failure();
    }
    if (name === 'ai_query_authority') return config.enabled ? result({ allowed: true, access_policy: 'admin-only/1',
      actor_id: args.p_actor, effective_user_id: args.p_effective, session_id: args.p_session,
      policy_version: 'synthetic-policy/1', permission_revision: config.revision,
      capabilities: ['query:catalog', 'query:quarter', 'query:brochure'], fields: config.fields,
      all_submarkets: config.allSubmarkets, submarkets: config.submarkets, all_buildings: true, building_ids: [],
    }) : result({ allowed: false });
    if (name === 'ai_query_context_read') {
      const stream = streams.get(args.p_request_id as string);
      if (!config.enabled || !stream || stream.actor !== args.p_actor || stream.effective !== args.p_effective) return result({ allowed: false });
      const read = result({ allowed: true, state: stream.state, permission_revision: config.revision,
        events: stream.events.filter(event => ['received', 'running', 'tool_finished', 'denied'].includes(event.kind)) });
      config.afterContextRead?.();
      return read;
    }
    if (name === 'ai_query_available_periods') return result({ version: 'authorized-periods/1', permission_revision: config.revision,
      read_at: '2026-11-15T10:00:00Z', inventory_time: 'current_catalog', fields: args.p_fields, truncated: false,
      periods: config.availableByFields[(args.p_fields as string[]).join(',')] ?? config.available });
    if (name === 'ai_query_quarterly_coverage') {
      const year = args.p_year as number, quarter = args.p_quarter as number;
      const pending = year === 2026 && quarter === 3;
      const count = pending ? 2 : 0;
      return result({
        version: 'quarterly-source-coverage/1', permission_revision: config.revision, year, quarter,
        fields: args.p_fields, read_at: '2026-11-20T00:00:00Z', database_snapshot: 'fixture-snapshot',
        catalog_buildings: 2,
        formal: { source: 'building_metrics', rows: 0, buildings: 0, valid_buildings: 0,
          unlocked_rows: 0, draft_rows: 0, incomplete_lock_evidence: 0, locked_draft_conflicts: 0,
          duplicate_metric_rows: 0 },
        submitted: { source: 'quarterly_submissions', rows: pending ? 3 : 0, buildings: count,
          latest_rows: count, superseded_rows: pending ? 1 : 0, latest_field_complete: count,
          zero_area_latest: 0, missing_rent_latest: 0, submitted_outside_calendar_quarter: 0 },
        overlap: { buildings: 0, conflicting_values: 0 },
      });
    }
    if (name === 'ai_query_model_budget') return result({ allowed: config.modelBudget });
    if (name === 'ai_query_snapshot_read') {
      const fields = args.p_fields as string[], periods = args.p_periods as Quarter[];
      const markets = args.p_submarkets as string[] | null;
      const definitions = [{ id: '10000000-0000-4000-8000-000000000001', name: 'CBD合成楼宇', submarket: 'CBD', rent: 100 },
        { id: '10000000-0000-4000-8000-000000000002', name: '金融街合成楼宇', submarket: '金融街', rent: 200 }];
      const quarterFields = fields.filter(field => ['netEffectiveRent', 'vacantArea', 'totalArea'].includes(field));
      const brochureFields = fields.filter(field => !quarterFields.includes(field));
      const rows = definitions.filter(row => !markets || markets.includes(row.submarket)).map(row => ({
        id: row.id, name: row.name, submarket: row.submarket, grade: 'A', is_active: true, tracking_scope: 'tracked', version: 'c'.repeat(64),
        metrics: quarterFields.length ? periods.filter(p => config.available.some(value => quarterKey(value) === quarterKey(p))).map(p => ({
          id: `${row.id}/${quarterKey(p)}`, year: p.year, quarter: p.quarter, version: 'd'.repeat(64), recorded_at: '2026-10-01T00:00:00Z',
          values: Object.fromEntries(quarterFields.map(field => [field, String(field === 'netEffectiveRent' ? row.rent + p.quarter : field === 'vacantArea' ? 1000 : 10000)])),
        })) : [],
        brochures: brochureFields.length ? [{ id: `${row.id}/brochure`, version: 'e'.repeat(64), recorded_at: null,
          values: Object.fromEntries(brochureFields.map(field => [field, '100'])) }] : [],
      }));
      return result({ snapshot_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', database_snapshot: 'synthetic-consistent-snapshot', read_at: '2026-11-15T10:00:00Z',
        expected_count: rows.length, complete: true, fields, periods, inventory_time: 'current_catalog', brochure_selection: 'all_unresolved_record_candidates', rows });
    }
    throw new Error(`Unexpected fixture RPC ${name}`);
  } }));
  const dependencies = { client: { rpc } as unknown as SupabaseClient, enabled: true, keys };
  const submit = async (body: Submission | Record<string, unknown>, headers: Record<string, string> = {}) => {
    const response = await handleQuerySubmission(new Request('https://synthetic.invalid/api/intelligence/query', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-session', ...headers }, body: JSON.stringify(body) }), dependencies);
    const wire = new Uint8Array(await response.arrayBuffer());
    const decodedBytes = response.headers.get('content-encoding') === 'gzip' ? gunzipSync(wire) : wire;
    return { status: response.status, headers: response.headers, body: JSON.parse(new TextDecoder().decode(decodedBytes)), wire, decodedBytes };
  };
  const calls = (name: string) => rpc.mock.calls.filter(([rpcName]) => rpcName === name);
  const decoded = (requestId: string, kind: string) => {
    const stream = streams.get(requestId)!;
    return stream.events.filter(event => event.kind === kind).map(event => JSON.parse(decryptAuditContent(event.cipher,
      { requestId, eventId: event.event_id, actorId: stream.actor, effectiveUserId: stream.effective }, new Map([[keys.keyId, keys.encryptionKey]]))).content as Record<string, unknown>);
  };
  return { submit, config, calls, decoded, streams, rpc };
}
const input = (question: string, conversationId: string = randomUUID(), parentRequestId?: string): Submission => ({ idempotencyKey: randomUUID(), question,
  conversation: { id: conversationId, ...(parentRequestId ? { parentRequestId } : {}) } });

beforeEach(() => {
  identityState.actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; identityState.effectiveUserId = identityState.actorId;
  identityState.sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; identityState.modelConfigured = false; identityState.modelIntent = null;
  vi.mocked(understandWithModel).mockClear();
});

describe('P1 actual semantic HTTP and encrypted-context integration', () => {
  it('compresses a large authorized response without changing the decoded delivery digest or source evidence', async () => {
    const h = harness();
    const response = await h.submit(input('CBD、金融街净有效租金、空置率和季度总面积2025Q4至2026Q3按子市场和等级趋势各期样本'), { 'Accept-Encoding': 'gzip' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.wire.byteLength).toBeLessThan(response.decodedBytes.byteLength / 4);
    expect(response.headers.get('x-query-body-sha256')).toBe(createHash('sha256').update(response.decodedBytes).digest('hex'));
    expect(response.headers.get('x-query-delivery-token')).toBeTruthy();
    expect(response.body.result.parameters.executedPlan.operation).toBe('cross_trend');
    expect(response.body.result.sources.length).toBeGreaterThan(0);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
    expect(h.decoded(response.body.requestId, 'succeeded')).toHaveLength(1);
  });

  it('rejects client-supplied cross-trend axes before a fact read and records the denied request', async () => {
    const h = harness();
    const result = await h.submit({ idempotencyKey: randomUUID(), question: '合成交叉趋势执行回归', plan: {
      operation: 'cross_trend', metric: 'rent', metrics: ['rent', 'vacancy', 'totalArea'],
      scope: { inventory: 'tracked', submarkets: ['CBD', '金融街'] },
      start: quarters[2], end: quarters[3], mode: 'per_period', rowGroups: [{ value: 'ungranted' }],
    } });
    expect(result.status).toBe(403);
    expect(result.body.status).toBe('denied'); expect(result.body).not.toHaveProperty('result');
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    expect(understandWithModel).not.toHaveBeenCalled();
    expect(h.decoded(result.body.requestId, 'received')).toHaveLength(1);
    expect(h.decoded(result.body.requestId, 'denied')).toMatchObject([{ reason: 'authorization_or_plan_rejected' }]);
    for (const kind of ['running', 'tool_started', 'tool_finished', 'response_generated', 'succeeded'])
      expect(h.decoded(result.body.requestId, kind)).toHaveLength(0);
  });

  it('multi-metric latest resolves independent valid-period intersection, executes once and replays its original receipt', async () => {
    const h = harness();
    // No building has every metric at once in this metadata contract fixture;
    // each metric does have valid independent observations in Q3.
    h.config.availableByFields = {
      'netEffectiveRent,totalArea,vacantArea': [],
      'netEffectiveRent,totalArea': [quarters[2], quarters[3]],
      'totalArea,vacantArea': [quarters[3]],
    };
    const question = input('比较最新季度CBD、金融街净有效租金和空置率');
    const first = await h.submit(question);
    expect(first.status).toBe(200);
    expect(first.body.result.parameters.executedPlan).toMatchObject({ metrics: ['rent', 'vacancy'], period: quarters[3], operation: 'group_aggregate' });
    expect(first.body.result.parameters.availablePeriods).toMatchObject({ availabilityMethod: 'intersection_of_independently_valid_metric_periods', periods: [quarters[3]] });
    expect(first.body.result.parameters.interpretation.periodBasis).toContain('不强制跨指标共同样本');
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
    expect(h.calls('ai_query_snapshot_read')[0][1].p_fields).toEqual(['netEffectiveRent', 'totalArea', 'vacantArea']);
    expect(h.calls('ai_query_available_periods')).toHaveLength(2);
    h.config.availableByFields = {};
    h.config.available.push({ year: 2026, quarter: 4 });
    const replay = await h.submit(question);
    expect(replay.status).toBe(202);
    expect(replay.body.requestId).toBe(first.body.requestId);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
    expect(h.calls('ai_query_available_periods')).toHaveLength(2);
    expect(understandWithModel).not.toHaveBeenCalled();
  });
  it('multi-metric period lookup refuses an ungranted secondary field before any metadata or snapshot read', async () => {
    const h = harness(); h.config.fields = ['totalArea', 'netEffectiveRent'];
    const denied = await h.submit(input('最新季度CBD净有效租金和空置率'));
    expect(denied.status).toBe(403);
    expect(denied.body).not.toHaveProperty('result');
    expect(h.calls('ai_query_available_periods')).toHaveLength(0);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
  });
  it('multi-metric latest with no common period clarifies instead of discarding a metric or inventing values', async () => {
    const h = harness(); h.config.availableByFields = { 'netEffectiveRent,totalArea': [quarters[2]], 'totalArea,vacantArea': [quarters[3]] };
    const answer = await h.submit(input('最新季度CBD净有效租金和空置率'));
    expect(answer.status).toBe(422);
    expect(answer.body).not.toHaveProperty('result');
    expect(JSON.stringify(answer.body)).toContain('共同季度');
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
  });
  it('T01-T03 executes the four-turn CBD/financial-street comparison and data-anchored four-quarter trend', async () => {
    const h = harness(), conversation = randomUUID();
    const first = await h.submit(input('2026 年第三季度 CBD 的净有效租金是多少？', conversation));
    expect(first.status).toBe(200); expect(first.body.result.table.rows[0].cells.value.value.numeric).toBe(103);
    const second = await h.submit(input('金融街呢？', conversation, first.body.requestId));
    expect(second.status).toBe(200); expect(second.body.result.parameters.executedPlan).toMatchObject({ metric: 'rent', period: { year: 2026, quarter: 3 }, scope: { submarkets: ['金融街'] } });
    expect(second.body.result.table.rows[0].cells.value.value.numeric).toBe(203);
    const third = await h.submit(input('把这两个地区对比一下。', conversation, second.body.requestId));
    expect(third.status).toBe(200); expect(third.body.result.parameters.executedPlan.operation).toBe('group_aggregate');
    expect(third.body.result.table.rows).toHaveLength(2);
    const fourth = await h.submit(input('再看看过去四个季度的变化。', conversation, third.body.requestId));
    expect(fourth.status).toBe(200); expect(fourth.body.result.parameters.executedPlan).toMatchObject({ operation: 'group_trend',
      start: { year: 2025, quarter: 4 }, end: { year: 2026, quarter: 3 }, metric: 'rent', scope: { submarkets: ['CBD', '金融街'] } });
    expect(fourth.body.result.parameters.researchAnalysis.series).toHaveLength(2);
    for (const series of fourth.body.result.parameters.researchAnalysis.series) expect(series.overall.difference.exact).toEqual({ numerator: '-1', denominator: '1' });
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(4); expect(h.calls('ai_query_context_read')).toHaveLength(3);
    expect(understandWithModel).not.toHaveBeenCalled();
    expect(h.decoded(first.body.requestId, 'received')[0]).toMatchObject({ submittedText: '2026 年第三季度 CBD 的净有效租金是多少？', sessionId: identityState.sessionId, metadata: { conversation: { id: conversation } } });
    expect(h.decoded(fourth.body.requestId, 'tool_finished')[0]).toMatchObject({ plan: fourth.body.result.parameters.executedPlan });
    expect(fourth.headers.get('cache-control')).toBe('private, no-store'); expect(fourth.headers.get('x-query-delivery-token')).toBeTruthy();
  });

  it.each(['conversation', 'session', 'actor', 'effective', 'permission', 'fields', 'scope', 'missing'] as const)('T11 rejects a parent outside the current %s boundary before reading data', async boundary => {
    const h = harness(), question = input('2026Q3 CBD净有效租金'); const first = await h.submit(question); expect(first.status).toBe(200);
    let conversation = question.conversation.id, parent = first.body.requestId;
    if (boundary === 'conversation') conversation = randomUUID();
    if (boundary === 'session') identityState.sessionId = '99999999-9999-4999-8999-999999999999';
    if (boundary === 'actor') { identityState.actorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; identityState.effectiveUserId = identityState.actorId; }
    if (boundary === 'effective') identityState.effectiveUserId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    if (boundary === 'permission') h.config.revision = 'f'.repeat(64);
    if (boundary === 'fields') h.config.fields = ['height'];
    if (boundary === 'scope') { h.config.allSubmarkets = false; h.config.submarkets = ['金融街']; }
    if (boundary === 'missing') parent = randomUUID();
    const periodsBefore = h.calls('ai_query_available_periods').length;
    const next = await h.submit(input('金融街呢', conversation, parent));
    expect(next.status).toBe(403); expect(next.body).not.toHaveProperty('result');
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1); expect(h.calls('ai_query_available_periods')).toHaveLength(periodsBefore);
    expect(understandWithModel).not.toHaveBeenCalled();
  });

  it('T13 retries the original key without another availability, model or snapshot read', async () => {
    const h = harness(), question = input('最新季度 CBD净有效租金');
    const first = await h.submit(question); expect(first.status).toBe(200);
    h.config.available.push({ year: 2026, quarter: 4 });
    const retry = await h.submit(question);
    expect(retry.status).toBe(202); expect(retry.body.requestId).toBe(first.body.requestId);
    expect(h.calls('ai_query_available_periods')).toHaveLength(1); expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
    expect(h.decoded(first.body.requestId, 'running')).toHaveLength(1); expect(h.decoded(first.body.requestId, 'tool_finished')).toHaveLength(1);
    expect(understandWithModel).not.toHaveBeenCalled();
    const changed = await h.submit({ ...question, question: '金融街呢' }); expect(changed.status).toBe(409);
    expect(changed.body.requestId).not.toBe(first.body.requestId); expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
  });

  it('coalesces two concurrent submissions under the durable receipt before semantic preparation', async () => {
    const h = harness(), question = input('最新季度 CBD净有效租金');
    const results = await Promise.all([h.submit(question), h.submit(question)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 202]);
    expect(results[0].body.requestId).toBe(results[1].body.requestId);
    expect(h.calls('ai_query_available_periods')).toHaveLength(1); expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
  });

  it.each([
    { question: '查询净有效租金', reason: 'scope_required' },
    { question: 'CBD净有效租金', reason: 'period_required' },
    { question: 'CBD最贵的楼是哪栋？', reason: 'metric_required' },
    { question: 'CBD租赁成交情况', reason: 'unsupported' },
  ])('delivers $question over the actual 422 HTTP path and satisfies the browser response schema', async ({ question, reason }) => {
    const h = harness();
    const response = await h.submit(input(question));
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 'clarification', code: 'conditions_required', reason, message: expect.any(String) });
    expect(queryReplySchema.parse(response.body)).toMatchObject({ status: 'clarification', reason });
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    expect(understandWithModel).not.toHaveBeenCalled();
  });
  it('keeps a normal authorized factual query compatible with the same browser schema', async () => {
    const h = harness();
    const response = await h.submit(input('2026Q3 CBD净有效租金'));
    expect(response.status).toBe(200);
    expect(queryReplySchema.parse(response.body)).toMatchObject({ status: 'ready', requestId: response.body.requestId });
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
    expect(understandWithModel).not.toHaveBeenCalled();
  });
  it('reports a DeepSeek provider failure separately from incomplete conditions, with no business read', async () => {
    const h = harness(); identityState.modelConfigured = true;
    vi.mocked(understandWithModel).mockRejectedValueOnce(new Error('MODEL_PROVIDER_UNAVAILABLE'));
    const response = await h.submit(input('2026Q3CBD净有效租金水平怎么样'));
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ status: 'clarification', reason: 'unrecognized' });
    expect(response.body.message).toContain('DeepSeek 语义解析暂不可用');
    expect(queryReplySchema.parse(response.body).status).toBe('clarification');
    expect(understandWithModel).toHaveBeenCalledOnce();
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    expect(h.decoded(response.body.requestId, 'accounting')).toMatchObject([{ status: 'unavailable_or_invalid', attempts: 1 }]);
  });
  it('replays an audited clarification and carries each short answer through to a factual result', async () => {
    const h = harness(), question = input('CBD 最贵的楼是哪栋？');
    const first = await h.submit(question); expect(first.status).toBe(422);
    expect(first.body.options.map((option: { label: string }) => option.label)).toContain('净有效租金');
    const retry = await h.submit(question); expect(retry.status).toBe(422); expect(retry.body.options).toEqual(first.body.options);
    expect(h.calls('ai_query_available_periods')).toHaveLength(0); expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    const second = await h.submit(input('净有效租金', question.conversation.id, first.body.requestId)); expect(second.status).toBe(422);
    const third = await h.submit(input('最新季度', question.conversation.id, second.body.requestId));
    expect(third.status).toBe(200); expect(third.body.result.parameters.executedPlan).toMatchObject({ operation: 'rank', field: 'netEffectiveRent', period: { year: 2026, quarter: 3 }, scope: { submarkets: ['CBD'] } });
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
  });

  it('T11 refuses old available-quarter clarification when authorization narrows after preparation but catalog access remains', async () => {
    const h = harness();
    h.config.afterAppend = kind => {
      if (kind !== 'denied') return;
      h.config.revision = 'f'.repeat(64); h.config.allSubmarkets = false; h.config.submarkets = ['金融街'];
    };
    const response = await h.submit(input('CBD净有效租金'));
    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('options'); expect(response.body).not.toHaveProperty('result');
    expect(response.headers.get('x-query-delivery-token')).toBeNull();
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    expect(h.calls('ai_query_available_periods')).toHaveLength(1);
    const denied = h.decoded(response.body.requestId, 'denied')[0];
    expect(denied.response).toMatchObject({ options: [expect.objectContaining({ label: '最新季度（2026Q3）' })] });
    expect(h.decoded(response.body.requestId, 'correction')).toContainEqual(expect.objectContaining({ delivery: 'not_sent', reason: 'authorization_changed_before_clarification' }));
    expect(h.decoded(response.body.requestId, 'delivery_receipt')).toHaveLength(0);
  });

  it('T11 also blocks clarification replay when its authorization changes after encrypted context read', async () => {
    const h = harness(), question = input('CBD净有效租金');
    const first = await h.submit(question); expect(first.status).toBe(422);
    expect(first.body.options[0].label).toBe('最新季度（2026Q3）');
    const deliveries = h.decoded(first.body.requestId, 'delivery_receipt').length;
    h.config.afterContextRead = () => {
      h.config.revision = 'f'.repeat(64); h.config.allSubmarkets = false; h.config.submarkets = ['金融街'];
    };
    const retry = await h.submit(question);
    expect(retry.status).toBe(403); expect(retry.body.requestId).toBe(first.body.requestId);
    expect(retry.body).not.toHaveProperty('options'); expect(retry.headers.get('x-query-delivery-token')).toBeNull();
    expect(h.decoded(first.body.requestId, 'delivery_receipt')).toHaveLength(deliveries);
    expect(h.decoded(first.body.requestId, 'correction')).toContainEqual(expect.objectContaining({ delivery: 'not_sent', reason: 'authorization_changed_before_clarification' }));
    expect(h.calls('ai_query_available_periods')).toHaveLength(1); expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
  });

  it('T14 executes the precise suggestion plan recovered from its authorized parent', async () => {
    const h = harness(), question = input('2026Q3 CBD净有效租金');
    const first = await h.submit(question); expect(first.status).toBe(200);
    const suggestion = first.body.result.parameters.suggestions.find((item: { id: string }) => item.id === 'same_period_vacancy');
    expect(suggestion).toBeDefined(); expect(suggestion).not.toHaveProperty('plan');
    const next = await h.submit(input(suggestion.question, question.conversation.id, first.body.requestId));
    expect(next.status).toBe(200); expect(next.body.result.parameters.executedPlan).toMatchObject({ operation: 'aggregate', metric: 'vacancy', period: { year: 2026, quarter: 3 }, scope: { submarkets: ['CBD'] } });
    expect(next.body.result.table.rows[0].cells.value.value.exact).toEqual({ numerator: '1', denominator: '10' });
    expect(h.calls('ai_query_snapshot_read')[1][1].p_fields).toEqual(['totalArea', 'vacantArea']);
  });

  it('AI5 Q3 explicitly distinguishes zero formal samples from unverified submitted buildings', async () => {
    const h = harness(); h.config.available = [quarters[2]];
    const answer = await h.submit(input('2026Q3 CBD净有效租金'));
    expect(answer.status).toBe(200);
    expect(answer.body.result.parameters.quarterlyCoverage).toMatchObject([{
      year: 2026, quarter: 3, formal: { valid_buildings: 0 },
      submitted: { rows: 3, buildings: 2, superseded_rows: 1 },
    }]);
    expect(answer.body.result.limitations.join('')).toContain('季度提交');
    expect(answer.body.result.limitations.join('')).toContain('最近正式有效季度为 2026Q2');
    expect(h.calls('ai_query_quarterly_coverage')).toHaveLength(1);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
  });

  it('T10 preserves an unavailable explicit quarter and returns no invented number', async () => {
    const h = harness(), result = await h.submit(input('2027Q2 CBD净有效租金'));
    expect(result.status).toBe(200); expect(result.body.result.parameters.executedPlan.period).toEqual({ year: 2027, quarter: 2 });
    expect(result.body.result.parameters.interpretation.unavailablePeriods).toEqual([{ year: 2027, quarter: 2 }]);
    expect(result.body.result.table.rows[0].cells.value).toMatchObject({ kind: 'unknown', reason: 'no_valid_sample' });
    expect(result.body.result.parameters.researchAnalysis.series[0].periods[0]).toMatchObject({ value: null, usedCount: 0 });
  });

  it.each(['ai_query_record_intake', 'ai_query_audit_receive', 'running', 'tool_finished'])('never reads business records if the %s audit boundary fails', async boundary => {
    const h = harness();
    if (boundary.startsWith('ai_query_')) h.config.failRpc = boundary; else h.config.failKind = boundary;
    const result = await h.submit(input('2026Q3 CBD净有效租金'));
    expect(result.status).toBe(503); expect(result.body).not.toHaveProperty('result'); expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    if (boundary !== 'tool_finished') expect(h.calls('ai_query_available_periods')).toHaveLength(0);
    expect(understandWithModel).not.toHaveBeenCalled();
  });

  it('T15 safely rejects an illegal model candidate and replays the recorded clarification without charging a second call', async () => {
    const h = harness(); identityState.modelConfigured = true;
    identityState.modelIntent = { version: 'colliers-semantic-intent/1', operation: 'aggregate', metric: 'rent', submarkets: ['CBD'],
      time: { kind: 'explicit', periods: [{ year: 2026, quarter: 3 }] }, unresolvedConditions: [], sql: 'select * from auth.users' };
    const question = input('2026Q3CBD净有效租金水平怎么样');
    const result = await h.submit(question);
    expect(result.status).toBe(422); expect(result.body).not.toHaveProperty('result'); expect(understandWithModel).toHaveBeenCalledOnce();
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    const retry = await h.submit(question); expect(retry.status).toBe(422); expect(understandWithModel).toHaveBeenCalledOnce();
    expect(h.calls('ai_query_model_budget')).toHaveLength(1);
    expect(h.decoded(result.body.requestId, 'accounting')).toHaveLength(1);
  });

  it('fails closed when the model accounting write fails before releasing any execution or result', async () => {
    const h = harness(); identityState.modelConfigured = true; h.config.failKind = 'accounting';
    identityState.modelIntent = { version: 'colliers-semantic-intent/1', operation: 'aggregate', metric: 'rent', submarkets: ['CBD'],
      time: { kind: 'explicit', periods: [{ year: 2026, quarter: 3 }] }, unresolvedConditions: [] };
    const result = await h.submit(input('2026Q3CBD净有效租金水平怎么样'));
    expect(result.status).toBe(503); expect(result.body).not.toHaveProperty('result'); expect(understandWithModel).toHaveBeenCalledOnce();
    expect(h.calls('ai_query_audit_append').filter(([, args]) => args.p_kind === 'accounting')).toHaveLength(1);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    expect(h.decoded(result.body.requestId, 'response_generated')).toHaveLength(0);
  });

  it('does not invoke the semantic provider when its cross-instance budget denies the request', async () => {
    const h = harness(); identityState.modelConfigured = true; h.config.modelBudget = false;
    const result = await h.submit(input('2026Q3CBD净有效租金水平怎么样'));
    expect(result.status).toBe(422); expect(result.body.message).toContain('额度');
    expect(understandWithModel).not.toHaveBeenCalled(); expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
  });

  it('refuses a tampered ciphertext and cannot reinterpret the prior question from client-supplied conditions', async () => {
    const h = harness(), question = input('2026Q3 CBD净有效租金'); const first = await h.submit(question); expect(first.status).toBe(200);
    const stream = h.streams.get(first.body.requestId)!, event = stream.events[0];
    event.cipher = { ...(event.cipher as Record<string, unknown>), tag: '0'.repeat(32) };
    const result = await h.submit(input('金融街呢', question.conversation.id, first.body.requestId));
    expect(result.status).toBe(503); expect(result.body).not.toHaveProperty('result'); expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
    const forged = await h.submit({ ...input('金融街呢'), conversation: { id: question.conversation.id, parentRequestId: first.body.requestId, context: { metric: 'rent' } } });
    expect(forged.status).toBe(403); expect(h.calls('ai_query_snapshot_read')).toHaveLength(1);
  });
});

describe('experience 2.0 P0 audited assistance', () => {
  it.each(['你好', '你是谁', '你能做什么', '谢谢'])('answers %s without reading facts or calling a model', async question => {
    const h = harness(); identityState.modelConfigured = true;
    const body = input(question); const response = await h.submit(body);
    expect(response.status).toBe(200);
    expect(queryReplySchema.parse(response.body)).toMatchObject({ status: 'clarification', reason: 'assistant_help', message: expect.any(String), conversation: body.conversation });
    expect(response.headers.get('x-query-delivery-token')).toBeTruthy();
    expect(h.decoded(response.body.requestId, 'received')).toHaveLength(1);
    expect(h.decoded(response.body.requestId, 'denied')).toHaveLength(1);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
    expect(h.calls('ai_query_available_periods')).toHaveLength(0);
    expect(understandWithModel).not.toHaveBeenCalled();
    const replay = await h.submit(body);
    expect(replay.body.message).toBe(response.body.message);
    expect(h.decoded(response.body.requestId, 'received')).toHaveLength(1);
  });
  it('preserves the authorized context across a greeting and a factual follow-up', async () => {
    const h = harness(), id = randomUUID();
    const first = await h.submit(input('2026Q3 CBD净有效租金', id));
    const greeting = await h.submit(input('你好', id, first.body.requestId));
    expect(greeting.status).toBe(200);
    const next = await h.submit(input('金融街呢', id, greeting.body.requestId));
    expect(next.status).toBe(200);
    expect(next.body.result.parameters.executedPlan.scope.submarkets).toEqual(['金融街']);
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(2);
  });
  it('still denies help when the current query grant is unavailable', async () => {
    const h = harness(); h.config.enabled = false;
    const response = await h.submit(input('你好'));
    expect(response.status).toBe(403);
    expect(response.body.reason).not.toBe('assistant_help');
    expect(h.calls('ai_query_snapshot_read')).toHaveLength(0);
  });
});
