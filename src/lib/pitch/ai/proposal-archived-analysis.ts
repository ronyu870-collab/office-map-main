import { z } from "zod";
import { quarterKey } from "@/src/lib/intelligence/query/contracts";
import { planSchema } from "@/src/lib/intelligence/query/plan";
import { queryHttpDependencies } from "@/src/lib/intelligence/query/http";
import { cellText, resultViewSchema, units, type QueryResultView } from "@/src/lib/intelligence/query/presentation";
import { readOwnResult, recoverOwnResult } from "@/src/lib/intelligence/query/recovery";
import { loadDataAuthority } from "@/src/lib/intelligence/query/serverAuthority";
import { FIELD_REGISTRY_VERSION } from "@/src/lib/intelligence/query/registry";
import { runPitchDataAdapter } from "../business/adapter";
import { dynamicParametersSchema } from "../business/protocol";
import { pitchRpc, type PitchContext } from "../data/store";
import type { ProposalBrief } from "../integration-contracts";
import { stableId } from "../library/extract";
import type { ComposedProposalPage, ProposalDirectorPorts } from "./proposal-director";
import { proposalEvidenceVersion } from "./proposal-runtime";

function replayParameters(snapshot: QueryResultView, brief: ProposalBrief) {
  const plan = planSchema.safeParse(snapshot.parameters.executedPlan);
  if (!plan.success || plan.data.operation !== snapshot.operation || plan.data.filter) return;
  const source = plan.data;
  const scope = source.scope;
  if (source.operation === "list") {
    if (!scope.buildingIds?.length || !source.fields.length) return;
  } else if (source.operation !== "trend" || source.mode !== "per_period" || source.metrics
    || (source.metric !== "rent" && source.metric !== "vacancy")) return;
  if (brief.submarkets.some(submarket => !scope.submarkets?.includes(submarket))) return;
  const isTrend = source.operation === "trend";
  const period = isTrend ? source.end : source.period;
  if (!period || (brief.period && brief.period !== quarterKey(period))) return;
  const parameters = dynamicParametersSchema.safeParse({
    templateId: isTrend ? source.metric === "rent" ? "rent-trend" : "vacancy-trend"
      : scope.buildingIds?.length === 1 ? "building-profile" : "project-comparison",
    buildingIds: scope.buildingIds ?? [], submarkets: scope.submarkets ?? [], inventory: scope.inventory,
    period, start: isTrend ? source.start : period, end: period,
    fields: isTrend ? [] : source.fields, direction: "asc", chart: "table",
    from: "2000-01-01", to: "2000-01-01", leaseSource: "combined", measure: "count",
  });
  if (parameters.success) return parameters.data;
}

async function replayAnalysis(ctx: PitchContext, archived: QueryResultView, brief: ProposalBrief) {
  const parameters = replayParameters(archived, brief);
  if (!parameters) return;
  const { allowedDynamic } = z.object({ allowedDynamic: z.array(z.string()) })
    .parse(await pitchRpc(ctx, { action: "workspace_capabilities" }));
  if (!allowedDynamic.includes(parameters.templateId)) return;
  try {
    const fresh = await runPitchDataAdapter(ctx, parameters, brief.language);
    ctx.signal.throwIfAborted();
    const evidenceVersion = proposalEvidenceVersion([archived]);
    if (proposalEvidenceVersion(fresh.results) === evidenceVersion) return { fresh, evidenceVersion, parameters };
  } catch (error) {
    ctx.signal.throwIfAborted();
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "PITCH_DATA_UNAVAILABLE") throw error;
  }
}

