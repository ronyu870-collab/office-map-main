import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { auditPayloadDigest, encryptAuditContent } from '../auditCrypto';
import type { AuditKeys } from '../auditStore';
import { FIELD_REGISTRY_VERSION } from '../registry';
import { loadDataAuthority } from '../serverAuthority';
import { recoverOwnResult } from '../recovery';
import { buildListResult, resultDigest } from '../result';
import { fixture } from './fixtures';
import { buildResultArtifact } from '../artifacts';
import type { AnswerSelection } from '../answerSelection';
import { prepareExportResult } from '../../agent/exportTableTool';

const ids = { actor: randomUUID(), effective: randomUUID(), session: randomUUID() };
const grant = { actorId: ids.actor, effectiveUserId: ids.effective, sessionId: ids.session, sessionActive: true,
  policyVersion: 'test', permissionRevision: 'a'.repeat(64),
  grants: ['query:catalog'], fields: [], allSubmarkets: false, submarkets: ['CBD'],
  allBuildings: false, buildingIds: [] };
vi.mock('../serverAuthority', () => ({
  loadDataAuthority: vi.fn(async () => grant),
}));
const keys: AuditKeys = { keyId: 'test', encryptionKey: new Uint8Array(32).fill(3),
  digestKey: new Uint8Array(32).fill(4) };
const plan = (segment: string) => ({ operation: 'list', fields: [], period: null,
  scope: { inventory: 'all_authorized', submarkets: [segment] } });

function auditEvent(requestId: string, sequence: number, kind: string, payload: unknown) {
  const eventId = randomUUID();
  const content = JSON.stringify({ content: payload, redactionTypes: [] });
  return { request_id: requestId, event_id: eventId, sequence, kind,
    payload_digest: auditPayloadDigest(content, keys.digestKey),
    cipher: encryptAuditContent(content, { requestId, eventId, actorId: ids.actor,
      effectiveUserId: ids.effective }, keys.keyId, keys.encryptionKey) };
}

async function recover(finalSegment: string, exportPlans?: unknown[]) {
  const requestId = randomUUID(), resultId = randomUUID();
  const events = [
    auditEvent(requestId, 1, 'received', { sessionId: ids.session,
      plan: { resolution: 'server_agent/1' } }),
    auditEvent(requestId, 2, 'running', { phase: 'agent_planning' }),
    auditEvent(requestId, 3, 'tool_finished', {
      protocol: 'agent-answer/1', plan: plan('UNAUTHORIZED_SEGMENT'),
      resolution: { protocol: 'research-conversation/1' } }),
    auditEvent(requestId, 4, 'tool_finished', {
      protocol: 'agent-answer/1', plan: plan(finalSegment),
      resolution: { protocol: 'research-conversation/1' } }),
    auditEvent(requestId, 5, 'response_generated', { result: {
      resultId, dataVersion: 'b'.repeat(64), registryVersion: FIELD_REGISTRY_VERSION,
      sources: [], parameters: exportPlans ? { exportPlans } : {}, operation: 'list', table: { id: 'x', columns: [], rows: [] },
    } }),
    auditEvent(requestId, 6, 'succeeded', { delivery: 'not_yet_sent' }),
  ];
  const read = { state: 'succeeded', permission_revision: grant.permissionRevision, head_sequence: events.length,
    head_hash: 'f'.repeat(64), events };
  const rpc = vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: {
    allowed: true, permission_revision: grant.permissionRevision,
  }, error: null }) });
  const client = { rpc } as unknown as SupabaseClient;
  return recoverOwnResult(client, { actorId: ids.actor, effectiveUserId: ids.effective,
    sessionId: ids.session, expiresAt: Date.now() + 30000 },
  keys, requestId, read as never, new AbortController().signal);
}

