import { z } from "zod";
import glossary from "@/src/i18n/professional-glossary.json";
import { type SlideContent } from "../contracts/content";

export type ProposalLanguage = "zh" | "en";
type Text = (ref: string, value: string) => string;

function glossaryIndex(source: "zh_cn" | "en_us", target: "zh_cn" | "en_us") {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of glossary) {
    const prior = index.get(entry[source]);
    if (prior && prior !== entry[target]) ambiguous.add(entry[source]);
    index.set(entry[source], entry[target]);
  }
  for (const term of ambiguous) index.delete(term);
  return index;
}
const terminology = { en: glossaryIndex("zh_cn", "en_us"), zh: glossaryIndex("en_us", "zh_cn") };

const numberTokens = (value: string) => JSON.stringify(value.normalize("NFKC").match(/[-+]?\d+(?:[.,]\d+)*(?:\s*%)?/g)?.map(token =>
  token.replace(/\s+/g, "")) ?? []);
export const sameTranslationNumbers = (before: string, after: string) => numberTokens(before) === numberTokens(after);
export function knownTranslation(text: string, language: ProposalLanguage) {
  const source = text.trim();
  if (!source || /^(?:[+-]?[0-9.,:%\s-]+|(?:20\d{2}-?)?Q[1-4]|CBD|LEED|WELL|BOMA|PM2\.5)$/i.test(source)) return text;
  const expected = language === "en" ? /\p{Script=Han}/u : /\p{Script=Latin}{2}/u;
  if (!expected.test(source)) return text;
  const translated = terminology[language].get(source);
  return translated !== undefined && sameTranslationNumbers(source, translated) ? translated : undefined;
}

const optionalImageText = z.object({ caption: z.string().optional() });
const optionalScatterText = z.object({ xAxis: z.object({ label: z.string() }).passthrough().optional() });

function translateBlock(block: SlideContent["blocks"][number], index: number, text: Text): SlideContent["blocks"][number] {
  const base = "block:" + index;
  switch (block.kind) {
    case "paragraph":
      return { ...block, text: text(base, block.text) };
    case "metric":
      return { ...block, label: text(base + ":label", block.label) };
    case "image": {
      const { caption } = optionalImageText.parse(block);
      return { ...block, alt: text(base + ":alt", block.alt),
        ...(caption === undefined ? {} : { caption: text(base + ":caption", caption) }) };
    }
    case "table":
      return { ...block, columns: block.columns.map((column, i) => text(`${base}:column:${i}`, column)),
        rows: block.rows.map((row, i) => row.map((cell, j) => typeof cell === "string" ? text(`${base}:cell:${i}:${j}`, cell) : cell)) };
    case "chart": {
      const { xAxis } = optionalScatterText.parse(block);
      return { ...block, categories: block.categories.map((category, i) => text(`${base}:category:${i}`, category)),
        series: block.series.map((series, i) => ({ ...series, name: text(`${base}:series:${i}`, series.name) })),
        ...(xAxis ? { xAxis: { ...xAxis, label: text(base + ":xaxis", xAxis.label) } } : {}) };
    }
    case "map":
      return { ...block, ...(block.points ? { points: block.points.map((point, i) => ({ ...point,
        label: text(`${base}:point:${i}`, point.label) })) } : {}) };
    case "timeline":
      return { ...block, entries: block.entries.map((entry, i) => ({
        ...entry, title: text(`${base}:entry:${i}:title`, entry.title), description: text(`${base}:entry:${i}:description`, entry.description),
      })) };
    case "team":
      return { ...block, members: block.members.map((member, i) => ({
        ...member, title: text(`${base}:member:${i}:title`, member.title), biography: text(`${base}:member:${i}:bio`, member.biography),
      })) };
    case "case":
      return { ...block, title: text(base + ":title", block.title), challenge: text(base + ":challenge", block.challenge),
        approach: text(base + ":approach", block.approach), outcome: text(base + ":outcome", block.outcome) };
    case "insight":
      return { ...block, claim: text(base + ":claim", block.claim), basis: text(base + ":basis", block.basis),
        limitations: block.limitations.map((part, i) => text(`${base}:limitation:${i}`, part)) };
  }
}

export function localizeProposalContent(content: SlideContent, language: ProposalLanguage, text: Text): SlideContent {
  return {
    ...content, locale: language, title: text("title", content.title),
    ...(content.subtitle ? { subtitle: text("subtitle", content.subtitle) } : {}),
    blocks: content.blocks.map((block, index) => translateBlock(block, index, text)),
  };
}
