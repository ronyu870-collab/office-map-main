import type { QueryResultView } from './presentation';
import { metricLabels } from './multiMetricView';
import { researchAnalysisSchema } from './researchAnalysisView';

export type SampleMembershipMode = 'common' | 'period';
export function sampleMembershipRequest(question?: string): SampleMembershipMode | null {
  const text = question ?? '';
  if (!/样本/.test(text) || !/(?:名单|清单|楼宇|楼栋|哪些楼|哪些项目|分别是哪些|具体是哪些|样本明细)/.test(text)) return null;
  if (!/(?:列出|展示|提供|给出|查询|查看|有哪些|哪些楼|分别是哪些|具体是哪些|名单|清单|样本明细)/.test(text)) return null;
  return /共同(?:有效)?样本|共同楼宇|共同楼栋|交集|固定样本|同样本/.test(text) ? 'common' : 'period';
}

type Member = { entityId: string; name: string; sourceIds: string[] };
type MembershipGroup = { key: string; title: string; count: number; members: Member[]; missing: number };
type Membership = { groups: MembershipGroup[]; complete: boolean };

/** Only resolve saved sample membership against the same authorized source registry.
 * Never look up a missing name, infer a member from a candidate, or show opaque IDs. */
export function sampleMembership(result: QueryResultView, mode: SampleMembershipMode): Membership {
  const unavailable = { groups: [], complete: false };
  if (!['aggregate', 'group_aggregate', 'cross_aggregate', 'trend', 'group_trend', 'cross_trend', 'compare'].includes(result.operation)
      || result.parameters.dataDomain === 'lease-research/1') return unavailable;
  const parsed = researchAnalysisSchema.safeParse(result.parameters.researchAnalysis);
  if (!parsed.success || !parsed.data.series.length) return unavailable;
  const names = new Map<string, Member>();
  const ambiguous = new Set<string>();
  const known = new Set(result.sources.map(source => source.id));
  for (const source of result.sources) {
    if (source.table !== 'buildings' || source.field !== 'name' || typeof source.rawValue !== 'string' || !source.rawValue.trim()) continue;
    const name = source.rawValue.trim();
    const previous = names.get(source.entityId);
    if (previous && previous.name !== name) ambiguous.add(source.entityId);
    else if (previous) previous.sourceIds.push(source.id);
    else names.set(source.entityId, { entityId: source.entityId, name, sourceIds: [source.id] });
  }
  const groups: MembershipGroup[] = [];
  let complete = parsed.data.findings.every(finding => finding.sourceIds.every(id => known.has(id)));
  const groupLimit = 400;
  const append = (key: string, title: string, ids: readonly string[], expected: number) => {
    if (groups.length >= groupLimit) { complete = false; return; }
    const unique = [...new Set(ids)];
    const members = unique.flatMap(id => {
      const member = names.get(id);
      return member && !ambiguous.has(id) ? [member] : [];
    }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.entityId.localeCompare(b.entityId));
    const missing = Math.max(expected, unique.length) - members.length;
    if (unique.length !== expected || ids.length !== unique.length || missing !== 0) complete = false;
    groups.push({ key, title, count: expected, members, missing });
  };
  if (!complete) return unavailable;
  for (const series of parsed.data.series) {
    const title = [metricLabels[series.metric], series.label].filter(Boolean).join(' · ');
    if (mode === 'common') {
      if (series.commonSample.length < 2) { complete = false; continue; }
      const ids = series.commonEntityIds;
      const consistent = series.commonSample.every(period => period.usedCount === ids.length &&
        period.usedEntityIds.length === ids.length && new Set(period.usedEntityIds).size === ids.length &&
        period.usedEntityIds.every(id => ids.includes(id)));
      if (!consistent) { complete = false; continue; }
      const quarters = series.commonSample.map(({ period }) => period.year + ' Q' + period.quarter);
      append(series.key + ':common', title + ' · ' + quarters[0] + '—' + quarters.at(-1), ids, ids.length);
    } else {
      for (const period of series.perPeriod) append(series.key + ':' + period.period.year + 'Q' + period.period.quarter,
        title + ' · ' + period.period.year + ' Q' + period.period.quarter, period.usedEntityIds, period.usedCount);
    }
  }
  return { groups, complete: complete && groups.length > 0 };
}
