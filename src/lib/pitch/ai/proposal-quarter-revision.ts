import { z } from "zod";
import { readAvailablePeriodGroups } from "@/src/lib/intelligence/query/availablePeriods";
import { quarterKey } from "@/src/lib/intelligence/query/contracts";
import { planMetrics, planOutputFields, type QueryPlan } from "@/src/lib/intelligence/query/plan";
import type { NumericField } from "@/src/lib/intelligence/query/registry";
import { loadDataAuthority } from "@/src/lib/intelligence/query/serverAuthority";
import { quarterPlans } from "../business/adapter";
import { dynamicParametersSchema } from "../business/protocol";
import { comparisonQuarters } from "../business/quarter-comparison";
import { pitchRpc, type PitchContext } from "../data/store";
import type { WorkspaceDetail } from "../workspace/protocol";

const captureSchema = z.object({
  asset_id: z.uuid(), asset_version: z.number().int().positive(), generation_id: z.uuid(), snapshot_index: z.number().int().nonnegative(),
  binding: z.object({ domain: z.enum(["quarter", "lease"]), permissionRevision: z.string(), policyVersion: z.string() }),
  parameters: dynamicParametersSchema, compares_quarters: z.boolean(), has_research: z.boolean(),
});
const bindingsSchema = z.array(captureSchema).max(50);
const quarterlyFields: readonly NumericField[] = ["totalArea", "vacantArea", "netEffectiveRent"];

function metricGroups(plan: QueryPlan): NumericField[][] {
  const metrics = planMetrics(plan);
  if (metrics.length) return metrics.map(metric => metric === "rent" ? ["totalArea", "netEffectiveRent"]
    : metric === "vacancy" ? ["totalArea", "vacantArea"] : ["totalArea"]);
  const fields = planOutputFields(plan).filter(field => quarterlyFields.includes(field));
  return fields.length ? [fields] : [];
}

export async function resolveQuarterRevision(
  ctx: PitchContext, current: WorkspaceDetail, selectedPageIds: readonly string[], wholeDocument: boolean, requestedPeriod: string | null,
) {
  const { project, slides, workspace } = current;
  const captures = bindingsSchema.parse(await pitchRpc(ctx, { action: "workspace_document_bindings", projectId: project.id, expectedVersion: project.version }));
  ctx.signal.throwIfAborted();
  const byAsset = new Map(captures.map(capture => [`${capture.asset_id}:${capture.asset_version}`, capture]));
  const related = slides.map(slide => ({ slide, capture: byAsset.get(`${slide.asset_id}:${slide.asset_version}`) }));
  const selected = related.filter(({ slide, capture }) => selectedPageIds.includes(slide.id)
    && (!wholeDocument || capture?.binding.domain === "quarter" || (!capture && workspace.page_settings[slide.id]?.origin === "data")));
  const anchor = selected[0];
  const original = anchor?.capture;
  if (!original || original.binding.domain !== "quarter" || original.has_research) return null;
  const sameCapture = (capture: typeof original | undefined) =>
    capture?.generation_id === original.generation_id && capture.snapshot_index === original.snapshot_index;
  if (selected.some(({ capture }) => !sameCapture(capture)) || related.filter(({ capture }) => sameCapture(capture)).length !== selected.length) return null;
  const authority = await loadDataAuthority(ctx.client, ctx.identity, ctx.signal);
  if (!authority.grants.includes("query:quarter") || !authority.grants.includes("export:internal")
    || authority.permissionRevision !== original.binding.permissionRevision
    || authority.policyVersion !== original.binding.policyVersion) throw new Error("QUERY_DENIED");
  // Use each plan's saved scope, including inventory and all compared submarkets
  // rather than the selection that happens to be open in the UI.
  const reads = new Map<string, { scope: QueryPlan["scope"]; groups: NumericField[][] }>();
  for (const plan of quarterPlans(original.parameters)) {
    const key = JSON.stringify(plan.scope);
    const read = reads.get(key) ?? { scope: plan.scope, groups: [] };
    read.groups.push(...metricGroups(plan));
    reads.set(key, read);
  }
  const fallback = (["netEffectiveRent", "totalArea", "vacantArea"] as const).find(field => authority.fields.includes(field));
  const lookups = [...reads.values()];
  if (lookups.some(read => !read.groups.length && !fallback)) return null;
  const availability = await Promise.all(lookups.map(({ scope, groups }) => {
    const distinctGroups = [...new Map(groups.map(group => [JSON.stringify([...group].sort()), group])).values()];
    return readAvailablePeriodGroups(ctx.client, ctx.identity, authority, scope, distinctGroups.length ? distinctGroups : [[fallback!]], ctx.signal);
  }));
  ctx.signal.throwIfAborted();
  const candidates = availability[0]?.periods ?? [];
  const trendStart = original.parameters.templateId.endsWith("-trend") ? quarterKey(original.parameters.start) : null;
  const applicable = candidates.filter(period => {
    const key = quarterKey(period);
    if (requestedPeriod && key !== requestedPeriod || !requestedPeriod && key < quarterKey(original.parameters.period)
      || trendStart && key < trendStart) return false;
    const required = [key];
    if (original.compares_quarters && period.year >= 1901) {
      const baseline = comparisonQuarters(period);
      required.push(quarterKey(baseline.previous), quarterKey(baseline.priorYear));
    } else if (original.compares_quarters) return false;
    return availability.every(read => required.every(value => read.periods.some(item => quarterKey(item) === value)));
  });
  const period = applicable.at(-1);
  if (!period) return null;
  return { period, slideId: anchor.slide.id, pageIds: selected.map(({ slide }) => slide.id) };
}