export async function composeArchivedAnalysis(
  ctx: PitchContext, requestId: string, brief: ProposalBrief,
): Promise<Awaited<ReturnType<ProposalDirectorPorts["compose"]>>> {
  const { client, identity, signal } = ctx;
  const authority = await loadDataAuthority(client, identity, signal);
  if (!authority.grants.includes("export:internal")) throw new Error("QUERY_DENIED");
  const { keys, enabled } = queryHttpDependencies();
  if (!enabled) throw new Error("QUERY_DENIED");
  const archived = await readOwnResult(client, identity, requestId, "archive", signal);
  const result = await recoverOwnResult(client, identity, keys, requestId, archived, signal, { exporting: true, reauthorizedHistory: true });
  const snapshot = resultViewSchema.parse(result.result);
  const { language } = brief;
  const english = language === "en";
  const empty = (reason: string) => ({ pages: [], gaps: [{ pageKind: "verified-analysis", reason }], recipeVersion: "archived-analysis/1" });
  // Only the numeric, authorized query-domain result is carried forward. Other
  // archived tools have separate export and disclosure contracts.
  if (!snapshot.sources.length || snapshot.registryVersion !== FIELD_REGISTRY_VERSION || !snapshot.table.rows.length) {
    return empty(english ? "The selected result has no compatible verified evidence." : "所选结果缺少可复用的可信数据。");
  }
  if (snapshot.table.columns.length > 12 || snapshot.table.rows.length > 200) {
    return empty(english ? "The selected result exceeds the presentation table capacity." : "所选结果超出单份提案表格容量，请先缩小分析范围。");
  }
  const dates = snapshot.sources.flatMap(source => source.businessAsOf ? [source.businessAsOf]
    : source.period ? [new Date(Date.UTC(source.period.year, source.period.quarter * 3, 0)).toISOString().slice(0, 10)] : []).sort();
  const asOf = dates.at(-1) ?? snapshot.createdAt.slice(0, 10);
  const reference = stableId(`pitch-archived-analysis/1:${requestId}:${snapshot.resultId}:${snapshot.dataVersion}`);
  const replay = await replayAnalysis(ctx, snapshot, brief);
  await result.recheck();
  signal.throwIfAborted();
  if (replay && replay.fresh.content.length && replay.fresh.content.length <= brief.pages) {
    const { parameters, evidenceVersion, fresh } = replay;
    const generation = { part: { mode: "dynamic" as const, parameters }, evidenceVersion };
    const pages = fresh.content.map((content, index): ComposedProposalPage => ({
      pageKind: index ? "analysis-methodology" : "verified-analysis",
      businessIntent: index ? "fact" : "analysis",
      layoutId: content.blocks.some(block => block.kind === "table") ? "data-table" : "two-columns",
      content: { ...content, sources: content.sources.map(source => ({
        ...source, recordId: snapshot.resultId, locator: `query/${requestId}`, version: evidenceVersion,
      })) },
      visuals: [], essential: true, generation, dependencyKinds: index ? ["verified-analysis"] : [],
      data: [{ ...fresh.binding, dataVersion: evidenceVersion, dataAsOf: fresh.dataAsOf }],
    }));
    return { pages, gaps: [], recipeVersion: "archived-analysis-replay/1", verifySources: result.recheck };
  }
  return {
    pages: [{
      pageKind: "verified-analysis", businessIntent: "analysis", layoutId: "data-table", visuals: [],
      data: [{ domain: "quarter", permissionRevision: authority.permissionRevision, policyVersion: authority.policyVersion,
        dataVersion: snapshot.dataVersion, dataAsOf: asOf }],
      content: {
        protocol: "colliers-pitch/1", locale: language, title: english ? "Verified analysis result" : "已核验分析结果", disclosure: "internal", isTestData: false,
        dataAsOf: asOf, sources: [{ id: reference, kind: "record", label: english ? "Authorized archived analysis" : "获权分析归档",
          recordId: snapshot.resultId, locator: `query/${requestId}`, version: snapshot.dataVersion, dataAsOf: asOf }],
        blocks: [{ kind: "table", sourceIds: [reference], columns: snapshot.table.columns.map(column =>
          column.unit ? `${column.label} (${units[column.unit] ?? column.unit})` : column.label),
        rows: snapshot.table.rows.map(row => snapshot.table.columns.map(column => row.cells[column.key]
          ? cellText(row.cells[column.key], column.unit) : null)) }],
      },
      uncertainties: !dates.length ? [english ? "The displayed date marks the original analysis capture." : "日期为分析快照生成日，实际业务截至日未确认。"] : [],
    }],
    gaps: [{ pageKind: "generation", reason: english
      ? "The archive could not be reproduced in a supported generation template with the same data and sources."
      : "现有生成模板无法用一致的数据和来源重现这份归档，当前仅供审阅。" }], recipeVersion: "archived-analysis/1",
  };
}
