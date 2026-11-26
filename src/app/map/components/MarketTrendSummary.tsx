import { useMemo } from 'react';
import type { SubmarketTrendPoint } from '../model/submarketMarketTrend';
import { buildTrendTimeline, designMarketTrends, marketTrendLabels } from '../model/marketTrendPresentation';
import { marketTrendChangeText, marketTrendValueText } from '../model/marketTrendText';
import { trendValue } from '../model/submarketTrendDigest';
import styles from './SubmarketResearchData.module.css';

/** A small zero-based quarter strip keeps the overview independent of the chart runtime. */
export function MarketTrendSummary({ data, compact = false }: {
  data: readonly SubmarketTrendPoint[]; compact?: boolean;
}) {
  const plots = useMemo(() => designMarketTrends(buildTrendTimeline(data), 'overview'), [data]);
  if (compact && plots.every(plot => !plot.latest)) return null;
  return <section className={styles.block} aria-label="季度变化">
    <h3>季度变化</h3>
    {!compact && <p className={styles.secondary}>完整授权甲乙级子市场 · 正式季度行情</p>}
    {plots.some(plot => plot.latest) ? <dl className={styles.summaryTrends}>
      {plots.map(({ metric, latest, latestChange, kind, axis }) => {
        if (!latest) return null;
        const values = axis.map(quarter => trendValue(quarter.point, metric));
        const max = Math.max(1, ...values.map(value => value ?? 0));
        const showStrip = !compact && (kind === 'line' || kind === 'scatter') && axis.length <= 5;
        return <div key={metric} className={styles.summaryTrend}>
          <dt>{marketTrendLabels[metric].name} <span className={styles.secondary}>{latest.period}</span></dt>
          <dd><strong>{marketTrendValueText(trendValue(latest.point, metric)!, metric)}</strong></dd>
          {latestChange && <dd className={styles.secondary}>{marketTrendChangeText(latestChange, metric)}</dd>}
          {showStrip && <dd className={styles.stripReading}>
            <span aria-hidden="true" className={styles.trendStrip} data-metric={metric}
              style={{ gridTemplateColumns: `repeat(${axis.length}, minmax(0, 1fr))` }}>
              {values.map((value, index) => <i key={axis[index].key} style={value == null ? undefined
                : { height: `max(1px, ${value / max * 100}%)`, backgroundColor: 'currentColor' }} />)}
            </span>
            <span className={styles.secondary}>{axis[0].period} 至 {axis.at(-1)!.period}</span>
          </dd>}
        </div>;
      })}
    </dl> : <p className={styles.secondary}>暂无已发布的有效季度观测。</p>}
  </section>;
}
