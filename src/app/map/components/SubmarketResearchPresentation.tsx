import { useMemo } from 'react';
import type { MarketBuilding, SubmarketSummary } from '../model/submarketOverview';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';
import { describeCurrentResearchMarket, describeQuarterlyResearchMarket, researchNumber, signedResearchNumber } from '../model/submarketResearch';
import type { ResearchChapter, ResearchFactPresentation, ResearchObservationPresentation, ResearchReadingMode, SubmarketResearchPresentation } from '../model/submarketResearchPresentation';
import type { SubmarketResearchTrendState } from './SubmarketResearchData';

const available = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
export type ResearchCoreMetric = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  precision?: number;
  context?: string;
};

/** Shared KPI surface: supply the authorized values and their context; it never calculates market statistics. */
export function ResearchCoreMetrics({ items, scope, measured = true, label = '市场核心指标' }: {
  items: readonly ResearchCoreMetric[];
  scope: string;
  measured?: boolean;
  label?: string;
}) {
  return <section className="submarket-v3-core" aria-label={label} data-workspace-summary={measured || undefined}>
    <p className="submarket-v3-context">{scope}</p>
    <dl className="submarket-v3-kpis">
      {items.map(item => <div key={item.key}>
        <dt>{item.label}</dt>
        <dd>{available(item.value) ? <><strong>{researchNumber(item.value, item.precision ?? 1)}</strong><span>{item.unit}</span></> : <span>未收录</span>}</dd>
        {item.context ? <dd className="submarket-v3-context">{item.context}</dd> : null}
      </div>)}
    </dl>
  </section>;
}

export function OfficeResearchCoreMetrics({ name, summary, buildings, beijingBenchmarkBuildings, measured, projectFirst = false }: {
  name: string;
  summary: SubmarketSummary;
  buildings: readonly MarketBuilding[];
  beijingBenchmarkBuildings?: readonly MarketBuilding[];
  measured?: boolean;
  projectFirst?: boolean;
}) {
  const current = useMemo(() => describeCurrentResearchMarket(name, buildings, beijingBenchmarkBuildings), [name, buildings, beijingBenchmarkBuildings]);
  const rentPeriods = current.rent.periods;
  const vacancyPeriods = current.vacancyPct.periods;
  const sharedPeriod = available(summary.rent) && available(summary.vacancyPct) &&
    rentPeriods.length === 1 && vacancyPeriods.length === 1 && rentPeriods[0] === vacancyPeriods[0] ? rentPeriods[0] : '';
  const context = (value: number | null, periods: readonly string[], samples: number, benchmark: number | undefined, unit: string) =>
    [available(value) && !sharedPeriod && (periods.length > 1 ? `跨期 ${periods[0]}–${periods[periods.length - 1]}` : periods[0] || '期间未收录'),
      samples === 1 && '单项目样本', available(benchmark) && `较北京同口径 ${signedResearchNumber(benchmark)} ${unit}`].filter(Boolean).join(' · ');
  return <ResearchCoreMetrics measured={measured} scope={'当前筛选 · 甲乙级' + (sharedPeriod ? ' · 租金／空置率 ' + sharedPeriod : '')}
    items={([
      { key: 'rent', label: '平均净有效租金', value: summary.rent, unit: '元/㎡/月',
        context: context(summary.rent, rentPeriods, summary.rentSampleCount, measured === false ? undefined : current.rent.benchmark?.difference, '元/㎡/月') },
      { key: 'vacancy', label: '平均空置率', value: summary.vacancyPct, unit: '%',
        context: context(summary.vacancyPct, vacancyPeriods, summary.vacancySampleCount, measured === false ? undefined : current.vacancyPct.benchmark?.difference, '个百分点') },
      { key: 'projects', label: '甲乙级项目', value: summary.officeCount, unit: '个', precision: 0 },
    ] satisfies ResearchCoreMetric[]).filter(item => !projectFirst || item.key === 'projects' || (available(item.value) && (item.key === 'rent' ? summary.rentSampleCount : summary.vacancySampleCount) >= 2))} />;
}

