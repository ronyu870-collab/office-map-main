import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { quarterKey, quarterSchema } from '@/src/lib/intelligence/query/contracts';
import { runPitchDataAdapter } from '../business/adapter';
import { analysisEndPeriod, readAnalysisPlan } from '../business/analysis-source';
import { documentDataVersion } from '../business/document-version';
import { dynamicParametersSchema } from '../business/protocol';
import { digest, pitchRpc, type PitchContext } from '../data/store';
import { projectContextSchema, type WorkspaceCommand } from './protocol';
import { getWorkspace } from './workflow';
import { requireStackingHandoff, stackingReviewBinding, stackingReviewFingerprint, type StackingHandoffPort } from './stacking-handoff';

type HandoffCommand = Extract<WorkspaceCommand, { action: 'review_handoff' | 'add_to_pitch' }>;
type Handoff = HandoffCommand['handoff'];
const reviewSchema = z.object({ state: z.string() }).passthrough();
async function prepareHandoff(ctx: PitchContext, input: Handoff, stackingPort?: StackingHandoffPort) {
  const current = input.projectId ? await getWorkspace(ctx, input.projectId) : undefined;
  const source = input.source;
  if (source.kind === 'stacking-plan') {
    const language = input.language ?? current?.workspace.context.language ?? 'zh';
    if (language !== 'zh') throw new Error('PITCH_LANGUAGE_UNAVAILABLE');
    const evidence = await requireStackingHandoff(stackingPort).read(ctx, source);
    if (current && current.project.city !== evidence.city) throw new Error('QUERY_DENIED');
    const { title, blocks, sources } = evidence.content;
    return {
      status: 'ready' as const, buildingIds: [source.buildingId], submarkets: [], period: '', language,
      binding: stackingReviewBinding(evidence), version: evidence.dataVersion,
      sourceCity: evidence.city, stackingSource: source, fingerprint: stackingReviewFingerprint(evidence, source, input.projectId),
      pages: [{ title, blocks, sources }],
    };
  }
  const lease = source.kind === 'lease-search' ? source : undefined;
  const research = source.kind === 'quarterly-research' ? source : undefined;
  if (research && current && current.project.city !== '北京') throw new Error('QUERY_DENIED');
  const analysis = source.kind === 'analysis-result' ? await readAnalysisPlan(ctx, source.id, source.resultId) : undefined;
  const sourcedBuildings = analysis?.plan.scope.buildingIds;
  const comparableBuildings = sourcedBuildings && sourcedBuildings.length <= 20 ? sourcedBuildings : [];
  const buildingIds = source.kind === 'buildings' ? source.buildingIds : lease?.buildingIds ?? comparableBuildings;
  const submarkets = source.kind === 'submarket' ? [source.key] : lease?.submarkets ?? analysis?.plan.scope.submarkets ?? [];
  const language = input.language ?? current?.workspace.context.language ?? 'zh';
  const archivedEnd = analysis && analysisEndPeriod(analysis.plan);
  const archivedPeriod = archivedEnd && quarterKey(archivedEnd);
  if (archivedPeriod && input.period && input.period !== archivedPeriod) throw new Error('PITCH_HANDOFF_CHANGED');
  const periodKey = lease ? '' : research ? research.edition.replace('Q', '-Q')
    : archivedPeriod || input.period || current?.workspace.context.period;
  if (!lease && !periodKey) return { status: 'period_required' as const, buildingIds, submarkets, language };
  const period = quarterSchema.parse(lease
    ? { year: Number(lease.to.slice(0, 4)), quarter: Math.ceil(Number(lease.to.slice(5, 7)) / 3) }
    : { year: Number(periodKey!.slice(0, 4)), quarter: Number(periodKey!.at(-1)) });
  const parameters = dynamicParametersSchema.parse({
    templateId: lease
      ? (lease.view === 'transactions' ? 'lease-representatives' : 'lease-industry-distribution')
      : analysis || !buildingIds.length ? 'quarter-market-summary'
        : buildingIds.length === 1 ? 'building-profile' : 'project-comparison',
    buildingIds, submarkets, inventory: research ? 'tracked' : analysis?.plan.scope.inventory ?? 'all_authorized', period, start: period, end: period,
    ...(research ? { researchScope: 'beijing-office-grade-a' } : {}),
    fields: lease || analysis ? [] : ['totalArea', 'vacantArea', 'netEffectiveRent'],
    chart: lease && lease.view !== 'transactions' ? 'bar' : 'table', direction: lease?.direction ?? 'asc',
    from: lease?.from ?? period.year + '-01-01', to: lease?.to ?? period.year + '-12-31',
    leaseSource: lease?.dataset ?? 'combined', measure: lease?.view === 'industry-area' ? 'area' : 'count',
    ...(analysis ? { analysisResult: analysis } : {}),
  });
  const snapshot = await runPitchDataAdapter(ctx, parameters, language, false, analysis?.plan);
  if (!lease && !analysis && buildingIds.length) {
    const included = new Set(snapshot.results[0].table.rows.map(row => row.entityId));
    if (buildingIds.some(id => !included.has(id))) throw new Error('QUERY_DENIED');
  }
  const binding = { ...snapshot.binding, dataVersion: snapshot.dataVersion, dataAsOf: snapshot.dataAsOf };
  const version = documentDataVersion(snapshot.results);
  const fingerprint = digest(Buffer.from(JSON.stringify({ source, projectId: input.projectId, parameters, language, version, authority: snapshot.binding })));
  return { status: 'ready' as const, buildingIds, submarkets, period: periodKey ?? '', language, binding, version, parameters, fingerprint,
    ...(research ? { sourceCity: '北京' } : {}),
    pages: snapshot.content.map(content => ({ title: content.title, blocks: content.blocks, sources: content.sources })),
  };
}
export async function reviewHandoff(ctx: PitchContext, command: Extract<HandoffCommand, { action: 'review_handoff' }>, stackingPort?: StackingHandoffPort) {
  return prepareHandoff(ctx, command.handoff, stackingPort);
}
export async function startHandoff(ctx: PitchContext, command: Extract<HandoffCommand, { action: 'add_to_pitch' }>, stackingPort?: StackingHandoffPort) {
  const { handoff, target, taskId } = command;
  const projectId = target.mode === 'create' ? target.projectId : handoff.projectId!;
  if (target.mode === 'create' && handoff.projectId || target.mode === 'append' && !handoff.projectId) throw new Error('PITCH_INVALID');
  const expectedVersion = target.mode === 'append' ? target.expectedVersion : 1;
  const request = { handoff, target, fingerprint: command.fingerprint };
  const replay = await pitchRpc(ctx, { action: 'workspace_handoff_replay', projectId, taskId, request });
  if (replay !== null) return reviewSchema.parse(replay);
  const review = await prepareHandoff(ctx, handoff, stackingPort);
  if (review.status !== 'ready' || review.fingerprint !== command.fingerprint) throw new Error('PITCH_HANDOFF_CHANGED');
  if (review.sourceCity && target.mode === 'create' && target.scope.city !== review.sourceCity) throw new Error('QUERY_DENIED');
  const create = target.mode === 'create' ? {
    title: target.title, scope: target.scope, themeId: target.themeId, themeVersion: target.themeVersion,
    context: projectContextSchema.parse({ buildingIds: review.buildingIds, language: review.language, period: review.period }),
  } : undefined;
  return reviewSchema.parse(await pitchRpc(ctx, {
    action: 'workspace_handoff_start', projectId, expectedVersion, taskId, sourceProjectId: randomUUID(), create,
    command: {
      part: { mode: 'handoff', ...(review.stackingSource
        ? { stackingSource: review.stackingSource, dataAsOf: review.binding.dataAsOf, observedOn: review.binding.observedOn }
        : { parameters: review.parameters }),
        language: review.language, dataVersion: review.version,
        policyVersion: review.binding.policyVersion, permissionRevision: review.binding.permissionRevision },
      replaceIds: [], creation: create, request,
    },
  }));
}
