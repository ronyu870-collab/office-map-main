import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pitchRpc, type PitchContext } from "../data/store";
import { objectId, textAnchors } from "../workspace/object-layout";
import { workspaceDetailSchema, type WorkspaceSave } from "../workspace/protocol";
import { normalizeProposalQuestion, proposalRequestSchema, readProposalBrief } from "./proposal-brief";
import type { ProposalScenario } from "../integration-contracts";
import type { ProposalRevisionRequest } from "./proposal-edit-intent";
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
const quoted = /(?:改为|改成|换成|替换为|replace (?:it )?with|change (?:it )?to)\s*(?:《([^》]+)》|「([^」]+)」|[“"]([^”"]+)[”"])/i;

export async function planProposalRevision(ctx: PitchContext, input: ProposalRevisionRequest) {
  const current = versionedWorkspace.parse(await pitchRpc(ctx, { action: "workspace_get", projectId: input.projectId }));
  const { project, workspace, slides } = current;
  if (project.version !== input.expectedVersion) throw new Error("PITCH_CONFLICT");
  await pitchRpc(ctx, { action: "catalog" });
  let scope: "selected" | "document" = "selected";
  let theme: { id: string; version: number } | undefined;
  let refreshPlan: Extract<Awaited<ReturnType<typeof prepareProposal>>, { status: "ready" }> | undefined;
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
        if (operation.kind === "set-period") {
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
        const match = quoted.exec(normalizeProposalQuestion(operation.request));
        const replacement = match && (match[1] ?? match[2] ?? match[3]).trim();
        if (!replacement) return null;
        for (const page of selected) {
          const slide = slides.find(slide => slide.id === page.id)!;
          if (slide.content.disclosure === "restricted" || (slide.scene.pagination?.count ?? 1) !== 1) return null;
          if (target.target.kind === "objects") {
            const anchors = textAnchors(slide.scene, slide.content);
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
            if (page.manual || replacement.length > 160 || !/标题|\btitle\b/i.test(operation.request)
              || numbers(slide.content.title) !== numbers(replacement)) return null;
            pageEdits.set(page.id, { id: page.id, title: replacement });
          }
        }
      }
      return { id: randomUUID(), pages: [...pageEdits.values()],
        ...(refreshPlan ? { refresh: { id: refreshPlan.plan.id, version: refreshPlan.plan.version, contextFingerprint: refreshPlan.plan.contextFingerprint },
          gaps: refreshPlan.plan.gaps.map(gap => gap.reason) } : {}) };
    },
  };
  const outcome = await previewProposalRevision(input, port, ctx.signal);
  return outcome.status === "ready" ? { ...outcome, scope, ...(theme ? { theme } : {}), ...(refreshPlan ? { refreshPlan } : {}) } : outcome;
}
