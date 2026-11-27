import { randomUUID } from "node:crypto";
import { z } from "zod";
import { quarterSchema } from "@/src/lib/intelligence/query/contracts";
import { layoutIdSchema } from "../contracts/scene";
import { studioRegistry } from "../data/renderWorkflow";
import { pitchRpc, type PitchContext } from "../data/store";
import { layoutSlides } from "../layout/engine";
import { LayoutError } from "../layout/metrics";
import { objectId, textAnchors } from "../workspace/object-layout";
import { pageEditSchema, workspaceCommandSchema, workspaceDetailSchema, type WorkspaceSave } from "../workspace/protocol";
import { proposalRequestSchema, readProposalBrief } from "./proposal-brief";
import { compileProposalChartEdits, type ProposalChartChange } from "./proposal-chart-revision";
import { previewProposalCompetitor, type ProposalCompetitorData, type ReviewProposalHandoff } from "./proposal-competitor-revision";
import { resolveQuarterRevision } from "./proposal-quarter-revision";
import type { ProposalScenario } from "../integration-contracts";
import { readProposalEdit, type ProposalRevisionRequest } from "./proposal-edit-intent";
import { prepareProposal } from "./proposal-runtime";
import { previewProposalRevision, type ProposalRevisionPort } from "./proposal-workflow";

