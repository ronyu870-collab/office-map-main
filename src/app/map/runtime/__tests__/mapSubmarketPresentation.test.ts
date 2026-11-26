// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { submarketSummary } from '../../model/submarketOverview';
import { createSubmarketBubble, submarketColor, SUBMARKET_COLORS } from '../mapSubmarketPresentation';

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
    const bubble = createSubmarketBubble({ name: '丰台科技园', summary: submarketSummary([row('丰台科技园', 'BP')], '丰台科技园') });
    expect(bubble.textContent).toContain('产业园市场'); expect(bubble.textContent).toContain('产业园 1 个');
    expect(bubble.textContent).not.toMatch(/甲乙级 0|¥—|¥0/);
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
    expect(submarketColor('vacancy', 205.3, 16.3, 60)).toBe(SUBMARKET_COLORS[1]);
    expect(vacancy.style.getPropertyValue('--sm-accent')).toBe(submarketColor('vacancy', 205.3, 16.3, 60));
  });
});
