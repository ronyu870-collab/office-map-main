import { metricInfo, metricValue } from './observations';
import { prose, table } from './page-content';
import type { Evidence, Metrics } from './projection';
import { SCORE_CRITERIA, scoreShortlist, type ScoreCriterion, type ScoreWeights } from './scorecard';

const scoringLabels: Record<ScoreCriterion, string> = {
  netEffectiveRent: metricInfo.netEffectiveRent.label,
  vacancyRate: '季度空置率',
  transitWalkingMinutes: '已披露步行分钟数',
};

export type ShortlistRecord = {
  id: string;
  identity: Evidence<{ name: string }>;
  quarter?: Evidence<Metrics>;
  transport?: Evidence<{ description: string; walkingMinutes?: number | null }>;
};

export function scorecardPage(records: readonly ShortlistRecord[], weights: Evidence<ScoreWeights>) {
  const candidates = records.map(record => ({ buildingId: record.id, values: {
    netEffectiveRent: record.quarter ? metricValue(record.quarter.value, 'netEffectiveRent') : null,
    vacancyRate: record.quarter ? metricValue(record.quarter.value, 'vacancyRate') : null,
    transitWalkingMinutes: record.transport?.value.walkingMinutes,
  } }));
  const scores = scoreShortlist(candidates, weights.value);
  const byId = new Map(records.map(record => [record.id, record]));
  const eligible = scores.filter(row => row.score !== null);
  const missing = scores.length - eligible.length;
  const criteria = (Object.keys(SCORE_CRITERIA) as ScoreCriterion[]).filter(key => (weights.value[key] ?? 0) > 0);
  const total = criteria.reduce((sum, key) => sum + weights.value[key]!, 0);
  const preferences = criteria.map(key => `${scoringLabels[key]}${SCORE_CRITERIA[key] === 'lower' ? '越低分越高' : '越高分越高'}（${(100 * weights.value[key]! / total).toFixed(1)}%）`);
  const title = eligible.length < 2 ? '有效候选不足，暂不排序' : `${eligible.length} 个候选项目可按已确认权重比较`;
  return {
    title,
    subtitle: `相对评分 · ${missing} 个候选未评级`,
    blocks: [
      table(['项目', '相对分（0–100）', '缺失评分条件'], [...scores].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map(row => [
        byId.get(row.buildingId)!.identity.value.name,
        row.score === null ? '未评级' : Math.round(row.score * 10) / 10,
        row.missingCriteria.map(key => scoringLabels[key]).join('、') || '—',
      ]), [weights, ...records.flatMap(row => [row.identity, ...(row.quarter ? [row.quarter] : []), ...(row.transport ? [row.transport] : [])])]),
      prose(`${preferences.join('；')}。完整样本按各项最优与最劣线性换算为 100 和 0，同值记 50，最后按权重加总。空置率仅作为供应线索；实际房源待业主确认。候选变更后重算。`, [weights]),
    ],
  };
}
