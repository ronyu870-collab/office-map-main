import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const refs = z.array(id).min(1).max(8);
const sourceUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(600).refine(value => {
  const url = URL.canParse(value) ? new URL(value) : null;
  if (!url) return false;
  return !url.username && !url.password
    && !/(?:^|\.)(?:supabase\.(?:co|in)|vercel\.app|github\.com|sharepoint\.com|drive\.google\.com)$/i.test(url.hostname)
    && !Array.from(url.searchParams.keys()).some(key => /token|signature|password|secret/i.test(key));
}, '请输入可公开访问的来源链接');

const sourceSchema = z.strictObject({
  id,
  title: text(180),
  publisher: text(100),
  url: sourceUrl,
  publishedOn: z.iso.date().nullable(),
  observedAt: text(80),
  verifiedOn: z.iso.date(),
  scope: text(140),
  scopeType: z.enum(['administrative', 'functional', 'project', 'network', 'external_market']),
  basis: text(420),
});
const factSchema = z.strictObject({
  title: text(100),
  body: text(400),
  kind: z.enum(['place', 'industry', 'policy', 'transit', 'supply']),
  status: z.enum(['observed', 'planned']),
  sourceIds: refs,
  measure: z.strictObject({ value: text(40).regex(/\d/), unit: text(32) }).optional(),
  lines: z.array(text(24)).min(1).max(6).optional(),
});
const observationSchema = z.strictObject({
  title: text(100),
  body: text(500),
  kind: z.enum(['inference', 'outlook']),
  asOf: text(80),
  scope: text(140),
  limitation: text(300),
  sourceIds: refs,
});

export const researchFocus = ['grade-rent', 'matched-rent', 'matched-vacancy', 'stock'] as const;
export const submarketIntelligenceSchema = z.strictObject({
  version: z.literal(1),
  market: text(60),
  positioning: text(120),
  updatedOn: z.iso.date(),
  focus: z.enum(researchFocus),
  sources: z.array(sourceSchema).min(1).max(20),
  facts: z.array(factSchema).min(1).max(16),
  observations: z.array(observationSchema).min(1).max(8),
  projects: z.array(z.strictObject({
    buildingId: z.uuid(),
    role: text(50),
    reason: text(300),
    sourceIds: refs,
  })).max(8),
}).superRefine((value, ctx) => {
  const sources = new Map(value.sources.map(source => [source.id, source]));
  if (sources.size !== value.sources.length) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: '来源编号必须唯一' });
  }
  const usedSources = new Set<string>();
  for (const kind of ['facts', 'observations', 'projects'] as const) {
    value[kind].forEach((item, index) => {
      for (const sourceId of item.sourceIds) usedSources.add(sourceId);
      if (new Set(item.sourceIds).size !== item.sourceIds.length || item.sourceIds.some(sourceId => !sources.has(sourceId))) {
        ctx.addIssue({ code: 'custom', path: [kind, index, 'sourceIds'], message: '请选择不重复的有效来源' });
      }
    });
  }
  for (const [index, source] of value.sources.entries()) {
    if (source.verifiedOn > value.updatedOn || (source.publishedOn && source.publishedOn > source.verifiedOn)) {
      ctx.addIssue({ code: 'custom', path: ['sources', index, 'verifiedOn'], message: '发布、核验与资料更新日期顺序不正确' });
    }
    if (!usedSources.has(source.id)) {
      ctx.addIssue({ code: 'custom', path: ['sources', index], message: '来源须关联事实、观点或项目' });
    }
  }
  for (const kind of ['facts', 'observations'] as const) {
    if (new Set(value[kind].map(item => item.title)).size !== value[kind].length) {
      ctx.addIssue({ code: 'custom', path: [kind], message: '同一版资料的标题须唯一' });
    }
  }
  for (const [index, fact] of value.facts.entries()) {
    if (fact.lines && (fact.kind !== 'transit' || fact.sourceIds.every(sourceId => sources.get(sourceId)?.scopeType !== 'network'))) {
      ctx.addIssue({ code: 'custom', path: ['facts', index, 'lines'], message: '轨道线路需要对应的交通来源' });
    }
    if (fact.measure && !fact.sourceIds.some(sourceId => {
      const basis = sources.get(sourceId)?.basis.replaceAll(',', '');
      return fact.measure?.value.match(/\d+(?:\.\d+)?/g)?.every(number => basis?.includes(number));
    })) ctx.addIssue({ code: 'custom', path: ['facts', index, 'measure'], message: '指标数值必须可在引用的证据摘要中查到' });
    if (fact.measure && fact.status === 'planned') {
      ctx.addIssue({ code: 'custom', path: ['facts', index, 'measure'], message: '规划目标须在规划条目中说明，不能作为观测指标' });
    }
  }
  if (new Set(value.projects.map(project => project.buildingId)).size !== value.projects.length) {
    ctx.addIssue({ code: 'custom', path: ['projects'], message: '代表项目必须唯一' });
  }
});

export type SubmarketIntelligence = z.infer<typeof submarketIntelligenceSchema>;
export type SubmarketResearchVersion = {
  id: string;
  savedAt: string;
  wasPublished: boolean;
  research: SubmarketIntelligence | null;
};

export function readSubmarketIntelligence(value: unknown, market: string): SubmarketIntelligence | null {
  const parsed = submarketIntelligenceSchema.safeParse(value);
  return parsed.success && parsed.data.market === market ? parsed.data : null;
}

export function structuredResearchCopy(research: SubmarketIntelligence): string[] {
  const { positioning, facts, observations, projects, sources } = research;
  return [positioning,
    ...facts.flatMap(item => [item.title, item.body, item.measure?.value ?? '', item.measure?.unit ?? '', ...item.lines ?? []]),
    ...observations.flatMap(item => [item.title, item.body, item.scope, item.limitation, item.asOf]),
    ...projects.flatMap(item => [item.role, item.reason]),
    ...sources.flatMap(item => [item.title, item.publisher, item.basis, item.scope, item.observedAt]),
  ];
}

export const internalResearchMarkers = /(?:草稿|草案|待复核|待审核|待维护|待核查|研究提示|研究初稿|业务团队复核|内部|内参|未经批准|非正式|不作为高力国际|非高力国际|尚未核实|AI(?:公开|基于|依据|整理|生成|撰写)|由AI|人工智能生成)/i;
