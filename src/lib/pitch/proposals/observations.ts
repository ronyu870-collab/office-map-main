import { marketQuadrants, median, visiblePosition } from './comparison';
import { chart, periodLabel, periodOrder, table, type BoundBlock } from './page-content';
import type { Evidence, Metrics, Period } from './projection';

export const metricInfo = {
  netEffectiveRent: { label: '净有效租金', unit: '元/㎡/月', scale: 1, digits: 1 },
  vacancyRate: { label: '空置率', unit: '%', scale: 100, digits: 1 },
  trackedArea: { label: '样本办公面积', unit: '㎡', scale: 1, digits: 0 },
  sampleCount: { label: '样本楼宇', unit: '栋', scale: 1, digits: 0 },
} as const;
export type Metric = keyof typeof metricInfo;
export type KeyMetric = 'netEffectiveRent' | 'vacancyRate';
export type Observation = Evidence<Metrics> & { label: string; id: string };

export function metricValue(metrics: Metrics, key: Metric): number | null {
  const value = metrics[key];
  if (value == null || !Number.isFinite(value) || value < 0 || (key === 'vacancyRate' && value > 1)) return null;
  return value;
}

export function displayMetric(value: number, key: Metric) {
  const { scale, digits, unit } = metricInfo[key];
  return `${(value * scale).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit === '%' ? '' : ' '}${unit}`;
}

export function metricComparison(rows: readonly Observation[], key: KeyMetric, targetId?: string, chartStyle: 'column' | 'table' = 'column') {
  const metric = metricInfo[key];
  const values = rows.map(item => metricValue(item.value, key));
  const observed = values.filter((value): value is number => value !== null);
  const observedPeers = values.filter((value, i): value is number => value !== null && rows[i].id !== targetId);
  if (observed.length < 2) return null;
  const target = rows.findIndex(row => row.id === targetId);
  const targetValue = values[target];
  const peerMedian = median(observedPeers);
  let title = `${rows[0].label}等 ${rows.length} 个项目的${metric.label}`;
  if (targetValue != null && peerMedian !== null) {
    const position = visiblePosition(targetValue * metric.scale, peerMedian * metric.scale, metric.digits);
    const phrase = { below: '低于', equal: '与竞品中位数持平', above: '高于' }[position];
    title = position === 'equal' ? `${rows[target].label}的${metric.label}${phrase}` : `${rows[target].label}的${metric.label}${phrase}竞品中位数`;
  } else if (!targetId) {
    const min = Math.min(...observed), max = Math.max(...observed);
    const span = visiblePosition(max * metric.scale, min * metric.scale, metric.digits);
    title = span === 'equal' ? `已披露样本的${metric.label}持平` : `候选项目${metric.label}为 ${displayMetric(min, key)}至 ${displayMetric(max, key)}`;
  }
  const labels = rows.map(row => row.id === targetId ? `${row.label}（目标）` : row.label);
  const data = values.map(value => value === null ? null : value * metric.scale);
  const block = chartStyle === 'column' && rows.length <= 8 && labels.every(label => label.length <= 12)
    ? chart('column', labels, [{ name: metric.label, unit: metric.unit, values: data }], rows)
    : table(['项目', `${metric.label}（${metric.unit}）`], labels.map((label, i) => [label, data[i]]), rows);
  return { title, block, coverage: `已披露 ${observed.length}/${rows.length}` };
}

export function positioningMatrix(rows: readonly Observation[], entityLabel: string) {
  const points = rows.flatMap(row => {
    const rent = metricValue(row.value, 'netEffectiveRent');
    const vacancyRate = metricValue(row.value, 'vacancyRate');
    return rent === null || vacancyRate === null ? [] : [{ item: row, rent, vacancyRate }];
  });
  const matrix = marketQuadrants(points);
  if (!matrix) return null;
  const labels = matrix.cells.map(cell => cell.map(item => item.label).join('、') || '—');
  return {
    title: `${entityLabel}的租金与空置率定位`,
    subtitle: `共同样本 ${points.length}/${rows.length} · 中位数 ${displayMetric(matrix.rent, 'netEffectiveRent')}、${displayMetric(matrix.vacancyRate, 'vacancyRate')} · 等值归入较高组`,
    block: table(['空置率／净有效租金', '低于中位数', '达到或高于中位数'], [
      ['达到或高于中位数', labels[0], labels[1]],
      ['低于中位数', labels[2], labels[3]],
    ], points.map(point => point.item)),
  };
}

export function historicalMetric(history: readonly Evidence<Metrics & { period: Period }>[], key: KeyMetric, end: Period) {
  const metric = metricInfo[key];
  const byPeriod = new Map(history.filter(record => periodOrder(record.value.period) <= periodOrder(end))
    .map(record => [periodOrder(record.value.period), record]));
  const dates = [...byPeriod.keys()].sort((a, b) => a - b);
  const valid = dates.flatMap(date => {
    const entry = byPeriod.get(date)!;
    const value = metricValue(entry.value, key);
    return value === null ? [] : [{ value: value * metric.scale, period: entry.value.period }];
  });
  if (valid.length < 2) return null;
  const values: (number | null)[] = [], labels: string[] = [];
  for (let index = dates[0]; index <= periodOrder(end); index++) {
    const year = Math.floor((index - 1) / 4);
    labels.push(periodLabel({ year, quarter: (index - year * 4) as Period['quarter'] }));
    const observation = byPeriod.get(index);
    const value = observation ? metricValue(observation.value, key) : null;
    values.push(value === null ? null : value * metric.scale);
  }
  const first = valid[0], last = valid.at(-1)!;
  const direction = visiblePosition(last.value, first.value, metric.digits);
  const title = `${metric.label}${{ above: '高于', below: '低于', equal: '持平于' }[direction]}${periodLabel(first.period)}的样本水平`;
  const evidence = [...byPeriod.values()];
  const block: BoundBlock = labels.length <= 12
    ? chart('line', labels, [{ name: metric.label, values, unit: metric.unit }], evidence)
    : table(['季度', `${metric.label}（${metric.unit}）`], labels.map((label, i) => [label, values[i]]), evidence);
  return { title, block, coverage: `${periodLabel(first.period)}–${periodLabel(last.period)} · 有效季度 ${valid.length}/${labels.length}` };
}
