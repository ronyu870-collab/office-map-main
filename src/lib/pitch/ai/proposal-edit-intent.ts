import { z } from "zod";
import { normalizeProposalQuestion, proposalQuarters, proposalStyles } from "./proposal-brief";

const pageIds = z.array(z.uuid()).max(50).refine(values => new Set(values).size === values.length);
const objectIds = z.array(z.string().trim().min(1).max(160)).max(30).refine(values => new Set(values).size === values.length);
export const proposalRevisionRequestSchema = z.strictObject({
  projectId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  question: z.string().trim().min(1).max(1000),
  currentPageId: z.uuid().optional(),
  pageIds: pageIds.default([]),
  objectIds: objectIds.default([]),
});

export type ProposalRevisionRequest = z.infer<typeof proposalRevisionRequestSchema>;
export type ProposalEditIntent =
  | { kind: "revise-text"; request: string }
  | { kind: "shorten"; pages: number | null }
  | { kind: "set-style"; style: (typeof proposalStyles)[number] }
  | { kind: "set-language"; language: "zh" | "en" }
  | { kind: "set-period"; period: string | null }
  | { kind: "add-competitor"; buildingQuery: string }
  | { kind: "replace-photo"; category: "exterior" | "lobby" | "interior" | "any" }
  | { kind: "set-chart"; chart: "table" | "bar" | "column" | "line" | "scatter" }
  | { kind: "retarget"; targetClient: string };

export type ProposalEditTarget =
  | { kind: "deck" }
  | { kind: "pages"; pageIds: string[] }
  | { kind: "objects"; pageId: string; objectIds: string[] };

type EditRequest =
  | { kind: "clarification"; message: string }
  | { kind: "intent"; target: ProposalEditTarget; operations: ProposalEditIntent[]; verifyFacts: boolean };

function editOperation(question: string): ProposalEditIntent | null {
  const periods = proposalQuarters(question);
  if (periods.length === 1 || /(?:更新|改用|切到|换成|切换|update|switch).{0,20}(?:最新|latest).{0,10}(?:季度|quarter)/i.test(question)) {
    return { kind: "set-period", period: periods[0] ?? null };
  }
  const competitor = /(?:增加|添加|加入|补充|add)\s*(?:(?:一个|一栋|真实|real)\s*)?(?:(?:竞品|楼宇|competitor)\s*[为是:：]?\s*)?(.{2,80}?)\s*(?:(?:作为|为|到|加入)(?:竞品|对比)|(?:竞品|competitor)|$)/i.exec(question);
  if (competitor && /竞品|对比|competitor/.test(question)) {
    const buildingQuery = competitor[1].replace(/^[「“"]|[」”"。.!！]$/g, "").trim();
    return buildingQuery.length >= 2 ? { kind: "add-competitor", buildingQuery } : null;
  }
  if (/(?:换|替换|改用|更新|replace|swap).{0,35}(?:照片|图片|实景|photo)/i.test(question)) {
    const category = /外立面|外景|exterior/i.test(question) ? "exterior"
      : /大堂|lobby/i.test(question) ? "lobby"
        : /内景|室内|interior/i.test(question) ? "interior" : "any";
    return { kind: "replace-photo", category };
  }
  const chart = [
    ["table", /表格|\btable\b/i],
    ["bar", /条形|\bbar(?: chart)?\b/i],
    ["column", /柱状|\bcolumn(?: chart)?\b/i],
    ["line", /折线|\bline(?: chart)?\b/i],
    ["scatter", /散点|\bscatter(?: plot)?\b/i],
  ] as const;
  const selectedChart = chart.find(([, pattern]) => pattern.test(question));
  if (selectedChart && /改|调整|换|use|change|switch/i.test(question)) {
    return { kind: "set-chart", chart: selectedChart[0] };
  }
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
  if (/改写|重写|润色|(?:调整|改)(?:标题|文字|表达)|(?:标题|文字|对象).{0,8}(?:改为|改成|替换为)|改(?:这页|当前页|所选对象)|rewrite|rephrase|polish/i.test(question)) {
    return { kind: "revise-text", request: question };
  }
  return null;
}

export function readProposalEdit(input: ProposalRevisionRequest): EditRequest {
  const question = normalizeProposalQuestion(input.question);
  const clarification = (zh: string, en: string): EditRequest => ({
    kind: "clarification",
    message: /[\p{Script=Han}]/u.test(question) ? zh : en,
  });
  const deck = /整套|全套|整份|全部(?:页面|幻灯片)|整个(?:提案|文稿)|whole deck|entire (?:deck|presentation)|all slides/i.test(question);
  const object = /对象|图形|selected objects?/i.test(question) || input.objectIds.length > 0;
  if (deck && object) return clarification("请指定整套或所选对象。", "Choose the full deck or selected objects.");
  let target: ProposalEditTarget;
  if (object) {
    if (!input.currentPageId || !input.objectIds.length) return clarification("请选择当前页上的对象。", "Select objects on the current slide.");
    target = { kind: "objects", pageId: input.currentPageId, objectIds: input.objectIds };
  } else if (deck) target = { kind: "deck" };
  else if (input.pageIds.length) target = { kind: "pages", pageIds: input.pageIds };
  else if (input.currentPageId) target = { kind: "pages", pageIds: [input.currentPageId] };
  else return clarification("请选择要修改的页，或明确修改整套。", "Select slides or specify the full deck.");

  const directives = question.split(/[;；。]+|(?:，\s*)?(?:并且|并|然后|同时)(?=\s*(?:把|将|改|替换|换|加|补|更|精简|调整|翻译|切换))|\s+(?:and then|and)(?=\s+(?:change|update|switch|add|replace|shorten|translate|tailor))/i)
    .map(part => part.trim()).filter(Boolean);
  if (directives.length > 8) return clarification("请将修改拆成较少的步骤。", "Split the request into fewer changes.");
  const operations: ProposalEditIntent[] = [];
  for (const part of directives) {
    if (proposalQuarters(part).length > 1) return clarification("请确认本次要换用的季度。", "Specify one replacement quarter.");
    const operation = editOperation(part);
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
    verifyFacts: operations.some(item => ["set-period", "add-competitor", "replace-photo", "retarget", "set-chart"].includes(item.kind)),
  };
}
