'use client';

import { formatExact, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { resolveResearchSources, type ResearchAnalysis } from '@/src/lib/intelligence/query/researchAnalysisView';
import styles from './HomeQueryResultExperience.module.css';
import tableStyles from './HomeQueryDataTable.module.css';

/** A concise, source-bound sample explanation for two-period comparisons.
 * Never derives or substitutes new values in the authorized result. */
export function HomeQuerySampleSummary({ research, result, onSource }: {
  research: ResearchAnalysis; result: QueryResultView;
  onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void;
}) {
  if (!['trend', 'compare'].includes(result.operation) || research.series.length !== 1) return null;
  const series = research.series[0], comparison = series.comparability[0];
  if (series.periods.length !== 2 || !comparison) return null;
  const changed = comparison.enteredEntityIds.length > 0 || comparison.exitedEntityIds.length > 0;
  const knownSources = new Set(result.sources.map(source => source.id));
  const ids = resolveResearchSources(series, comparison).filter(id => knownSources.has(id));
  const period = (p: { year: number; quarter: number }) => p.year + ' Q' + p.quarter;
  const change = comparison.commonSample.change;
  return <section className={styles.sampleSummary} aria-label="样本可比性">
    {result.operation === 'compare' && <div className={tableStyles.root} data-reading="true"><div className={tableStyles.scroll}>
      <table><thead><tr><th>季度</th><th className={tableStyles.number}>参与计算（栋）</th><th className={tableStyles.number}>分母（{units[series.periods[0].denominatorUnit]}）</th></tr></thead>
      <tbody>{series.periods.map(item => <tr key={period(item.period)}><th scope="row">{period(item.period)}</th><td className={tableStyles.number}>{item.usedCount}</td><td className={tableStyles.number}>{formatExact(item.denominator, item.denominatorUnit)}</td></tr>)}</tbody></table>
    </div></div>}
    <p><strong>样本可比性：</strong>两期共同有效 {comparison.commonCount} 栋
      {changed && <>，进入 {comparison.enteredEntityIds.length} 栋、退出 {comparison.exitedEntityIds.length} 栋</>}。
      {changed && change && <>共同样本变化 {formatExact(change, comparison.commonSample.changeUnit)}{comparison.commonSample.changeUnit === 'percent' ? '%' : ' 个百分点'}。各期样本的均值变化可能受到样本及面积权重影响。</>}
      {changed && !change && <>共同样本变化不可计算；不能据此推断市场原因。</>}
      {ids.length > 0 && <button type="button" className={styles.citation} onClick={event => onSource(ids, '样本可比性', event.currentTarget)}>依据</button>}
    </p>
  </section>;
}
