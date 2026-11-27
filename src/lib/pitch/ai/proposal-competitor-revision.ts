import { z } from "zod";
import { quarterSchema, quarterKey } from "@/src/lib/intelligence/query/contracts";
import { contentBlockSchema, sourceReferenceSchema } from "../contracts/content";
import type { PitchContext } from "../data/store";
import type { AddToPitch } from "../integration-contracts";
import { stableId } from "../library/extract";
import type { WorkspaceDetail } from "../workspace/protocol";
import { workspaceCommandSchema } from "../workspace/protocol";
import { proposalQuarters } from "./proposal-brief";
import type { ProposalDirectorPorts } from "./proposal-director";
import type { ProposalEditIntent, ProposalRevisionRequest } from "./proposal-edit-intent";
import { createProposalDirectorPorts } from "./proposal-runtime";
import { findNamedProposalBuildings } from "./proposal-scope";

type BuildingHandoff = Required<Pick<AddToPitch, "projectId" | "period" | "language">> & {
  source: { kind: "buildings"; buildingIds: string[] };
};

export type ReviewProposalHandoff = (ctx: PitchContext, command: { action: "review_handoff"; handoff: BuildingHandoff }) => Promise<unknown>;
export type ProposalCompetitorData = Pick<ProposalDirectorPorts, "buildings" | "periods">;

const savedComparison = z.object({
  mode: z.literal("handoff"),
  parameters: z.object({ templateId: z.literal("project-comparison"), period: quarterSchema,
    buildingIds: z.array(z.uuid()).min(2).max(20).refine(ids => new Set(ids).size === ids.length) }),
});

const readyHandoff = z.object({
  status: z.literal("ready"),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  buildingIds: z.array(z.uuid()).min(2).max(20),
  period: z.string(),
  language: z.enum(["zh", "en"]),
  pages: z.array(z.object({
    title: z.string().min(1).max(160), blocks: z.array(contentBlockSchema).min(1).max(50), sources: z.array(sourceReferenceSchema).min(1).max(100),
  })).min(1).max(50),
});

function currentComparison(current: WorkspaceDetail, period: string) {
  const original = [...new Set(current.workspace.context.buildingIds)];
  const buildingIds = new Set(original);
  if (!original.length) return original;
  // Keep same-period comparisons linked to the initial shortlist, even
  // after the user moves those pages. The continuation pages share pins.
  for (const slide of current.slides) {
    const settings = current.workspace.page_settings[slide.id];
    if (settings?.origin !== "data") continue;
    const parsed = savedComparison.safeParse(settings.part);
    if (!parsed.success) continue;
    const parameters = parsed.data.parameters;
    if (quarterKey(parameters.period) !== period || !original.every(id => parameters.buildingIds.includes(id))) continue;
    for (const id of parameters.buildingIds) buildingIds.add(id);
  }
  return [...buildingIds];
}

