import { z } from "zod";
import { caseDisplay } from "../business/content";
import { businessProfileSchema } from "../business/protocol";
import { slideContentSchema, type PitchScope } from "../contracts/content";
import { pitchRpc, type PitchContext } from "../data/store";
import type { ProposalBrief } from "../integration-contracts";
import { stableId } from "../library/extract";
import type { ProposalMaterials } from "../proposals/unified-projection";

const publishedAsset = z.object({
  asset: z.object({ id: z.uuid(), organization_id: z.string(), region: z.string(), city: z.string(),
    business_line: z.string(), state: z.literal("published") }),
  version: z.object({ version: z.number().int().positive(), state: z.literal("published"), content: slideContentSchema }),
  profile: businessProfileSchema,
});

export async function readProposalMaterials(ctx: PitchContext, brief: ProposalBrief, scope: PitchScope, assetIds: readonly string[]) {
  const evidence: Pick<ProposalMaterials, "team" | "case"> = {};
  const references: { id: string; version: number; sourceId: string }[] = [];
  for (const id of assetIds) {
    ctx.signal.throwIfAborted();
    const stored = publishedAsset.parse(await pitchRpc(ctx, { action: "business_generation_asset", assetId: id }));
    const { asset, version, profile } = stored;
    const content = version.content;
    if (asset.id !== id || asset.organization_id !== scope.organizationId || asset.region !== scope.region
      || asset.city !== scope.city || asset.business_line !== scope.businessLine || content.disclosure === "restricted") {
      throw new Error("PITCH_DENIED");
    }
    if (content.locale !== brief.language || content.isTestData || (profile.kind !== "team" && profile.kind !== "case")) continue;
    const display = profile.kind === "case"
      ? caseDisplay({ id, version: version.version, scope, content, profile }) : content;
    const sourceId = stableId(`pitch-proposal-material/1:${id}:${version.version}`);
    const bound = (sourceIds: string[]) => ({
      publication: "published" as const, disclosure: content.disclosure,
      sources: [...display.sources.filter(source => sourceIds.includes(source.id)),
        { id: sourceId, kind: "record" as const, recordId: id, dataAsOf: display.dataAsOf,
          version: String(version.version), locator: `Pitch Library v${version.version}`, label: display.title }],
    });
    const block = display.blocks.find(block => block.kind === profile.kind);
    if (!evidence.case && block?.kind === "case") {
      evidence.case = { ...bound(block.sourceIds), value: block };
    } else if (!evidence.team && profile.kind === "team") {
      const name = profile.name[brief.language], title = profile.position[brief.language];
      if (!name || !title) continue;
      const sourceIds = content.sources.map(source => source.id);
      evidence.team = { ...bound(sourceIds), value: { kind: "team", sourceIds,
        members: [{ name, title, biography: `${profile.team}\n${content.dataAsOf}` }] } };
    } else continue;
    references.push({ id, version: version.version, sourceId });
  }
  return { evidence, references };
}
