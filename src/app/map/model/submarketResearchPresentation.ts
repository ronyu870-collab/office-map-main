import type { SubmarketIntelligence } from './submarketIntelligence';

/** Presentation-only contract. The published edition remains the source of truth. */
export type ResearchReadingMode = 'quick' | 'standard' | 'expanded';
export type ResearchMarketType = 'office' | 'park' | 'mixed';
export type ResearchTheme = 'competition' | 'demand' | 'location' | 'outlook';
export type ResearchFactVariant = 'number' | 'comparison' | 'supply' | 'case' | 'transit' | 'text';
type Fact = SubmarketIntelligence['facts'][number];
type Observation = SubmarketIntelligence['observations'][number];

export type ResearchFactPresentation = {
  key: string;
  title: string;
  body: string;
  context: string;
  theme: ResearchTheme;
  variant: ResearchFactVariant;
  status: Fact['status'];
  measure?: Fact['measure'];
  lines?: Fact['lines'];
};
export type ResearchObservationPresentation = {
  key: string;
  title: string;
  body: string;
  context: string;
  theme: ResearchTheme;
};
export type ResearchChapter = {
  theme: ResearchTheme;
  title: string;
  observations: ResearchObservationPresentation[];
  facts: ResearchFactPresentation[];
};
export type SubmarketResearchPresentation = {
  marketType: ResearchMarketType;
  positioning: string;
  lead: ResearchObservationPresentation | null;
  previewFacts: ResearchFactPresentation[];
  chapters: ResearchChapter[];
  projects: SubmarketIntelligence['projects'];
};

const chapterTitles: Record<ResearchTheme, string> = {
  competition: '供应与竞争格局',
  demand: '产业及租赁需求',
  location: '区位与长期价值',
  outlook: '市场展望',
};

/**
 * Older published editions may still name commercial research providers.
 * Keep their independent-sample nature, without exposing provider names in the
 * CBD client surface. The editor continues to receive the unmodified edition.
 */
