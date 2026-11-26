import { createHash } from "node:crypto";
import { z } from "zod";
import { loadDataAuthority } from "@/src/lib/intelligence/query/serverAuthority";
import { readQuerySnapshots } from "@/src/lib/intelligence/query/snapshotReader";
import { readAvailablePeriodGroups } from "@/src/lib/intelligence/query/availablePeriods";
import { quarterKey } from "@/src/lib/intelligence/query/contracts";
import type { QueryResultView } from "@/src/lib/intelligence/query/presentation";
import type { NumericField } from "@/src/lib/intelligence/query/registry";
import { runPitchDataAdapter, type PitchDataSnapshot } from "../business/adapter";
import { dynamicParametersSchema, type DynamicParameters } from "../business/protocol";
import { scopeSchema } from "../contracts/content";
import { pitchRpc, type PitchContext } from "../data/store";
import { getWorkspace } from "../workspace/workflow";
import type { ProposalRequest } from "./proposal-brief";
import { directProposal, type ComposedProposalPage, type ProposalComposerInput, type ProposalDirectorPorts } from "./proposal-director";
import type { ProposalModel } from "./proposal-interpretation";

const grantSchema = scopeSchema.extend({ canGenerate: z.boolean(), canClientExport: z.boolean(), canExternalAi: z.boolean() }).strip();
const parseScope = (raw: z.infer<typeof grantSchema>) => scopeSchema.parse({
  organizationId: raw.organizationId, region: raw.region, city: raw.city, businessLine: raw.businessLine,
});

export async function resolveProposalScope(ctx: PitchContext, input: ProposalRequest, city?: string | null) {
  const project = input.projectId ? await getWorkspace(ctx, input.projectId) : null;
  const { scopes } = z.object({ scopes: z.array(grantSchema) }).parse(await pitchRpc(ctx, { action: "catalog" }));
  const grants = scopes.filter(grant => grant.canGenerate && (input.audience !== "client" || grant.canClientExport));
  const candidates = project ? grants.filter(grant => grant.organizationId === project.project.organization_id
    && grant.region === project.project.region && grant.city === project.project.city && grant.businessLine === project.project.business_line)
    : grants.filter(grant => !city || grant.city.normalize("NFKC") === city.normalize("NFKC"));
  if (!candidates.length) throw new Error("PITCH_DENIED");
  if (candidates.length !== 1) throw new Error("PITCH_PROPOSAL_SCOPE_REQUIRED");
  return {
    scope: parseScope(candidates[0]), grant: candidates[0],
    defaults: project ? { buildingIds: project.workspace.context.buildingIds, targetClient: project.workspace.context.client || undefined } : undefined,
  };
}

// Existing trusted query contracts already provide this lower-cost route.
// The shared integration can supply the unified data/visual/recipe composer.
export function createProposalDirectorPorts(ctx: PitchContext, overrides: Partial<ProposalDirectorPorts> = {}): ProposalDirectorPorts {
  return {
    scope: (input, signal) => resolveProposalScope({ ...ctx, signal }, input, input.city),
    buildings: async ({ city, submarkets }, signal) => {
      assertBeijingMarket(city);
      const authority = await loadDataAuthority(ctx.client, ctx.identity, signal);
      const [catalogue] = await readQuerySnapshots(ctx.client, ctx.identity, authority,
        { operation: "list", scope: { inventory: "all_authorized", ...(submarkets.length ? { submarkets } : {}) }, fields: [], period: null }, signal);
      const fresh = await loadDataAuthority(ctx.client, ctx.identity, signal);
      if (fresh.permissionRevision !== authority.permissionRevision || fresh.policyVersion !== authority.policyVersion) throw new Error("QUERY_DENIED");
      return catalogue.rows.map(building => ({ id: building.id, name: building.name, city,
        submarket: building.dimensions.submarket?.value, grade: building.dimensions.grade?.value }));
    },
    periods: async ({ city, submarkets, buildingIds, scenario }, signal) => {
      assertBeijingMarket(city);
      const authority = await loadDataAuthority(ctx.client, ctx.identity, signal);
      if (!authority.grants.includes("query:quarter") || !authority.grants.includes("export:internal")) {
        if (scenario === "leasing-agency" || scenario === "building-promotion") return [];
        throw new Error("QUERY_DENIED");
      }
      const groups: NumericField[][] = [["netEffectiveRent"], ["totalArea", "vacantArea"]];
      const selection = { inventory: "tracked" as const, ...(submarkets.length ? { submarkets } : {}), ...(buildingIds.length ? { buildingIds } : {}) };
      const eligible = groups.filter(group => group.every(field => authority.fields.includes(field)));
      if (!eligible.length) return [];
      const available = await readAvailablePeriodGroups(ctx.client, ctx.identity, authority, selection, eligible, signal);
      return available.periods.map(period => ({ period: quarterKey(period), status: "formal" }));
    },
    compose: createStandardComposer(ctx),
    ...overrides,
  };
}

