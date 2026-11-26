import { z } from "zod";
import { QUESTION_SUBMARKETS } from "@/src/lib/intelligence/query/question";

export const proposalScenarios = [
  "leasing-agency",
  "office-comparison",
  "market-report",
  "building-promotion",
  "site-selection",
  "analysis-briefing",
] as const;

const scenarioRules = [
  ["leasing-agency", /招商代理|独家招商|leasing (?:agency|mandate)|landlord representation/i],
  ["market-report", /(?:季度|写字楼|办公楼|office).{0,28}(?:市场报告|市场季报|market report)|(?:市场报告|market report).{0,28}(?:季度|写字楼|office)/i],
  ["building-promotion", /项目推介|楼宇推介|楼宇介绍|项目介绍|高端推介|building (?:profile|presentation)|property showcase/i],
  ["site-selection", /选址|选楼|租户代表|site selection|occupier advisory/i],
  ["analysis-briefing", /(?:现有|已有|当前)分析(?:结果)?|(?:existing|current) analysis/i],
  ["office-comparison", /(?:比较|对比).{0,36}(?:写字楼|楼宇|办公楼|竞品|栋)|(?:office|building|property) comparison/i],
] as const;

const priorities = ["cost", "availability", "commute", "leasing-strategy", "market-trend", "building-quality"] as const;
const priorityRules = [
  ["cost", /租金|预算|成本|rent|budget|cost/i],
  ["availability", /空置|面积|可租|vacancy|availability|floor area/i],
  ["commute", /交通|通勤|地铁|commute|transport|metro/i],
  ["leasing-strategy", /招租|招商策略|去化|目标客群|leasing strategy|target tenant/i],
  ["market-trend", /趋势|同比|环比|走势|trend|year.over.year/i],
  ["building-quality", /硬件|楼宇品质|设施|配套|amenities|specifications/i],
] as const;

const scenarioDefaults = {
  "leasing-agency": { pages: 19, priorities: ["leasing-strategy", "market-trend", "availability", "cost"] },
  "office-comparison": { pages: 11, priorities: ["cost", "availability", "commute", "building-quality"] },
  "market-report": { pages: 16, priorities: ["market-trend", "availability", "cost"] },
  "building-promotion": { pages: 8, priorities: ["building-quality", "commute", "availability"] },
  "site-selection": { pages: 11, priorities: ["cost", "availability", "commute"] },
  "analysis-briefing": { pages: 6, priorities: [] },
} satisfies Record<(typeof proposalScenarios)[number], { pages: number; priorities: (typeof priorities)[number][] }>;

export const proposalStyles = ["professional", "premium", "research"] as const;
const text = z.string().trim().min(1).max(120);
const ids = z.array(z.uuid()).max(20).refine(list => new Set(list).size === list.length);
const quarter = z.string().regex(/^20\d{2}-Q[1-4]$/);
export const proposalRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  projectId: z.uuid().optional(),
  buildingIds: ids.default([]),
  assetIds: ids.default([]),
  analysisResultId: z.uuid().optional(),
  city: text.optional(),
  language: z.enum(["zh", "en"]).optional(),
  period: quarter.optional(),
  audience: z.enum(["internal", "client"]).default("internal"),
});
export type ProposalRequest = z.infer<typeof proposalRequestSchema>;

export const confirmedProposalSchema = z.strictObject({
  projectId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  taskId: z.uuid(),
  planId: z.uuid(),
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  request: proposalRequestSchema.extend({ projectId: z.uuid() }),
}).refine(input => input.projectId === input.request.projectId);
export type ConfirmedProposal = z.infer<typeof confirmedProposalSchema>;

export type ProposalBrief = {
  scenario: (typeof proposalScenarios)[number] | null;
  language: "zh" | "en";
  style: (typeof proposalStyles)[number];
  targetClient: string | null;
  city: string | null;
  submarkets: string[];
  buildingQueries: string[];
  buildingIds: string[];
  comparisonCount: number | null;
  grade: "A" | null;
  start: string | null;
  period: string | null;
  periodConflict: boolean;
  priorities: (typeof priorities)[number][];
  pages: number;
  requiresInterpretation: boolean;
};