const versionedWorkspace = workspaceDetailSchema.extend({
  slides: z.array(workspaceDetailSchema.shape.slides.element.extend({ version: z.number().int().positive() })),
});
const formattedNumber = /[-+]?[0-9]+(?:[,.][0-9]+)*/g;
const numbers = (text: string) => JSON.stringify(text.normalize("NFKC").match(formattedNumber) ?? []);
const scenarioQuestions: Record<Exclude<ProposalScenario, "analysis-briefing">, string> = {
  "leasing-agency": "为所选楼宇制作招商代理提案",
  "office-comparison": "对比所选写字楼",
  "market-report": "制作写字楼市场报告",
  "building-promotion": "为所选楼宇制作项目推介",
  "site-selection": "为所选楼宇制作选址方案",
};
const quoted = /(?:改为|改成|换成|替换为|replace (?:it )?with|change (?:it )?to)\s*(?:《([^》]+)》|「([^」]+)」|[“"＂]([^”"＂]+)[”"＂])/i;

const quarterReviewSchema = z.object({
  projectVersion: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z.array(z.object({ slideId: z.uuid() }).passthrough()).min(1).max(50),
  period: quarterSchema,
  changed: z.boolean(),
  needsConclusionReview: z.boolean(),
});

export type PreviewProposalQuarter = (ctx: PitchContext, command: {
  action: "preview_data_refresh"; projectId: string; slideId: string; expectedVersion: number;
  period: z.infer<typeof quarterSchema>;
}) => Promise<unknown>;

export type ProposalRevisionServices = {
  previewQuarter?: PreviewProposalQuarter;
  reviewHandoff?: ReviewProposalHandoff;
  competitorData?: ProposalCompetitorData;
};

export async function planProposalRevision(ctx: PitchContext, input: ProposalRevisionRequest, providers?: PreviewProposalQuarter | ProposalRevisionServices) {
  const services = typeof providers === "function" ? { previewQuarter: providers } : providers;
  const previewQuarter = services?.previewQuarter;
  const current = versionedWorkspace.parse(await pitchRpc(ctx, { action: "workspace_get", projectId: input.projectId }));
  const { project, workspace, slides } = current;
  if (project.version !== input.expectedVersion) throw new Error("PITCH_CONFLICT");
  await pitchRpc(ctx, { action: "catalog" });
  const intention = readProposalEdit(input);
  if (intention.kind === "intent" && intention.operations.length === 1 && intention.operations[0].kind === "add-competitor") {
    if (intention.target.kind === "pages" && intention.target.pageIds.some(id => !slides.some(slide => slide.id === id))) {
      throw new Error("PITCH_INVALID");
    }
    return previewProposalCompetitor(ctx, current, input, intention.operations[0], services?.reviewHandoff, services?.competitorData);
  }
  let scope: "selected" | "document" = "selected";
  let theme: { id: string; version: number } | undefined;
  let chartPreview: ({ pageId: string } & ProposalChartChange)[] | undefined;
  let refreshPlan: Extract<Awaited<ReturnType<typeof prepareProposal>>, { status: "ready" }> | undefined;
  let quarterTransaction: { review: z.infer<typeof quarterReviewSchema>; command: {
    action: "apply_data_refresh"; projectId: string; slideId: string; expectedVersion: number;
    period: z.infer<typeof quarterSchema>; fingerprint: string;
  } } | undefined;
  const port: ProposalRevisionPort = {
    read: async () => ({ version: project.version, pages: slides.map(slide => ({ id: slide.id, version: slide.version,
      objectIds: slide.scene.elements.map(objectId), manual: workspace.page_settings[slide.id]?.manual === true
        || workspace.page_settings[slide.id]?.origin === "user" || slide.scene.elements.some(element => !!element.editorId) })) }),
    compile: async ({ selected, target, current: base }, signal) => {
      ctx = { ...ctx, signal };
      scope = target.target.kind === "deck" ? "document" : "selected";
      const pageEdits = new Map<string, WorkspaceSave["pages"][number]>(base.map(page => [page.id, { id: page.id }]));
      for (const operation of target.operations) {
        signal.throwIfAborted();
        if (operation.kind === "set-chart") {
          if (target.operations.length !== 1 || !("chartPresentation" in pageEditSchema.shape)) return null;
          if (slides.some(slide => slide.scene.themeId !== project.theme_id || slide.scene.themeVersion !== project.theme_version)) return null;
          const selectedIds = new Set(selected.map(page => page.id));
          const changes = compileProposalChartEdits(target.target, operation, slides.filter(slide => selectedIds.has(slide.id)));
          if (!changes) return null;
          const registry = await studioRegistry(ctx, project.theme_id, project.theme_version);
          for (const { slide, changes: charts } of changes) {
            signal.throwIfAborted();
            const types = new Map(charts.map(chart => [chart.blockIndex, chart.type]));
            const blocks = slide.content.blocks.map((block, index) => block.kind === "chart"
              ? { ...block, chartType: types.get(index) ?? block.chartType } : block);
            const layout = layoutIdSchema.safeParse(slide.scene.layoutId);
            if (!layout.success) return null;
            try {
              const preview = await layoutSlides({ ...slide.content, blocks }, registry.theme.definition, layout.data, slide.scene.variant);
              const count = preview[0]?.elements.filter(element => element.kind === "chart").length;
              if (preview.length !== 1 || count !== blocks.filter(block => block.kind === "chart").length) return null;
            } catch (error) {
              if (error instanceof LayoutError) return null;
              throw error;
            }
            pageEdits.set(slide.id, pageEditSchema.parse({ id: slide.id,
              chartPresentation: charts.map(({ blockIndex, type }) => ({ blockIndex, type })) }));
          }
          chartPreview = changes.flatMap(({ slide, changes: charts }) => charts.map(chart => ({ pageId: slide.id, ...chart })));
          continue;
        }
        if (operation.kind === "set-period") {
          if (target.operations.length !== 1) return null;
          if (previewQuarter) {
            const resolved = await resolveQuarterRevision(ctx, current, selected.map(page => page.id), scope === "document", operation.period);
            if (!resolved) return null;
            const { period, slideId, pageIds } = resolved;
            const command = { action: "preview_data_refresh" as const, projectId: project.id, slideId, expectedVersion: project.version, period };
            const review = quarterReviewSchema.parse(await previewQuarter(ctx, command));
            if (review.projectVersion !== project.version) throw new Error("PITCH_CONFLICT");
            if (review.period.year !== period.year || review.period.quarter !== period.quarter) return null;
            const ids = new Set(review.changes.map(change => change.slideId));
            if (ids.size !== review.changes.length || ids.size !== pageIds.length || pageIds.some(id => !ids.has(id))) return null;
            const id = randomUUID();
            quarterTransaction = { review, command: { ...command, action: "apply_data_refresh", fingerprint: review.fingerprint } };
            return { id, pages: [...pageEdits.values()], refresh: { id, version: 1, contextFingerprint: review.fingerprint } };
          }
          const projectQuestion = `${workspace.context.business} ${project.title}`.trim();
          const brief = readProposalBrief(proposalRequestSchema.parse({ question: projectQuestion }));
          if (!brief.scenario || brief.scenario === "analysis-briefing") return null;
          if (brief.scenario !== "market-report" && !workspace.context.buildingIds.length) return null;
          const period = operation.period;
          const location = brief.submarkets.join("、");
          const question = [period ?? "最新正式季度", location, scenarioQuestions[brief.scenario]].filter(Boolean).join("，");
          const proposal = await prepareProposal(ctx, proposalRequestSchema.parse({ question, projectId: input.projectId,
            buildingIds: workspace.context.buildingIds, language: workspace.context.language, period: period ?? undefined }));
          if (proposal.status !== "ready") return null;
          refreshPlan = proposal;
          continue;
        }
        if (operation.kind === "set-style") {
          if (scope !== "document" || base.some(page => page.manual)) return null;
          const data = z.object({ themes: z.array(z.object({ id: z.string(), current_version: z.number().int().positive() })) })
            .parse(await pitchRpc(ctx, { action: "catalog" }));
          const matches = data.themes.filter(value => value.id.split("-").includes(operation.style));
          if (matches.length !== 1) return null;
          theme = { id: matches[0].id, version: matches[0].current_version };
          continue;
        }
        if (operation.kind === "shorten" && operation.pages) {
          if (scope !== "document" || operation.pages >= base.length) return null;
          // Preserve manual work and the opening/closing pages. Proposed removals
          // are reviewed as part of the complete ordered document plan.
          const removable = base.slice(1, -1).filter(page => !page.manual).reverse();
          const removeCount = base.length - operation.pages;
          if (removable.length < removeCount) return null;
          for (const page of removable.slice(0, removeCount)) pageEdits.delete(page.id);
          continue;
        }
        if (operation.kind !== "revise-text") return null;
        const match = quoted.exec(operation.request);
        const replacement = match && (match[1] ?? match[2] ?? match[3]).trim();
        if (!replacement || !match) return null;
        const instruction = operation.request.slice(0, match.index);
        for (const page of selected) {
          const slide = slides.find(slide => slide.id === page.id)!;
          if (slide.content.disclosure === "restricted" || (slide.scene.pagination?.count ?? 1) !== 1) return null;
          const boundDataPage = workspace.page_settings[page.id]?.origin === "data";
          if (target.target.kind === "objects") {
            const anchors = textAnchors(slide.scene, slide.content, !boundDataPage);
            const edits: NonNullable<WorkspaceSave["pages"][number]["objectTexts"]> = [];
            for (const id of target.target.objectIds) {
              const anchor = anchors.get(id);
              if (!anchor || replacement.length > anchor.maxLength) return null;
              const old = anchor.kind === "title" ? slide.content.title : slide.content.blocks[anchor.block];
              const previous = typeof old === "string" ? old : old?.kind === "paragraph" ? old.text : null;
              if (previous === null || numbers(previous) !== numbers(replacement)) return null;
              edits.push({ id, text: replacement });
            }
            pageEdits.set(page.id, { id: page.id, objectTexts: edits });
          } else {
            if (page.manual) return null;
            if (/标题|\btitle\b/i.test(instruction)) {
              if (replacement.length > 160 || numbers(slide.content.title) !== numbers(replacement)) return null;
              pageEdits.set(page.id, { id: page.id, title: replacement });
            } else {
              const paragraphs = slide.content.blocks.filter(block => block.kind === "paragraph");
              if (boundDataPage || !/正文|段落|\bbody\b|\bparagraph\b/i.test(instruction) || paragraphs.length !== 1
                || replacement.length > 4000 || numbers(paragraphs[0].text) !== numbers(replacement)) return null;
              pageEdits.set(page.id, { id: page.id, paragraphs: [replacement] });
            }
          }
        }
      }
      return { id: randomUUID(), pages: [...pageEdits.values()],
        ...(refreshPlan ? { refresh: { id: refreshPlan.plan.id, version: refreshPlan.plan.version, contextFingerprint: refreshPlan.plan.contextFingerprint },
          gaps: refreshPlan.plan.gaps.map(gap => gap.reason) } : {}) };
    },
  };
  const outcome = await previewProposalRevision(input, port, ctx.signal, intention);
  if (outcome.status !== "ready") return outcome;
  if (quarterTransaction) return { ...outcome, scope, ...quarterTransaction };
  // Agent 06's document transaction accepts reviewed page edits. A refreshed
  // proposal has its own source review and can't be applied as a page edit.
  if (refreshPlan) return { ...outcome, status: "refresh-review" as const, scope, ...(theme ? { theme } : {}), refreshPlan };
  const command = { action: "apply_modification" as const, plan: outcome.plan, scope, ...(theme ? { theme } : {}) };
  if (chartPreview) workspaceCommandSchema.parse(command);
  return { ...outcome, scope, ...(theme ? { theme } : {}), ...(chartPreview ? { chartPreview } : {}), command };
}