function assertBeijingMarket(city: string) {
  // The original formal market query exposes submarkets/building IDs, not a city parameter.
  if (!/^(?:北京(?:市)?|beijing)$/i.test(city)) throw new Error("PITCH_PROPOSAL_SCOPE_REQUIRED");
}

const parts = {
  profile: { template: "building-profile", zh: "项目参数", en: "Property specifications", chart: "table" },
  comparison: { template: "project-comparison", zh: "项目参数对比", en: "Property specifications compared", chart: "table" },
  rent: { template: "rent-comparison", zh: "竞品净有效租金", en: "Comparable net effective rents", chart: "bar" },
  vacancy: { template: "vacancy-comparison", zh: "竞品空置率", en: "Comparable vacancy rates", chart: "bar" },
  balance: { template: "building-submarket", zh: "项目与所属子市场表现", en: "Property performance against its submarket", chart: "table" },
  rentTrend: { template: "rent-trend", zh: "市场净有效租金趋势", en: "Market net effective rent trend", chart: "line" },
  vacancyTrend: { template: "vacancy-trend", zh: "市场空置率趋势", en: "Market vacancy trend", chart: "line" },
} as const;

type StandardPart = keyof typeof parts;
const inexpensivePaths = {
  "leasing-agency": ["profile", "balance", "rentTrend", "vacancyTrend"],
  "office-comparison": ["comparison", "rent", "vacancy"],
  "market-report": ["rentTrend", "vacancyTrend"],
  "building-promotion": ["profile"],
  "site-selection": ["comparison", "rent", "vacancy"],
  "analysis-briefing": [],
} satisfies Record<ProposalComposerInput["brief"]["scenario"], StandardPart[]>;

