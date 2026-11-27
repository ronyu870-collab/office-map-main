import { z } from "zod";
import { normalizeProposalQuestion, proposalQuarters, proposalStyles } from "./proposal-brief";

const pageIds = z.array(z.uuid()).max(50).refine(values => new Set(values).size === values.length);
// Match complete quoted text before command separators. The original span is
// retained for literal text edits, while intent checks only see the command.
const quotedText = /《[^》]*》|「[^」]*」|“[^”]*”|"[^"]*"|＂[^＂]*＂/gu;
const directiveSeparator = /[;；。]+|(?:，\s*)?(?:并且|并|然后|同时)(?=\s*(?:把|将|改|替换|换|加|补|更|精简|调整|翻译|切换))|\s+(?:and then|and)(?=\s+(?:change|update|switch|add|replace|shorten|translate|tailor))/gi;
const maskQuotedText = (text: string) => text.replace(quotedText, match => " ".repeat(match.length));

const objectIds = z.array(z.string().trim().min(1).max(160)).max(30).refine(values => new Set(values).size === values.length);
export const proposalRevisionRequestSchema = z.strictObject({
  projectId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  question: z.string().trim().min(1).max(1000),
  currentPageId: z.uuid().optional(),
  competitorBuildingId: z.uuid().optional(),
  pageIds: pageIds.default([]),
  objectIds: objectIds.default([]),
});

export type ProposalRevisionRequest = z.infer<typeof proposalRevisionRequestSchema>;
export type ProposalChart = "table" | "bar" | "column" | "line" | "scatter";
export type ProposalEditIntent =
  | { kind: "revise-text"; request: string }
  | { kind: "shorten"; pages: number | null }
  | { kind: "set-style"; style: (typeof proposalStyles)[number] }
  | { kind: "set-language"; language: "zh" | "en" }
  | { kind: "set-period"; period: string | null }
  | { kind: "add-competitor"; buildingQuery: string }
  | { kind: "replace-photo"; category: "exterior" | "lobby" | "interior" | "any" }
  | { kind: "set-chart"; chart: ProposalChart; from?: ProposalChart; all?: true }
  | { kind: "retarget"; targetClient: string };

export type ProposalEditTarget =
  | { kind: "deck" }
  | { kind: "pages"; pageIds: string[] }
  | { kind: "objects"; pageId: string; objectIds: string[] };

type EditRequest =
  | { kind: "clarification"; message: string }
  | { kind: "intent"; target: ProposalEditTarget; operations: ProposalEditIntent[]; verifyFacts: boolean };

const reviseText = /改写|重写|润色|(?:调整|改)(?:标题|正文|文字|表达)|(?:标题|正文|文字|对象|\btitle\b|\bbody\b).{0,22}(?:改为|改成|替换为|replace|change)|改(?:这页|当前页|所选对象)|rewrite|rephrase|polish/i;
const chartTypes = [
  ["table", /表格|\btable\b/i],
  ["bar", /条形|横条|\bbar(?: chart)?\b/i],
  ["column", /柱状|柱形|\bcolumn(?: chart)?\b/i],
  ["line", /折线|\bline(?: chart)?\b/i],
  ["scatter", /散点|\bscatter(?: plot)?\b/i],
] as const;

function chartOperation(question: string): Extract<ProposalEditIntent, { kind: "set-chart" }> | null {
  if (!/改|调整|换|转换|use|change|switch|convert/i.test(question)) return null;
  const matches = (text: string) => chartTypes.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
  const to = /改为|改成|换成|换为|换到|调整为|替换为|切换到|转换成|改用|\b(?:to|as|into|use)\s+/i.exec(question);
  const target = matches(to ? question.slice(to.index + to[0].length) : question);
  const from = to ? matches(question.slice(0, to.index)) : [];
  if (target.length !== 1 || from.length > 1) return null;
  return { kind: "set-chart", chart: target[0], ...(from[0] ? { from: from[0] } : {}),
    ...(/(?:全部|所有)图表|all charts/i.test(question) ? { all: true as const } : {}) };
}

