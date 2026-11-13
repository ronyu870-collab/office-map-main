import { z } from 'zod';
import { quarterSchema, type Quarter } from './contracts';

export const relativeQuarterContextSchema = z.strictObject({
  version: z.literal('shanghai-calendar-quarter/1'), timezone: z.literal('Asia/Shanghai'),
  receivedAt: z.iso.datetime(), anchorQuarter: quarterSchema, resolvedQuestion: z.string().min(1).max(6000),
});
export type RelativeQuarterContext = z.infer<typeof relativeQuarterContextSchema>;
export function shiftQuarter(period: Quarter, offset: number): Quarter {
  quarterSchema.parse(period);
  if (!Number.isSafeInteger(offset)) throw new Error('INVALID_QUARTER_OFFSET');
  const index = period.year * 4 + period.quarter - 1 + offset;
  return quarterSchema.parse({ year: Math.floor(index / 4), quarter: ((index % 4) + 4) % 4 + 1 });
}
export function shanghaiQuarter(now: Date): Quarter {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_SERVER_CLOCK');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return quarterSchema.parse({ year: get('year'), quarter: Math.floor((get('month') - 1) / 3) + 1 });
}
const key = (q: Quarter) => `${q.year}Q${q.quarter}`;
const token = /本季度|这季度|当前季度|上一季度|上个季度|上季度|去年同期|(?:今年|去年)(?:Q[1-4]|第?[一二三四1-4]季度)/g;

/** Normalization only: the caller still validates the ENTIRE expanded question.
 * No database/latest-period inference; the server supplies the clock once per request. */
export function expandRelativeQuarters(text: string, now: Date): { text: string; context?: RelativeQuarterContext } {
  const anchor = shanghaiQuarter(now);
  let changed = false;
  let expanded = text.replace(/最近([2-9]|[12][0-9]|3[0-9]|40)个(已结束季度|季度(?:（含本季度）|\(含本季度\)))/g, (_, count, ending) => {
    changed = true;
    const end = shiftQuarter(anchor, ending === '已结束季度' ? -1 : 0);
    return `${key(shiftQuarter(end, 1 - Number(count)))}至${key(end)}`;
  });
  expanded = expanded.replace(token, word => {
    changed = true;
    if (['本季度', '这季度', '当前季度'].includes(word)) return key(anchor);
    if (['上季度', '上一季度', '上个季度'].includes(word)) return key(shiftQuarter(anchor, -1));
    if (word === '去年同期') return key(shiftQuarter(anchor, -4));
    const q = word.match(/Q([1-4])|第?([一二三四1-4])季度/)!;
    const n = q[1] ? Number(q[1]) : '一二三四'.includes(q[2]) ? '一二三四'.indexOf(q[2]) + 1 : Number(q[2]);
    return key(quarterSchema.parse({ year: anchor.year - (word.startsWith('去年') ? 1 : 0), quarter: n }));
  });
  return { text: expanded, ...(changed ? { context: { version: 'shanghai-calendar-quarter/1' as const, timezone: 'Asia/Shanghai' as const, receivedAt: now.toISOString(), anchorQuarter: anchor, resolvedQuestion: expanded } } : {}) };
}
export function relativeQuarterNotice(context: RelativeQuarterContext): string {
  const c = relativeQuarterContextSchema.parse(context);
  return `相对期间以本次接收时北京时间所在的${c.anchorQuarter.year}年第${c.anchorQuarter.quarter}季度为基准；已转换为明确季度。日历季度结束不代表数据已填报或审定，缺期不自动退回其他季度。`;
}