type Pulse = { key: string; label: string; period: string; value: number; unit: string; change: string; matched: string };
export function ResearchQuarterPulse({ data, state, showValues = true }: {
  data: readonly SubmarketTrendPoint[];
  state: SubmarketResearchTrendState;
  showValues?: boolean;
}) {
  const quarterly = useMemo(() => describeQuarterlyResearchMarket(data), [data]);
  if (state !== 'ready') return null;
  const { rent, vacancy } = quarterly;
  const rows: Pulse[] = [];
  if (rent.latest && available(rent.latest.rent)) {
    const matched = rent.latest.sameSampleQoq?.rent;
    rows.push({
      key: 'rent', label: '净有效租金', period: rent.latest.period, value: rent.latest.rent, unit: ' 元/㎡/月',
      change: available(rent.qoqPct) ? (rent.scopeChanged ? '市场样本环比 ' : '环比 ') + signedResearchNumber(rent.qoqPct) + '%'
        : available(rent.qoqAbsolute) ? (rent.scopeChanged ? '市场样本环比 ' : '环比 ') + signedResearchNumber(rent.qoqAbsolute) + ' 元/㎡/月' : '',
      matched: matched && matched.samples >= 2 && available(matched.rentPct) ? '同样本环比 ' + signedResearchNumber(matched.rentPct) + '%' : '',
    });
  }
  if (vacancy.latest && available(vacancy.latest.vacancyPct)) {
    const matched = vacancy.latest.sameSampleQoq?.vacancy;
    rows.push({
      key: 'vacancy', label: '空置率', period: vacancy.latest.period, value: vacancy.latest.vacancyPct, unit: '%',
      change: available(vacancy.qoqPp) ? (vacancy.scopeChanged ? '市场样本环比 ' : '环比 ') + signedResearchNumber(vacancy.qoqPp) + ' 个百分点' : '',
      matched: matched && matched.samples >= 2 && available(matched.vacancyPp) ? '同样本环比 ' + signedResearchNumber(matched.vacancyPp) + ' 个百分点' : '',
    });
  }
  const visible = showValues ? rows : rows.filter(row => row.change || row.matched);
  if (!visible.length) return null;
  const commonPeriod = visible.every(row => row.period === visible[0].period) ? visible[0].period : '';
  return <section className="submarket-v3-pulse" aria-label="季度变化">
    <p className="submarket-v3-context">完整子市场 · 甲乙级{commonPeriod ? ' · ' + commonPeriod : ''}</p>
    <dl className="submarket-v3-pulse-grid">
      {visible.map(row => <div key={row.key}>
        <dt>{row.label}{!commonPeriod && <span className="submarket-v3-context"> {row.period}</span>}</dt>
        {showValues && <dd><strong>{researchNumber(row.value) + row.unit}</strong></dd>}
        {row.change && <dd>{row.change}</dd>}
        {row.matched && <dd className="submarket-v3-context">{row.matched}</dd>}
      </div>)}
    </dl>
  </section>;
}

function EvidenceNumber({ fact }: { fact: ResearchFactPresentation }) {
  if (!fact.measure) return null;
  return <div className="submarket-v3-evidence-number"><strong>{fact.measure.value}</strong><span>{fact.measure.unit}</span></div>;
}

export function ResearchLead({ presentation, mode }: { presentation: SubmarketResearchPresentation; mode: ResearchReadingMode }) {
  const { lead, previewFacts } = presentation;
  if (!lead) return null;
  return <section className="submarket-v3-lead" aria-label="市场观察">
    <p className="submarket-v3-context">{lead.context || '市场判断'}</p>
    <h3>{lead.title}</h3>
    {mode === 'quick' ? previewFacts[0]?.measure && <p className="submarket-v3-quick-evidence">
      {previewFacts[0].title} · {previewFacts[0].measure.value} {previewFacts[0].measure.unit}
    </p> : previewFacts.length > 0 && <div className="submarket-v3-preview-facts">
      {previewFacts.map(fact => <article key={fact.key}>
        <h4>{fact.title}</h4><EvidenceNumber fact={fact} />
        {fact.context && <p className="submarket-v3-context">{fact.context}</p>}
      </article>)}
    </div>}
  </section>;
}

function ResearchFact({ fact }: { fact: ResearchFactPresentation }) {
  const title = <h4>{fact.title}{fact.status === 'planned' ? '（规划）' : ''}</h4>;
  const context = fact.context && <p className="submarket-v3-context">{fact.context}</p>;
  if (fact.variant === 'number' || fact.variant === 'comparison') {
    return <article className="submarket-v3-fact submarket-v3-number-fact" data-research-fact={fact.variant}>
      {title}<EvidenceNumber fact={fact} />{context}<p>{fact.body}</p>
    </article>;
  }
  if (fact.variant === 'transit') {
    return <article className="submarket-v3-fact" data-research-fact="transit">
      {title}{context}<ul className="submarket-v3-transit" aria-label="轨道线路">{fact.lines?.map(line => <li key={line}>{line}</li>)}</ul><p>{fact.body}</p>
    </article>;
  }
  return <article className="submarket-v3-fact" data-research-fact={fact.variant}>
    {title}{context}<p>{fact.body}</p>
  </article>;
}

function Observation({ item }: { item: ResearchObservationPresentation }) {
  return <article className="submarket-v3-observation">
    <h4>{item.title}</h4>{item.context && <p className="submarket-v3-context">{item.context}</p>}<p>{item.body}</p>
  </article>;
}

function ResearchChapterSection({ chapter }: { chapter: ResearchChapter }) {
  return <section className="submarket-v3-chapter" data-research-theme={chapter.theme} aria-label={chapter.title}>
    <h3>{chapter.title}</h3>
    <div className="submarket-v3-chapter-grid" data-has-evidence={Boolean(chapter.facts.length && chapter.observations.length) || undefined}>
      {chapter.observations.length > 0 && <div className="submarket-v3-observations">
        {chapter.observations.map(item => <Observation key={item.key} item={item} />)}
      </div>}
      {chapter.facts.length > 0 && <div className="submarket-v3-facts">
        {chapter.facts.map(fact => <ResearchFact key={fact.key} fact={fact} />)}
      </div>}
    </div>
  </section>;
}

/** Slot shared by the region tab and full reading. The caller owns trend, projects and navigation. */
export function ResearchChapters({ presentation, section = 'all' }: {
  presentation: SubmarketResearchPresentation;
  section?: 'all' | 'main' | 'outlook';
}) {
  const chapters = presentation.chapters.filter(chapter => section === 'all' || (section === 'outlook' ? chapter.theme === 'outlook' : chapter.theme !== 'outlook'));
  if (!chapters.length) return null;
  return <div className="submarket-v3-chapters">
    {chapters.map(chapter => <ResearchChapterSection key={chapter.theme} chapter={chapter} />)}
  </div>;
}