export function normalizeProposalQuestion(question: string) {
  return question.normalize("NFKC").trim();
}

export function proposalQuarters(question: string) {
  return [...new Set(Array.from(
    question.matchAll(/(20\d{2})(?:\s*-?\s*Q\s*([1-4])|\s*年?\s*(?:第)?\s*([一二三四1234])\s*季(?:度)?)/gi),
    match => `${match[1]}-Q${match[2] ?? (Number(match[3]) || "一二三四".indexOf(match[3]) + 1)}`,
  ))];
}

function naturalNumber(value?: string) {
  if (!value) return null;
  const digit = (letter = "") => letter === "两" ? 2 : letter ? "一二三四五六七八九".indexOf(letter) + 1 : 0;
  if (/^\d+$/.test(value)) return Number(value);
  if (!value.includes("十")) return digit(value);
  const [tens, ones] = value.split("十");
  return 10 * (tens ? digit(tens) : 1) + digit(ones);
}

export function readProposalBrief(input: ProposalRequest): ProposalBrief {
  const question = normalizeProposalQuestion(input.question);
  const matches = scenarioRules.filter(([, pattern]) => pattern.test(question)).map(([scenario]) => scenario);
  const scenario = matches[0] ?? null;
  const explicitLanguage = /英文版?|英语|\b(?:in english|english version)\b/i.test(question)
    ? "en" : /中文版?|中文|\b(?:in chinese|chinese version)\b/i.test(question) ? "zh" : undefined;
  const city = ["北京", "上海", "深圳", "广州", "成都", "天津", "杭州"].find(value => question.includes(value))
    ?? (/\bBeijing\b/i.test(question) ? "北京" : null);
  const periods = proposalQuarters(question);
  const hasRange = periods.length === 2 && /至|到|—|\bto\b|\bthrough\b|Q[1-4]\s*-\s*20/i.test(question);
  const latest = /最新|latest|most recent/i.test(question);
  const namedBuilding = /(?:为|关于|以)\s*(.{2,60}?)\s*(?:制作|生成|出具|做一份|做一套|做)(?=.{0,50}(?:招商|推介|楼宇介绍|项目介绍))/i.exec(question)?.[1];
  const suffixBuilding = /^(?:请|帮我|请帮我)?\s*(?:制作|生成|做一份)?\s*(.{2,60}?)(?:的)?(?:高端)?(?:招商代理提案|项目推介|楼宇推介|楼宇介绍)/i.exec(question)?.[1];
  const comparison = /(?:比较|对比)\s*(.{3,100}?)\s*(?:的)?(?:项目|楼宇|写字楼)?\s*(?:[。.!！]|$)/i.exec(question)?.[1];
  const listedBuildings = comparison && /[、,]|\s+vs\.?\s+/i.test(comparison)
    ? comparison.split(/\s*(?:[、,]|\s+vs\.?\s+)\s*/i).map(value => value.trim()).filter(Boolean)
    : [];
  const englishBuilding = /(?:leasing (?:agency|mandate)|landlord representation|building (?:profile|presentation)|property showcase)\s+(?:proposal\s+)?(?:for|of)\s+([^,.;!]{2,60})(?=[,.;!]|$)/i.exec(question)?.[1];
  const building = namedBuilding ?? suffixBuilding ?? englishBuilding;
  const buildingQuery = building?.replace(/^[「“"]|[」”"]$/g, "").trim();
  const count = /([一二两三四五六七八九十\d]{1,3})\s*栋/i.exec(question);
  const pageCount = naturalNumber(/([一二两三四五六七八九十\d]{1,3})\s*(?:页|slides?\b)/i.exec(question)?.[1]);
  const explicitPriorities = priorityRules.filter(([, test]) => test.test(question)).map(([priority]) => priority);
  const requestedScenario = scenario ? scenarioDefaults[scenario] : null;
  const style = /高端|精致|premium|luxury/i.test(question) ? "premium"
    : scenario === "market-report" || /研究风格|research style/i.test(question) ? "research" : "professional";

  return {
    scenario,
    language: explicitLanguage ?? input.language ?? (/[\p{Script=Han}]/u.test(question) ? "zh" : "en"),
    style,
    targetClient: /(?:为|面向|给|代表)\s*(.{2,70}?(?:银行|保险|券商|企业|基金|业主|集团|投资方))(?=\s*(?:制作|生成|做|选址|撰写|汇报|[，,。]|$))/i.exec(question)?.[1] ?? null,
    city: city ?? input.city ?? null,
    submarkets: QUESTION_SUBMARKETS.filter(value =>
      value === "CBD" ? /\bCBD\b|中央商务区/i.test(question) : question.includes(value)),
    buildingQueries: listedBuildings.length ? listedBuildings : buildingQuery ? [buildingQuery] : [],
    buildingIds: input.buildingIds,
    comparisonCount: naturalNumber(count?.[1]),
    grade: /甲级|grade[ -]a\b/i.test(question) ? "A" : null,
    start: hasRange ? periods[0] : null,
    period: periods.at(-1) ?? (latest ? null : input.period ?? null),
    periodConflict: periods.length > 2 || (periods.length === 2 && (!hasRange || periods[0] > periods[1])),
    priorities: explicitPriorities.length ? explicitPriorities : requestedScenario?.priorities ?? [],
    pages: pageCount && pageCount >= 3 && pageCount <= 20 ? pageCount : requestedScenario?.pages ?? 8,
    requiresInterpretation: !scenario || matches.length > 1
      || (!!scenario && ["leasing-agency", "building-promotion"].includes(scenario) && !buildingQuery && !input.buildingIds.length && !input.projectId)
      || /重构叙事|重写故事线|综合权衡|自定义口径|从.{1,20}(?:视角|角度)|\b(?:trade.off|tailor|perspective)\b/i.test(question),
  };
}