export function customerResearchText(value: string, research: SubmarketIntelligence): string {
  let copy = value;
  const publishers = [...new Set(research.sources
    .filter(source => source.scopeType === 'external_market')
    .map(source => source.publisher.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  for (const publisher of publishers) {
    const replacements = [
      [publisher + '监测的', ''],
      [publisher + '监测', '公开市场监测显示，'],
      [publisher + '报告识别出', '公开市场资料显示，'],
      [publisher + '报告列举', '公开成交案例包括'],
      [publisher + '报告', '公开研究'],
      [publisher + '统计', '另一独立市场样本显示，'],
      [publisher + '独立样本', '另一独立公开样本'],
      [publisher, '公开市场研究'],
    ];
    for (const [from, to] of replacements) copy = copy.replaceAll(from, to);
  }
  return copy;
}

function observationTheme(item: Observation): ResearchTheme {
  if (item.kind === 'outlook') return 'outlook';
  if (/总部区位|区位溢价|长期价值|长期区位/.test(item.title)) return 'location';
  if (/需求|搬迁|扩张|产业/.test(item.title)) return 'demand';
  return 'competition';
}

function factTheme(item: Fact): ResearchTheme {
  if (item.kind === 'supply') return 'competition';
  if (item.kind === 'industry') return 'demand';
  return 'location';
}

function factVariant(item: Fact): ResearchFactVariant {
  if (item.lines?.length) return 'transit';
  if (item.measure) return /空置率|租金差|对比|比较/.test(item.title) ? 'comparison' : 'number';
  if (/案例|搬迁/.test(item.title)) return 'case';
  if (item.kind === 'supply') return 'supply';
  return 'text';
}

function dateLabel(value: string): string {
  if (/^\d{4}Q[1-4]$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return value.slice(0, 4) + '年' + Number(value.slice(5)) + '月';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}年(?:\d{1,2}月)?$/.test(value)) return value;
  return '';
}

function evidenceContext(research: SubmarketIntelligence, sourceIds: readonly string[], title: string, asOf?: string): string {
  const sources = research.sources.filter(source => sourceIds.includes(source.id));
  const periods = [...new Set((asOf ? [asOf] : sources.map(source => source.observedAt)).map(dateLabel).filter(Boolean))];
  // Scope labels describe the evidence, not an attribution or a new data source.
  const scope = sources.some(source => source.scopeType === 'external_market')
    ? (/甲级.*空置率/.test(title) || (research.market === 'CBD' && /空置率/.test(title)) ? '公开甲级办公样本（独立监测）' : '公开市场研究')
    : sources.some(source => source.scopeType === 'functional') ? research.market + '功能区' : '';
  return [...periods, scope].filter(Boolean).join(' · ');
}

function related(a: readonly string[], b: readonly string[]) {
  return a.some(id => b.includes(id));
}

/** Select the CBD lead by a supply-backed competition thesis, not array position. */
function selectLead(research: SubmarketIntelligence, marketType: ResearchMarketType): Observation | null {
  const candidates = research.observations.filter(item => item.kind === 'inference');
  const measuredSupply = research.facts.filter(item => item.kind === 'supply' && item.status === 'observed' && item.measure);
  const score = (item: Observation) =>
    (marketType === 'office' && observationTheme(item) === 'competition' ? 4 : 0)
    + (marketType === 'office' && /新供应|新供给|供应驱动|竞争阶段/.test(item.title) ? 5 : 0)
    + (measuredSupply.some(fact => related(fact.sourceIds, item.sourceIds)) ? 2 : 0)
    + (marketType === 'park' && /研发办公|研发载体|产业链|科技需求|专业空间|特色项目/.test(item.title) ? 6 : 0)
    + (marketType === 'park' && observationTheme(item) === 'demand' ? 4 : 0)
    + (marketType === 'mixed' && /不是同质|差异|使用适配|品质升级/.test(item.title) ? 6 : 0);
  return [...candidates].sort((a, b) => score(b) - score(a) || b.asOf.localeCompare(a.asOf) || a.title.localeCompare(b.title, 'zh-CN'))[0] ?? null;
}

export function buildResearchPresentation(research: SubmarketIntelligence, marketType: ResearchMarketType): SubmarketResearchPresentation {
  const facts = research.facts.map((item): ResearchFactPresentation => ({
    key: item.title,
    title: customerResearchText(item.title, research),
    body: customerResearchText(item.body, research),
    context: evidenceContext(research, item.sourceIds, item.title),
    theme: factTheme(item),
    variant: factVariant(item),
    status: item.status,
    measure: item.measure,
    lines: item.lines,
  }));
  const observations = research.observations.map((item): ResearchObservationPresentation => ({
    key: item.title,
    title: customerResearchText(item.title, research),
    body: customerResearchText(item.body, research),
    context: evidenceContext(research, item.sourceIds, item.title, item.asOf),
    theme: observationTheme(item),
  }));
  const rawLead = selectLead(research, marketType);
  const lead = observations.find(item => item.key === rawLead?.title) ?? null;
  // Prefer a number that supports the lead; complement it with an independent
  // structural fact. A different external vacancy sample is retained in its
  // research chapter, not placed beside the platform vacancy KPI.
  const previewCandidates = facts.filter(item => item.measure && item.status === 'observed' && item.variant !== 'comparison');
  const leadFact = rawLead && previewCandidates.find(item => {
    const original = research.facts.find(fact => fact.title === item.key);
    return original && item.theme === lead?.theme && related(original.sourceIds, rawLead.sourceIds);
  });
  const structuralFact = previewCandidates.find(item => item.theme === 'demand' && item.key !== leadFact?.key);
  const previewFacts = [leadFact, structuralFact].filter((item): item is ResearchFactPresentation => Boolean(item));
  if (!previewFacts.length && previewCandidates.length) previewFacts.push(previewCandidates[0]);
  const themeOrder: ResearchTheme[] = marketType === 'park'
    ? ['demand', 'location', 'competition', 'outlook']
    : ['competition', 'demand', 'location', 'outlook'];
  const chapters = themeOrder.map(theme => ({
    theme, title: marketType === 'park' ? ({ demand: '产业集聚与研发需求', location: '园区功能与通勤', competition: '载体供给与竞争', outlook: '市场展望' } as const)[theme]
      : marketType === 'mixed' ? ({ competition: '商务办公与研发载体', demand: '企业需求与选址', location: '区域功能与通勤', outlook: '市场展望' } as const)[theme]
        : chapterTitles[theme],
    observations: observations.filter(item => item.theme === theme).sort((a, b) => Number(b.key === lead?.key) - Number(a.key === lead?.key)),
    facts: facts.filter(item => item.theme === theme),
  })).filter(chapter => chapter.observations.length || chapter.facts.length);
  const positioning = customerResearchText(research.positioning, research);
  // Current CBD editions separate the durable positioning and dated thesis with
  // a semicolon; only separate a dated clause when a research lead is present.
  const durable = lead ? positioning.replace(/[；;]\s*(?:\d{4}Q[1-4]|\d{4}年).*$/, '') : positioning;
  return {
    marketType,
    positioning: durable,
    lead,
    previewFacts,
    chapters,
    projects: research.projects.map(project => ({
      ...project,
      role: customerResearchText(project.role, research),
      reason: customerResearchText(project.reason, research),
    })),
  };
}
