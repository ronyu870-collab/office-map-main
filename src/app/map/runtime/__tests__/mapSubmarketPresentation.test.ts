// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { submarketSummary } from '../../model/submarketOverview';
import { createSubmarketBubble, submarketColor, SUBMARKET_VACANCY_COLORS } from '../mapSubmarketPresentation';
import { buildSubmarketBubbleEntries, summarizeBubbleMarkets } from '../mapSubmarketOverview';

const row = (name: string, grade = 'A', rent: number | null = 0, vacancy: number | null = 0) => ({ id: name, submarket: name, grade,
  metrics: [{ is_locked: true, is_draft: false, record_year: 2026, record_quarter: 2, total_area: 100, net_effective_rent: rent, vacancy_rate: vacancy }] });

describe('submarket facts expressed in a shared compact bubble', () => {
  it.each(['通惠河传媒走廊', '望京-酒仙桥', '丰台科技园', '东城商务区'])('keeps %s complete and zero observations visible', name => {
    const summary = submarketSummary([row(name)], name);
    const bubble = createSubmarketBubble({ name, summary });
    expect(bubble.querySelector('.map-submarket-bubble__name')?.textContent).toBe(name);
    expect(bubble.textContent).toContain('¥0.0'); expect(bubble.textContent).toContain('0.0%');
    expect(bubble.textContent).toContain('甲乙级 1 个');
    expect(bubble.tagName).toBe('BUTTON');
    expect(bubble.getAttribute('aria-label')).toContain('0.0元/平方米/月');
  });
  it('shows real park inventory without suggesting an empty office market', () => {
    const rows = [{ ...row('丰台科技园', 'BP', 100, .2), id: 'park1' }, { ...row('丰台科技园', 'BP', 200, .4), id: 'park2' }];
    const summary = summarizeBubbleMarkets(rows).get('丰台科技园');
    const bubble = createSubmarketBubble({ name: '丰台科技园', summary });
    expect(bubble.textContent).toContain('产业园 2 个');
    expect(bubble.textContent).toContain('¥150.0'); expect(bubble.textContent).toContain('30.0%');
    expect(bubble.textContent).not.toMatch(/甲乙级 0|产业园市场/);
    const sparse = createSubmarketBubble({ name: '丰台科技园', mode: 'rent', summary: summarizeBubbleMarkets(rows.slice(0, 1)).get('丰台科技园') });
    expect(sparse.textContent).toContain('样本不足'); expect(sparse.textContent).not.toContain('¥100');
  });
  it('separates certified, negative and unknown LEED observations before using a denominator', () => {
    const rows = [null, '', 'N', '金级', 'LEED O+M v4 铂金级'].map((leed_certification, index) => ({ ...row('CBD'), id: String(index), leed_certification }));
    const summary = summarizeBubbleMarkets(rows).get('CBD');
    expect(summary?.leedFacts).toEqual({ certified: 2, negative: 1, unknown: 2, total: 5, percent: null });
    const bubble = createSubmarketBubble({ name: 'CBD', summary, mode: 'leed' });
    expect(bubble.textContent).toContain('已认证 2 个'); expect(bubble.textContent).not.toContain('%');
    expect(createSubmarketBubble({ name: 'CBD', summary: summarizeBubbleMarkets(rows.slice(0, 2)).get('CBD'), mode: 'leed' }).textContent).toContain('认证未收录');
    expect(summarizeBubbleMarkets(rows.slice(2)).get('CBD')?.leedFacts?.percent).toBeCloseTo(200/3);
    expect(summarizeBubbleMarkets(rows.slice(2, 3)).get('CBD')?.leedFacts?.percent).toBe(0);
  });
  it('keeps a stable catalog anchor but never imports filtered-out market facts', () => {
    const a = { ...row('CBD', 'A', 100, .1), id: 'a', location_lng: 116.4, location_lat: 39.9 };
    const b = { ...row('CBD', 'A', 300, .3), id: 'b', location_lng: 116.5, location_lat: 39.95 };
    const first = buildSubmarketBubbleEntries([a], [a], [a,b])[0];
    const second = buildSubmarketBubbleEntries([b], [b], [a,b])[0];
    expect(first.center).toEqual(second.center); expect(first.summary?.rent).toBe(100); expect(second.summary?.rent).toBe(300);
  });
  it('distinguishes partial observations, unpublished fields and profile-only areas', () => {
    const missing = createSubmarketBubble({ name: 'CBD', summary: submarketSummary([row('CBD', 'A', null, null)], 'CBD') });
    expect(missing.textContent).toContain('行情未收录');
    const partial = createSubmarketBubble({ name: 'CBD', mode: 'vacancy', summary: submarketSummary([row('CBD', 'A', null, .2)], 'CBD') });
    expect(partial.querySelector('.map-submarket-bubble__primary')?.textContent).toBe('20.0%');
    expect(partial.textContent).not.toContain('¥'); expect(partial.getAttribute('aria-label')).toContain('净有效租金未收录');
    const profile = createSubmarketBubble({ name: '玉渊潭' });
    expect(profile.textContent).toBe('玉渊潭区域资料'); expect(profile.textContent).not.toMatch(/150|¥|0 个/);
    expect(profile.querySelector('.map-submarket-bubble__metrics')).toBeNull();
  });
  it('prioritizes the active measure and preserves full facts and selection separately from magnitude', () => {
    const summary = submarketSummary([row('CBD', 'A', 205.3, .163)], 'CBD');
    const vacancy = createSubmarketBubble({ name: 'CBD', summary, mode: 'vacancy', selected: true });
    expect(vacancy.querySelector('.map-submarket-bubble__primary')?.textContent).toBe('16.3%');
    expect(vacancy.getAttribute('aria-pressed')).toBe('true');
    const leed = createSubmarketBubble({ name: 'CBD', summary, mode: 'leed', leed: 60 });
    expect(leed.textContent).toContain('LEED 60%'); expect(leed.textContent).toContain('甲乙级 1 个');
    expect(leed.getAttribute('aria-label')).toContain('205.3元/平方米/月');
    expect(submarketColor('vacancy', 205.3, 16.3, 60)).toBe(SUBMARKET_VACANCY_COLORS[1]);
    expect(vacancy.style.getPropertyValue('--sm-accent')).toBe(submarketColor('vacancy', 205.3, 16.3, 60));
  });
});

it('keeps 16 distinct named area anchors across mode changes without using a reference estimate', () => {
  const names = ['CBD','上地','东城商务区','丽泽','中关村','丰台科技园','亚奥','亦庄','北清路','四季青','望京-酒仙桥','燕莎','玉渊潭','通州','通惠河传媒走廊','金融街'];
  const rows = names.map((name,index)=>({...row(name, ['上地','四季青'].includes(name) ? 'BP' : 'A', 120, .2), id:'region-'+index, location_lng:116.2+index*.025, location_lat:39.9+(index%4)*.05}));
  const entries = buildSubmarketBubbleEntries(rows,rows,rows,true);
  expect(entries.map(entry=>entry.name).sort()).toEqual([...names].sort());
  for (const entry of entries) for (const mode of ['default','rent','vacancy','leed'] as const) {
    const bubble = createSubmarketBubble({...entry,mode});
    expect(bubble.dataset.submarket).toBe(entry.name);
    expect(bubble.querySelector('.map-submarket-bubble__name')?.textContent).toBe(entry.name);
  }
});
