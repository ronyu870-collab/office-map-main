import type { PitchScope } from "../contracts/content";
import type { PitchContextSnapshot, ProposalBrief } from "../integration-contracts";
import { buildProposal, PROPOSAL_RECIPES, type ProposalData, type ProposalOptions } from "../proposals";
import { projectUnifiedProposalContext, type ProposalMaterials, type UnifiedProposalContext } from "../proposals/unified-projection";
import type { ProposalDirectorPorts } from "./proposal-director";

type Composition = Awaited<ReturnType<ProposalDirectorPorts["compose"]>>;

export function composeRecipePages(snapshot: PitchContextSnapshot, data: ProposalData, options: ProposalOptions): Composition {
  const brief = snapshot.brief.scenario === "site-selection"
    ? { ...snapshot.brief, scenario: "office-comparison" as const } : snapshot.brief;
  const output = buildProposal({ ...snapshot, brief }, data, options);
  const byId = new Map(output.plan.slides.map(slide => [slide.id, slide]));
  const recipe = PROPOSAL_RECIPES[output.plan.id as keyof typeof PROPOSAL_RECIPES];
  return {
    recipeVersion: `${output.plan.id}/${output.plan.version}`,
    gaps: output.plan.gaps,
    pages: output.pages.map(page => {
      const intent = byId.get(page.id);
      if (!intent) throw new Error("PITCH_PROPOSAL_RECIPE_BINDING_MISSING");
      return {
        pageKind: page.pageKind,
        content: page.content,
        layoutId: page.layoutId,
        businessIntent: page.claimKind,
        essential: recipe?.pages.find(definition => definition.id === page.pageKind)?.fallback === "retain",
        dependencyKinds: page.follows,
        data: intent.data,
        visuals: intent.visuals,
      };
    }),
  };
}

/** Interop for Agent 08. Data and visual/material projection stay owned by the
 * respective authorized adapters. The model receives neither projection. */
export function composeUnifiedProposalPages(
  context: UnifiedProposalContext, brief: ProposalBrief, scope: PitchScope,
  options: ProposalOptions, materials?: ProposalMaterials,
): Composition {
  const { snapshot, data } = projectUnifiedProposalContext(context, brief, scope, materials);
  return { ...composeRecipePages(snapshot, data, options), queryReceipts: context.results };
}