describe('immutable source-rechecked Agent result recovery', () => {
  async function recoverSelection(secondarySegment = 'CBD', deniedSecondarySource = false, files = false, workbook = false) {
    const requestId = randomUUID();
    const makeResult = (segment: string, label: string, includeHeight = false) => {
      const fields = includeHeight ? ['height' as const] : [];
      const base = buildListResult(fixture(), fields);
      const mapping = new Map(base.table.rows.map(row => [row.entityId, randomUUID()]));
      return { ...base, dataVersion: 'b'.repeat(64), parameters: { ...base.parameters, executedPlan: { ...plan(segment), fields } },
        table: { ...base.table, rows: base.table.rows.map(row => ({ ...row, entityId: mapping.get(row.entityId)!,
          cells: { ...row.cells, name: { ...row.cells.name, kind: 'text' as const, value: label } } })) },
        sources: base.sources.map(source => ({ ...source, entityId: mapping.get(source.entityId)! })) };
    };
    const sourceA = makeResult('CBD', '主结果楼宇'), sourceB = makeResult(secondarySegment, '比较结果楼宇', workbook);
    const a = workbook ? prepareExportResult([sourceA, sourceB], { resultIds: [sourceA.resultId, sourceB.resultId], format: 'xlsx' })
      : files ? prepareExportResult([sourceA], { resultIds: [sourceA.resultId], format: 'xlsx' }) : sourceA;
    const b = files ? prepareExportResult([sourceB], { resultIds: [sourceB.resultId], format: 'csv_zip' }) : sourceB;
    const selection: AnswerSelection = { version: 'answer-selection/1', task: files || workbook ? 'file' : 'comparison', status: 'answered',
      primaryResultId: a.resultId, results: [{ role: 'primary', result: a as never },
        ...(workbook ? [] : [{ role: 'comparison' as const, result: b as never }])] };
    const events = [
      auditEvent(requestId, 1, 'received', { sessionId: ids.session, plan: { resolution: 'server_agent/1' } }),
      auditEvent(requestId, 2, 'tool_finished', { protocol: 'agent-answer/1', resolution: { protocol: 'answer-selection/1' } }),
      auditEvent(requestId, 3, 'response_generated', { result: selection }),
      auditEvent(requestId, 4, 'succeeded', { delivery: 'not_yet_sent' }),
    ];
    let sourceChecks = 0;
    const rpc = vi.fn().mockImplementation(() => ({ abortSignal: async () => {
      sourceChecks++;
      return { data: { allowed: !deniedSecondarySource || sourceChecks !== 2,
        permission_revision: grant.permissionRevision }, error: null };
    } }));
    const restored = await recoverOwnResult({ rpc } as unknown as SupabaseClient,
      { actorId: ids.actor, effectiveUserId: ids.effective, sessionId: ids.session, expiresAt: Date.now() + 30000 },
      keys, requestId, { state: 'succeeded', permission_revision: grant.permissionRevision, head_sequence: events.length,
        head_hash: 'f'.repeat(64), events } as never, new AbortController().signal);
    return { restored, a, b, rpc, requestId };
  }

  it('restores both selected snapshots with their exact digest and rechecks both source sets', async () => {
    const { restored, a, b, rpc, requestId } = await recoverSelection();
    expect(restored.resultId).toBe(a.resultId);
    expect(restored.answerSelection?.results.map(item => item.result.resultId)).toEqual([a.resultId, b.resultId]);
    expect(rpc).toHaveBeenCalledTimes(2);
    const secondary = restored.answerSelection!.results[1].result;
    expect(resultDigest(secondary as never)).toBe(resultDigest(b));
    const copied = await buildResultArtifact(secondary, { requestId, resultId: b.resultId, action: 'copy', format: 'table' });
    expect(copied.type).toBe('copy');
    if (copied.type === 'copy') expect(copied.text).toContain('比较结果楼宇');
    await restored.recheck();
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it('rejects the complete selection when an auxiliary scope or its current source ACL is denied', async () => {
    await expect(recoverSelection('UNAUTHORIZED_SEGMENT')).rejects.toThrow('QUERY_DENIED');
    await expect(recoverSelection('CBD', true)).rejects.toThrow('QUERY_DENIED');
  });
  it('recovers both generated file snapshots without losing content and rejects a revoked secondary source', async () => {
    const { restored, a, b, requestId } = await recoverSelection('CBD', false, true);
    const snapshots = restored.answerSelection!.results.map(entry => entry.result);
    expect(snapshots.map(snapshot => resultDigest(snapshot as never))).toEqual([resultDigest(a), resultDigest(b)]);
    const XLSX = await import('xlsx'); const { default: JSZip } = await import('jszip');
    const xlsx = await buildResultArtifact(snapshots[0], { requestId, resultId: a.resultId, action: 'export', format: 'xlsx' });
    const csv = await buildResultArtifact(snapshots[1], { requestId, resultId: b.resultId, action: 'export', format: 'csv_zip' });
    if (xlsx.type !== 'download' || csv.type !== 'download') throw Error('missing recovered file');
    const book = XLSX.read(xlsx.bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 }) as unknown[][];
    expect(rows).toHaveLength(5); expect(rows[1]).toContain('主结果楼宇');
    const zip = await JSZip.loadAsync(csv.bytes);
    expect(await zip.file('data.csv')!.async('string')).toContain('比较结果楼宇');
    await expect(recoverSelection('CBD', true, true)).rejects.toThrow('QUERY_DENIED');
  });
  it('rechecks each workbook sheet and denies the entire download after a secondary source is revoked', async () => {
    await vi.mocked(loadDataAuthority).withImplementation(async () => ({ ...grant,
      grants: ['query:catalog', 'query:brochure', 'export:internal'], fields: ['height'] }), async () => {
      const { a, restored, rpc, requestId } = await recoverSelection('CBD', false, false, true);
      expect(rpc).toHaveBeenCalledTimes(2);
      const original = await buildResultArtifact(a, { requestId, resultId: a.resultId, action: 'export', format: 'xlsx' });
      const reopened = await buildResultArtifact(restored.result, { requestId, resultId: a.resultId, action: 'export', format: 'xlsx' });
      expect(original.type).toBe('download');
      expect(reopened).toEqual(original);
      await expect(recoverSelection('CBD', true, false, true)).rejects.toThrow('QUERY_DENIED');
    });
    await expect(recoverSelection('CBD', false, false, true)).rejects.toThrow('QUERY_DENIED');
  });
  it('recovers the last model tool plan, not the earlier disallowed tool result', async () => {
    const recovered = await recover('CBD');
    expect(recovered.resultId).toMatch(/^[a-f0-9-]{36}$/);
    await expect(recovered.recheck()).resolves.toBeUndefined();
  });
  it('rechecks every original plan in merged exports rather than only the final scope', async () => {
    await expect(recover('CBD', [plan('CBD'), plan('UNAUTHORIZED_SEGMENT')])).rejects.toThrow('QUERY_DENIED');
    await expect(recover('CBD', [plan('CBD')])).resolves.toBeDefined();
  });
  it('rejects recovery when the model final result scope is no longer authorized', async () => {
    await expect(recover('UNAUTHORIZED_SEGMENT')).rejects.toThrow('QUERY_DENIED');
  });
});