// Model responses only fill planning slots. No data values, executable arguments,
// URLs, instructions, evidence from assets or arbitrary slide prose are accepted.
export const proposalInterpretationSchema = z.strictObject({
  scenario: z.enum(proposalScenarios),
  style: z.enum(proposalStyles).optional(),
  priorities: z.array(z.enum(priorities)).max(priorities.length).optional(),
  targetClient: text.optional(),
  buildingQueries: z.array(text).max(10).optional(),
});
export type ProposalInterpretation = z.infer<typeof proposalInterpretationSchema>;

export function mergeProposalInterpretation(
  parsed: ProposalBrief, question: string, raw: unknown,
): ProposalBrief | null {
  const response = proposalInterpretationSchema.safeParse(raw);
  if (!response.success) return null;
  const value = response.data;
  const literal = normalizeProposalQuestion(question).toLowerCase();
  const phrases = [value.targetClient, ...(value.buildingQueries ?? [])].filter(
    (entry): entry is string => entry !== undefined,
  );
  if (phrases.some(entry => !literal.includes(entry.toLowerCase()))) return null;
  const scenario = parsed.scenario ?? value.scenario;
  const defaults = scenarioDefaults[scenario];
  return {
    ...parsed,
    scenario,
    pages: parsed.scenario ? parsed.pages : defaults.pages,
    targetClient: parsed.targetClient ?? value.targetClient ?? null,
    buildingQueries: parsed.buildingQueries.length ? parsed.buildingQueries : value.buildingQueries ?? [],
    style: parsed.style === "professional" ? value.style ?? parsed.style : parsed.style,
    priorities: [...new Set([...(value.priorities ?? []), ...parsed.priorities, ...(!parsed.scenario ? defaults.priorities : [])])],
  };
}
