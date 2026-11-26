import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { quarterSchema } from '@/src/lib/intelligence/query/contracts';
import { queryHttpDependencies } from '@/src/lib/intelligence/query/http';
import { readOwnResult, recoverOwnResult } from '@/src/lib/intelligence/query/recovery';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { runPitchDataAdapter } from '../business/adapter';
import { documentDataVersion } from '../business/document-version';
import { dynamicParametersSchema } from '../business/protocol';
import { digest, pitchRpc, type PitchContext } from '../data/store';
import type { AddToPitch } from '../integration-contracts';
import { projectContextSchema, type WorkspaceCommand } from './protocol';
import { getWorkspace } from './workflow';

type HandoffCommand = Extract<WorkspaceCommand, { action: 'review_handoff' | 'add_to_pitch' }>;
const reviewSchema = z.object({ state: z.string() }).passthrough();
const sourceScope = z.object({ buildingIds: z.array(z.uuid()).max(20).optional(),
  submarkets: z.array(z.string().max(80)).max(1).optional(),
  inventory: z.enum(['tracked', 'all_authorized']).optional() });

async function resolveAnalysis(ctx: PitchContext, requestId: string) {
  const { keys, enabled } = queryHttpDependencies();
  if (!enabled) throw new Error('QUERY_DENIED');
  const record = await readOwnResult(ctx.client, ctx.identity, requestId, 'archive', ctx.signal);
  const result = await recoverOwnResult(ctx.client, ctx.identity, keys, requestId, record, ctx.signal, { exporting: true, reauthorizedHistory: true });
  const view = resultViewSchema.parse(result.result);
  const data = z.object({ scope: sourceScope, period: quarterSchema.nullish() }).safeParse(view.parameters);
  if (!data.success || !['list', 'compare', 'aggregate'].includes(view.operation)) throw new Error('PITCH_HANDOFF_UNSUPPORTED');
  const scope = data.data.scope;
  const rowIds = view.operation === 'list' || view.operation === 'compare'
    ? view.table.rows.flatMap(row => z.uuid().safeParse(row.entityId).success ? [row.entityId] : [])
    : [];
  const buildingIds = scope.buildingIds ?? [...new Set(rowIds)];
  const submarkets = scope.submarkets ?? [];
  if (buildingIds.length > 20 || (!buildingIds.length && submarkets.length !== 1)) throw new Error('PITCH_HANDOFF_UNSUPPORTED');
  return { buildingIds, submarkets, period: data.data.period, inventory: scope.inventory };
}
async function prepareHandoff(ctx: PitchContext, input: AddToPitch) {
  const current = input.projectId ? await getWorkspace(ctx, input.projectId) : undefined;
  const source = input.source;
  const resolved = source.kind === 'analysis-result' ? await resolveAnalysis(ctx, source.id) : undefined;
  const buildingIds = source.kind === 'buildings' ? source.buildingIds : resolved?.buildingIds ?? [];
  const submarkets = source.kind === 'submarket' ? [source.key] : resolved?.submarkets ?? [];
  const periodKey = input.period || (resolved?.period ? `${resolved.period.year}-Q${resolved.period.quarter}` : current?.workspace.context.period);
  const language = input.language ?? current?.workspace.context.language ?? 'zh';
  if (!periodKey) return { status: 'period_required' as const, buildingIds, submarkets, language };
  const period = quarterSchema.parse({ year: Number(periodKey.slice(0, 4)), quarter: Number(periodKey.at(-1)) });
  const parameters = dynamicParametersSchema.parse({
    templateId: buildingIds.length === 1 ? 'building-profile' : buildingIds.length ? 'project-comparison' : 'rent-trend',
    buildingIds, submarkets, inventory: resolved?.inventory ?? 'all_authorized', period, start: period, end: period,
    fields: ['totalArea', 'vacantArea', 'netEffectiveRent'], chart: 'table', direction: 'asc',
    from: period.year + '-01-01', to: period.year + '-12-31', leaseSource: 'combined', measure: 'count',
  });
  const snapshot = await runPitchDataAdapter(ctx, parameters, language);
  if (buildingIds.length) {
    const included = new Set(snapshot.results[0].table.rows.map(row => row.entityId));
    if (buildingIds.some(id => !included.has(id))) throw new Error('QUERY_DENIED');
  }
  const binding = { ...snapshot.binding, dataVersion: snapshot.dataVersion, dataAsOf: snapshot.dataAsOf };
  const version = documentDataVersion(snapshot.results);
  const fingerprint = digest(Buffer.from(JSON.stringify({ source, projectId: input.projectId, parameters, language, version, authority: snapshot.binding })));
  return { status: 'ready' as const, buildingIds, submarkets, period: periodKey, language, binding, version, parameters, fingerprint,
    pages: snapshot.content.map(content => ({ title: content.title, blocks: content.blocks, sources: content.sources })),
  };
}
export async function reviewHandoff(ctx: PitchContext, command: Extract<HandoffCommand, { action: 'review_handoff' }>) {
  return prepareHandoff(ctx, command.handoff);
}
export async function startHandoff(ctx: PitchContext, command: Extract<HandoffCommand, { action: 'add_to_pitch' }>) {
  const { handoff, target, taskId } = command;
  const projectId = target.mode === 'create' ? target.projectId : handoff.projectId!;
  if (target.mode === 'create' && handoff.projectId || target.mode === 'append' && !handoff.projectId) throw new Error('PITCH_INVALID');
  const review = await prepareHandoff(ctx, handoff);
  if (review.status !== 'ready' || review.fingerprint !== command.fingerprint) throw new Error('PITCH_HANDOFF_CHANGED');
  const expectedVersion = target.mode === 'append' ? target.expectedVersion : 1;
  const create = target.mode === 'create' ? {
    title: target.title, scope: target.scope, themeId: target.themeId, themeVersion: target.themeVersion,
    context: projectContextSchema.parse({ buildingIds: review.buildingIds, language: review.language, period: review.period }),
  } : undefined;
  return reviewSchema.parse(await pitchRpc(ctx, {
    action: 'workspace_handoff_start', projectId, expectedVersion, taskId, sourceProjectId: randomUUID(), create,
    command: {
      part: { mode: 'handoff', parameters: review.parameters, language: review.language, dataVersion: review.version,
        policyVersion: review.binding.policyVersion, permissionRevision: review.binding.permissionRevision },
      replaceIds: [], creation: create,
    },
  }));
}