function createStandardComposer(ctx: PitchContext): ProposalDirectorPorts["compose"] {
  return async ({ brief, buildings, priorities, analysisResultId }, signal) => {
    assertBeijingMarket(brief.city);
    // The standard data adapter permits internal export only. Client use is decided by the shared source adapters.
    if (brief.audience === "client") throw new Error("PITCH_DENIED");
    if (brief.scenario === "analysis-briefing" && analysisResultId) {
      const { composeArchivedAnalysis } = await import("./proposal-archived-analysis");
      return composeArchivedAnalysis({ ...ctx, signal }, analysisResultId, brief.language);
    }
    const trusted = await loadDataAuthority(ctx.client, ctx.identity, signal);
    if (!trusted.grants.includes("export:internal")) throw new Error("QUERY_DENIED");
    const { allowedDynamic } = z.object({ allowedDynamic: z.array(z.string()) }).parse(
      await pitchRpc({ ...ctx, signal }, { action: "workspace_capabilities" }));
    if (!brief.period) throw new Error("PITCH_PROPOSAL_PERIOD_REQUIRED");
    const period = toQuarter(brief.period);
    const periodNumber = 4 * period.year + period.quarter - 1;
    const earliest = Math.max(1900 * 4, periodNumber - 3);
    const start = brief.start ? toQuarter(brief.start) : { year: Math.floor(earliest / 4), quarter: earliest % 4 + 1 };
    const area = buildings[0]?.submarket;
    const submarkets = brief.submarkets.length ? brief.submarkets : brief.scenario === "leasing-agency" && area ? [area] : [];
    const pages: ComposedProposalPage[] = [];
    const en = brief.language === "en";
    const gaps = [];
    const keys = [...inexpensivePaths[brief.scenario]];
    if (priorities[0] === "availability" && keys.includes("rent") && keys.includes("vacancy")) {
      keys.splice(keys.indexOf("rent"), 2, "vacancy", "rent");
    }
    for (const key of keys) {
      signal.throwIfAborted();
      const part = parts[key];
      if (!allowedDynamic.includes(part.template) || !brief.period && key !== "profile" || key === "balance" && submarkets.length !== 1) {
        gaps.push({ pageKind: key, reason: en ? "Verified evidence is unavailable." : "缺少获权且适用的正式数据。" });
        continue;
      }
      const trend = key === "rentTrend" || key === "vacancyTrend";
      const fields = key === "profile" || key === "comparison"
        ? trusted.fields.filter(field => field !== "netEffectiveRent" && field !== "totalArea" && field !== "vacantArea") : [];
      if ((key === "profile" || key === "comparison") && !fields.length) {
        gaps.push({ pageKind: key, reason: en ? "Profile fields are unavailable." : "楼书字段未获权。" });
        continue;
      }
      const parameters = dynamicParametersSchema.parse({
        templateId: part.template, buildingIds: trend ? [] : brief.buildingIds, submarkets,
        ...(key === "balance" ? { targetBuildingId: brief.buildingIds[0] } : {}),
        inventory: key === "profile" ? "all_authorized" : "tracked", period, start, end: period, fields,
        direction: "desc", chart: part.chart, from: "2000-01-01", to: "2000-01-01", leaseSource: "combined", measure: "count",
      });
      let snapshot: PitchDataSnapshot;
      try {
        snapshot = await runPitchDataAdapter({ ...ctx, signal }, parameters, brief.language);
      } catch (error) {
        signal.throwIfAborted();
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "PITCH_DATA_UNAVAILABLE") throw error;
        gaps.push({ pageKind: key, reason: en ? "Verified evidence is unavailable." : "缺少获权且适用的正式数据。" });
        continue;
      }
      if (pages.length + snapshot.content.length > brief.pages) {
        gaps.push({ pageKind: key, reason: en ? "Omitted within the requested length." : "按提案篇幅省略本组页面。" });
        continue;
      }
      const dataVersion = proposalEvidenceVersion(snapshot.results);
      const generation = { part: { mode: "dynamic" as const, parameters, title: en ? part.en : part.zh }, evidenceVersion: dataVersion };
      for (const [index, raw] of snapshot.content.entries()) {
        const sources = raw.sources.map(source => ({ ...source, recordId: dataVersion,
          locator: `pitch-query/${parameters.templateId}/${index + 1}`, version: dataVersion }));
        const title = (en ? part.en : part.zh) + (index ? en ? " · Scope and coverage" : " · 口径与覆盖" : "");
        pages.push({ pageKind: key, layoutId: raw.blocks.some(block => block.kind === "chart") ? "chart-insight" : "data-table",
          businessIntent: key === "profile" || key === "comparison" ? "fact" : "analysis", content: { ...raw, title, sources }, visuals: [],
          generation, data: [{ ...snapshot.binding, dataVersion, dataAsOf: snapshot.dataAsOf }],
        });
      }
    }
    if (brief.scenario !== "market-report" && brief.scenario !== "analysis-briefing") {
      gaps.push({ pageKind: "visuals", reason: en ? "No reviewed images or maps are attached to the data-only draft." : "当前数据提案未附获权图片或地图。" });
    }
    return { pages, gaps, recipeVersion: "standard-business-data/1" };
  };
}

function toQuarter(period: string): DynamicParameters["period"] {
  return { year: Number(period.slice(0, 4)), quarter: Number(period.at(-1)) as 1 | 2 | 3 | 4 };
}

export async function prepareProposal(ctx: PitchContext, input: ProposalRequest, model?: ProposalModel,
  ports = createProposalDirectorPorts(ctx)) {
  const result = await directProposal(input, ports, ctx.signal, model);
  if (result.status !== "ready") return result;
  return {
    status: result.status, plan: result.plan, brief: result.snapshot.brief, selection: result.selection,
    modelCalls: result.modelCalls, modelStatus: result.modelStatus,
  };
}

export function proposalEvidenceVersion(results: readonly QueryResultView[]) {
  const stable = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(stable);
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, stable(field)]));
  };
  return createHash("sha256").update(JSON.stringify(stable(results.map(result => ({
    scope: result.scopeFingerprint,
    columns: result.table.columns,
    rows: result.table.rows,
    sources: [...result.sources].sort((a, b) => a.id.localeCompare(b.id)),
  }))))).digest("hex");
}