export async function previewProposalCompetitor(
  ctx: PitchContext, current: WorkspaceDetail, input: ProposalRevisionRequest,
  operation: Extract<ProposalEditIntent, { kind: "add-competitor" }>,
  service?: ReviewProposalHandoff, data?: ProposalCompetitorData,
) {
  const { project, workspace } = current;
  const { period, language } = workspace.context;
  const clarification = (code: string, zh: string, en: string) =>
    ({ status: "clarification" as const, code, message: language === "en" ? en : zh });
  const unavailable = (code: string, zh: string, en: string) =>
    ({ status: "unavailable" as const, code, message: language === "en" ? en : zh, operations: [operation], requiresVerification: true });
  if (!service) return unavailable("comparison-handoff-unavailable", "当前工作台暂无竞品交接事务。", "The workspace comparison handoff is unavailable.");
  if (/当前页|当前这页|这一页|本页|这张表|所选页|\bthis (?:slide|table|page)\b/i.test(input.question)
    && !/附页|新增对比页|appendix|append (?:a|the) comparison/i.test(input.question)) {
    return clarification("comparison-append-scope", "请确认是否追加竞品对比附页。", "Confirm an appended comparison page.");
  }
  if (!period || proposalQuarters(input.question).some(requested => requested !== period)) {
    return clarification("comparison-period", "请先确认当前提案使用的正式季度。", "Confirm the proposal's formal reporting quarter first.");
  }
  const existing = currentComparison(current, period);
  if (!existing.length) return clarification("comparison-selection", "请先在当前提案中确认用于对比的楼宇。", "Select the properties to compare in the current proposal first.");
  if (existing.length >= 20) return unavailable("comparison-limit", "当前对比已达到 20 栋楼宇。", "The comparison already contains 20 properties.");
  const access = data ?? createProposalDirectorPorts(ctx);
  const authorized = await access.buildings({ city: project.city, submarkets: [] }, ctx.signal);
  ctx.signal.throwIfAborted();
  const candidates = findNamedProposalBuildings(operation.buildingQuery, authorized);
  const competitor = input.competitorBuildingId ? candidates.find(candidate => candidate.id === input.competitorBuildingId)
    : candidates.length === 1 ? candidates[0] : undefined;
  if (!competitor) {
    if (candidates.length > 1 && !input.competitorBuildingId) return {
      ...clarification("ambiguous-building", "有多个获权楼宇匹配该名称，请选择具体项目。", "Choose the authorized property that matches this name."),
      candidates: candidates.slice(0, 10),
    };
    return clarification("missing-building", "当前授权目录未匹配到这栋楼宇，请核对名称。", "Check the name against the authorized catalogue.");
  }
  if (existing.includes(competitor.id)) return clarification("competitor-already-included", "该楼宇已在这套提案的对比范围内。", "This property is already part of the comparison.");
  const buildingIds = [...existing, competitor.id];
  if (existing.some(id => !authorized.some(candidate => candidate.id === id))) throw new Error("QUERY_DENIED");
  const periods = await access.periods({ city: project.city, buildingIds, submarkets: [], scenario: "office-comparison" }, ctx.signal);
  ctx.signal.throwIfAborted();
  if (!periods.some(candidate => candidate.period === period && candidate.status === "formal")) {
    return unavailable("comparison-period-unavailable", "当前范围尚无可用的同季度正式数据。", "A formal quarter is unavailable for the current comparison scope.");
  }
  const handoff: BuildingHandoff = { source: { kind: "buildings", buildingIds }, projectId: project.id, period, language };
  const raw = await service(ctx, { action: "review_handoff", handoff });
  ctx.signal.throwIfAborted();
  const parsed = readyHandoff.safeParse(raw);
  if (!parsed.success) return unavailable("comparison-handoff-unavailable", "竞品对比未能完成数据审阅。", "The comparison could not complete evidence review.");
  const review = parsed.data;
  if (review.period !== period || review.language !== language || review.buildingIds.length !== buildingIds.length
    || buildingIds.some((id, index) => id !== review.buildingIds[index])) throw new Error("PITCH_PROPOSAL_REVIEW_REQUIRED");
  if (current.slides.length + review.pages.length > 50)
    return unavailable("comparison-page-limit", "追加对比将超过工作台的 50 页上限。", "Appending the comparison would exceed the 50-slide workspace limit.");
  const taskId = stableId(JSON.stringify(["pitch-proposal-competitor/1", ctx.identity.actorId, project.id, project.version, review.fingerprint]));
  const command = { action: "add_to_pitch" as const, handoff, target: { mode: "append" as const, expectedVersion: project.version },
    fingerprint: review.fingerprint, taskId };
  // The independent branch can use the shared reader contract. Require the
  // installed workspace to accept the actual write command before offering it.
  if (!workspaceCommandSchema.safeParse(command).success)
    return unavailable("comparison-handoff-unavailable", "当前工作台暂无竞品交接事务。", "The workspace comparison handoff is unavailable.");
  return { status: "ready" as const, scope: "document" as const, mode: "append-comparison" as const,
    operations: [operation], requiresVerification: true, review: { ...review, competitor }, command };
}
