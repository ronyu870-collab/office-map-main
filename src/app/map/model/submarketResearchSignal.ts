import type { SubmarketIntelligence } from './submarketIntelligence';
import type { SubmarketTrendSeries } from './submarketMarketTrend';

type ResearchSignal = { title: string; text: string; scope: string };
const value = (number: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(number);
const signed = (number: number) => (number > 0 ? '+' : '') + value(number);

export function submarketResearchSignal(
  focus: SubmarketIntelligence['focus'],
  trends: SubmarketTrendSeries | undefined,
  state: 'loading' | 'ready' | 'error',
): ResearchSignal | null {
  if (!trends || state !== 'ready' || focus === 'stock') return null;
  const scope = '已发布季度记录 · 授权子市场 · 按面积加权';
  if (focus === 'grade-rent') {
    const title = '同季度甲乙级租金差';
    const latest = trends.all.findLast(point => point.rent != null);
    const a = trends.a.find(point => point.period === latest?.period);
    const b = trends.b.find(point => point.period === latest?.period);
    if (!a || !b || a.rent == null || b.rent == null || a.rentSamples < 2 || b.rentSamples < 2) {
      return { title, text: '最近有租金记录的季度缺少足够的同季甲乙级样本。', scope };
    }
    const rentText = `${a.period} 甲级减乙级 ${signed(a.rent - b.rent)} 元/㎡/月（甲级 ${value(a.rent)}、乙级 ${value(b.rent)}；有效租金样本 ${a.rentSamples} / ${b.rentSamples} 个）。`;
    const vacancyText = a.vacancyPct != null && b.vacancyPct != null && a.vacancySamples >= 2 && b.vacancySamples >= 2
      ? `同季甲级空置率 ${value(a.vacancyPct)}%，乙级 ${value(b.vacancyPct)}%（有效空置样本 ${a.vacancySamples} / ${b.vacancySamples} 个）。` : '';
    return { title, text: rentText + vacancyText, scope };
  }
  const rent = focus === 'matched-rent';
  const title = rent ? '净有效租金同样本环比' : '空置率同样本环比';
  const latest = trends.all.findLast(point => (rent ? point.rent : point.vacancyPct) != null);
  const sample = rent ? latest?.sameSampleQoq?.rent : latest?.sameSampleQoq?.vacancy;
  const change = rent ? sample?.rentPct : sample?.vacancyPp;
  if (!latest || !sample || change == null || sample.samples < 2) {
    return { title, text: '最近有记录的季度缺少连续两季的可比项目。', scope };
  }
  return { title, text: `${latest.period} ${signed(change)}${rent ? '%' : ' 个百分点'}，两季共有 ${sample.samples} 个有效项目。`, scope };
}
