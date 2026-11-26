import type { LayoutId } from '../contracts/scene';
import type { BoundBlock } from './page-content';
import { bind, chart, prose, table } from './page-content';
import { displayMetric, displayMetricNumber, metricInfo, metricValue, type Metric } from './observations';
import type { Distribution, Evidence, Field, Metrics, Photo } from './projection';

export interface PageDraft {
  title: string;
  subtitle?: string;
  dataAsOf?: string;
  composition: LayoutId;
  blocks: BoundBlock[];
}

export function textPage(title: string, entries: readonly string[], evidence: readonly Evidence<unknown>[], composition: LayoutId = 'two-columns'): PageDraft {
  return { title, composition, blocks: entries.map(entry => prose(entry, evidence)) };
}

export function tablePage(title: string, columns: Parameters<typeof table>[0], rows: Parameters<typeof table>[1], evidence: Parameters<typeof table>[2], subtitle?: string): PageDraft {
  return { title, subtitle, composition: 'data-table', blocks: [table(columns, rows, evidence)] };
}

export function metricPage(title: string, report: Evidence<Metrics>, keys: readonly Metric[], subtitle?: string): PageDraft | null {
  const blocks = keys.flatMap(key => {
    const value = metricValue(report.value, key);
    if (value === null) return [];
    const metric = metricInfo[key];
    const displayValue = displayMetricNumber(value, key);
    return [bind({ kind: 'metric', label: metric.label, value: displayValue, unit: metric.unit }, [report])];
  });
  return blocks.length ? { title, subtitle, composition: 'kpi', blocks } : null;
}

export function fieldPage(title: string, fields: Evidence<readonly Field[]> | undefined): PageDraft | null {
  if (!fields?.value.length) return null;
  return tablePage(title, ['参数', '已披露数据'], fields.value.map(({ label, value, unit }) => [label, unit ? `${value} ${unit}` : value]), [fields]);
}

export function photoPage(title: string, photos: readonly Evidence<Photo>[], subtitle?: string): PageDraft | null {
  if (!photos.length) return null;
  const images = photos.slice(0, 4);
  const labels = images.map(image => prose(image.value.block.alt, [image]));
  const blocks = images.map(image => bind(image.value.block, [image]));
  const composition = images.length === 4 ? 'photo-gallery' : images.length === 3 ? 'photo-triptych' : images.length === 2 ? 'photo-pair' : 'hero-caption';
  const captions = images.length === 2 ? [prose(images.map(photo => photo.value.block.alt).join(' · '), images)] : labels;
  return { title, subtitle, composition, blocks: [...blocks, ...captions] };
}

export function distributionPage(title: string, series: Evidence<Distribution>, chartType: 'bar' | 'line'): PageDraft | null {
  const rows = series.value.rows;
  const known = rows.filter(row => row.value !== null && Number.isFinite(row.value) && row.value >= 0);
  if (!known.length) return null;
  const subtitle = `${series.value.methodology} · 有效分组 ${known.length}/${rows.length}`;
  if (rows.length > (chartType === 'line' ? 12 : 8) || rows.some(row => row.label.length > 8)) {
    return tablePage(title, ['分组', `成交（${series.value.unit}）`], rows.map(({ label, value }) => [label, value]), [series], subtitle);
  }
  return { title, subtitle, composition: 'chart-insight', blocks: [chart(chartType === 'bar' ? 'column' : chartType, rows.map(row => row.label), [{ name: '成交', unit: series.value.unit, values: rows.map(row => row.value) }], [series])] };
}

export function levelsSummary(now: Evidence<Metrics>, compared: Evidence<Metrics> | undefined, previousLabel: string) {
  const results = (['netEffectiveRent', 'vacancyRate'] as const).flatMap(key => {
    const metric = metricInfo[key];
    const value = metricValue(now.value, key);
    if (value === null) return [];
    const previous = compared ? metricValue(compared.value, key) : null;
    if (previous === null) return [`${metric.label}为 ${displayMetric(value, key)}`];
    const delta = (value - previous) * metric.scale;
    const amount = Number(Math.abs(delta).toFixed(metric.digits));
    const change = amount ? `较${previousLabel}${delta < 0 ? '下降' : '上升'} ${amount.toFixed(metric.digits)} ${key === 'vacancyRate' ? '个百分点' : metric.unit}` : `与${previousLabel}持平`;
    return [`${metric.label}为 ${displayMetric(value, key)}，${change}`];
  });
  return results;
}