function editOperation(question: string, literal: string): ProposalEditIntent | null {
  const periods = proposalQuarters(question);
  if ((periods.length === 1 && /更新|改用|切到|换成|切换|改为|改成|update|switch/i.test(question)) || /(?:更新|改用|切到|换成|切换|update|switch).{0,20}(?:最新|latest).{0,10}(?:季度|quarter)/i.test(question)) {
    return { kind: "set-period", period: periods[0] ?? null };
  }
  const namedBeforeVerb = /(?:把|将)\s*([^,，。]{2,80}?)\s*(?:加入|添加到)\s*(?:目前的?|当前的?)?(?:竞品|对比)/iu.exec(question)?.[1];
  const quotedCompetitor = /(?:新增|增加|添加|加入|补充|追加|add).{0,18}?[「“"]([^」”"]{2,80})[」”"]/i.exec(question)?.[1];
  const competitor = /(?:新增|增加|添加|加入|补充|追加|\badd\b)\s*(?:(?:一个|一栋|真实|real)\s*)?(?:竞品\s*[为是:：]?\s*|(?:楼宇|competitor)(?:\s+|[:：]\s*))?(.{2,80}?)\s*(?:(?:作为|为|到|加入)(?:竞品|对比)|\bas (?:a )?competitor\b|\bto (?:the )?comparison\b|竞品|\bcompetitor\b|$)/i.exec(question);
  const competitorPhrase = namedBeforeVerb ?? quotedCompetitor ?? competitor?.[1];
  if (competitorPhrase && /竞品|对比|competitor|comparison/i.test(question)) {
    const buildingQuery = competitorPhrase.replace(/^[「“"]|[」”"。.!！]$/g, "").trim();
    return buildingQuery.length >= 2 ? { kind: "add-competitor", buildingQuery } : null;
  }
  if (/(?:换|替换|改用|更新|replace|swap).{0,35}(?:照片|图片|实景|photo)/i.test(question)) {
    const category = /外立面|外景|exterior/i.test(question) ? "exterior"
      : /大堂|lobby/i.test(question) ? "lobby"
        : /内景|室内|interior/i.test(question) ? "interior" : "any";
    return { kind: "replace-photo", category };
  }
  const chart = chartOperation(question);
  if (chart) return chart;
  if (/(?:改|换|切换|翻译|translate|switch).{0,28}(?:英文版?|英语|English)/i.test(question)) return { kind: "set-language", language: "en" };
  if (/(?:改|换|切换|翻译|translate|switch).{0,28}(?:中文版?|汉语|Chinese)/i.test(question)) return { kind: "set-language", language: "zh" };
  if (/风格|style|theme/i.test(question)) {
    const style = /高端|精致|premium/i.test(question) ? "premium"
      : /研究|research/i.test(question) ? "research"
        : /商务|专业|professional/i.test(question) ? "professional" : null;
    if (style) return { kind: "set-style", style };
  }
  if (/压缩|精简|缩短|shorten|condense/i.test(question)) {
    const count = Number(/(?:到|至|为|to)\s*(\d{1,2})\s*(?:页|slides?)/i.exec(question)?.[1]);
    return { kind: "shorten", pages: Number.isInteger(count) && count > 0 && count <= 50 ? count : null };
  }
  const customer = /(?:改为|改成|改作|调整为|调整成|重做为|面向|tailor (?:it )?for)\s*(.{2,80}?)(?:的?(?:选址方案|提案|汇报)|[。.!！]|$)/i.exec(question)?.[1];
  if (customer && /客户|企业|业主|投资方|银行|保险|券商|基金|client|customer|investor|bank/i.test(customer)) {
    return { kind: "retarget", targetClient: customer.replace(/^面向\s*/, "") };
  }
  if (reviseText.test(question)) {
    return { kind: "revise-text", request: literal };
  }
  return null;
}

export function readProposalEdit(input: ProposalRevisionRequest): EditRequest {
  const question = input.question.trim();
  const intentText = normalizeProposalQuestion(maskQuotedText(question));
  const clarification = (zh: string, en: string): EditRequest => ({
    kind: "clarification",
    message: /[\p{Script=Han}]/u.test(question) ? zh : en,
  });
  const deck = /整套|全套|整份|全部(?:页面|幻灯片)|整个(?:提案|文稿)|whole deck|entire (?:deck|presentation)|all slides/i.test(intentText);
  const object = /对象|图形|selected objects?/i.test(intentText) || input.objectIds.length > 0;
  if (deck && object) return clarification("请指定整套或所选对象。", "Choose the full deck or selected objects.");
  let target: ProposalEditTarget;
  if (object) {
    if (!input.currentPageId || !input.objectIds.length) return clarification("请选择当前页上的对象。", "Select objects on the current slide.");
    target = { kind: "objects", pageId: input.currentPageId, objectIds: input.objectIds };
  } else if (deck) target = { kind: "deck" };
  else if (input.pageIds.length) target = { kind: "pages", pageIds: input.pageIds };
  else if (input.currentPageId) target = { kind: "pages", pageIds: [input.currentPageId] };
  else return clarification("请选择要修改的页，或明确修改整套。", "Select slides or specify the full deck.");

  const directives = [];
  let start = 0;
  for (const separator of maskQuotedText(question).matchAll(directiveSeparator)) {
    directives.push(question.slice(start, separator.index).trim());
    start = separator.index + separator[0].length;
  }
  directives.push(question.slice(start).trim());
  const instructions = directives.filter(Boolean);
  if (instructions.length > 8) return clarification("请将修改拆成较少的步骤。", "Split the request into fewer changes.");
  const operations: ProposalEditIntent[] = [];
  for (const part of instructions) {
    const masked = maskQuotedText(part);
    if (part !== masked && reviseText.test(normalizeProposalQuestion(masked))) {
      operations.push({ kind: "revise-text", request: part });
      continue;
    }
    const normalized = normalizeProposalQuestion(part);
    if (proposalQuarters(normalized).length > 1) return clarification("请确认本次要换用的季度。", "Specify one replacement quarter.");
    const operation = editOperation(normalized, part);
    if (!operation) return clarification("请明确各项修改的目标，例如换用正式季度或所选楼宇的外立面照片。", "Specify each change, such as a formal quarter or an exterior photo.");
    operations.push(operation);
  }
  if (!operations.length) return clarification("请说明需要修改的内容。", "Specify what you want to change.");
  if (new Set(operations.map(item => item.kind)).size !== operations.length) {
    return clarification("同类修改请明确一个目标。", "Specify one change of each type.");
  }
  if (target.kind === "objects" && operations.some(item => !["revise-text", "shorten", "replace-photo", "set-chart", "set-language"].includes(item.kind))) {
    return clarification("这项修改需要选择页面或整套提案。", "This change requires page or deck scope.");
  }
  return {
    kind: "intent",
    target,
    operations,
    verifyFacts: operations.some(item => ["set-period", "add-competitor", "replace-photo", "retarget"].includes(item.kind)
      || item.kind === "set-chart" && (item.chart === "table" || item.chart === "scatter")),
  };
}
