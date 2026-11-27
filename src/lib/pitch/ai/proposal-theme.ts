import { z } from "zod";
import { pitchRpc, type PitchContext } from "../data/store";
import type { ProposalStyle } from "../integration-contracts";

const themeIds: Record<ProposalStyle, string> = {
  professional: "colliers-corporate-executive",
  premium: "colliers-premium-portfolio",
  research: "colliers-market-intelligence",
};
const catalogue = z.object({ themes: z.array(z.object({ id: z.string(), current_version: z.number().int().positive() })) });

export function registeredProposalTheme(raw: unknown, style: ProposalStyle) {
  const parsed = catalogue.safeParse(raw);
  if (!parsed.success) return undefined;
  const matching = parsed.data.themes.filter(entry => entry.id === themeIds[style]);
  if (matching.length !== 1) return undefined;
  return { id: matching[0].id, version: matching[0].current_version };
}

export async function requestedProposalTheme(ctx: PitchContext, style?: ProposalStyle) {
  return style && registeredProposalTheme(await pitchRpc(ctx, { action: "catalog" }), style);
}

export function missingProposalTheme(language: "zh" | "en") {
  return { pageKind: "theme", reason: language === "en"
    ? "The requested presentation theme is unavailable in the current registry."
    : "主题目录当前没有登记所请求风格的可用版本。" };
}
