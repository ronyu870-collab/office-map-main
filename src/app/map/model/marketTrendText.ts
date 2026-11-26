import { compareTrendQuarters, marketTrendLabels } from './marketTrendPresentation';
import { researchNumber, signedResearchNumber } from './submarketResearch';
import type { MarketTrendMetric } from './submarketTrendDigest';

export function marketTrendValueText(value: number, metric: MarketTrendMetric) {
  const { unit } = marketTrendLabels[metric];
  return `${researchNumber(value)}${unit === '%' ? unit : ` ${unit}`}`;
}

export type MarketTrendChange = NonNullable<ReturnType<typeof compareTrendQuarters>>;

export function marketTrendChangeText(change: MarketTrendChange, metric: MarketTrendMetric, includeRelative = false) {
  const qualifier = change.sampleChanged ? '市场样本' : '';
  const main = `${qualifier}${change.label} ${signedResearchNumber(change.difference)} ${marketTrendLabels[metric].changeUnit}`;
  return includeRelative && change.relative != null ? `${main}（${signedResearchNumber(change.relative)}%）` : main;
}

export function sameSampleChangeText(change: MarketTrendChange, metric: MarketTrendMetric) {
  const value = metric === 'rent' ? change.sameSample?.rentPct : change.sameSample?.vacancyPp;
  if (value == null) return null;
  const unit = metric === 'rent' ? '%' : ' 个百分点';
  return `同样本${change.label} ${signedResearchNumber(value)}${unit}（${change.sameSample!.samples} 个共同样本）`;
}
