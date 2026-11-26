import type { SubmarketSummary } from '../model/submarketOverview';
import type { RenderMode } from '../model/mapDomain';
import { markerTextColor } from './mapMarkerContrast';

/** Sequential quantity scale. Color describes magnitude, never market quality. */
export const SUBMARKET_COLORS = ['#536f83', '#416480', '#2e5372', '#193e5b'] as const;
export const SUBMARKET_NEUTRAL = '#596b78';

export function submarketColor(mode: RenderMode, rent: number | null, vacancy: number | null, leed: number | null): string {
  if (mode === 'default') return '#245b78';
  const value = mode === 'rent' ? rent : mode === 'vacancy' ? vacancy : leed;
  if (value == null || !Number.isFinite(value)) return SUBMARKET_NEUTRAL;
  const steps = mode === 'rent' ? [100, 200, 300] : mode === 'vacancy' ? [10, 20, 30] : [20, 40, 60];
  return SUBMARKET_COLORS[steps.filter(step => value >= step).length];
}

/** Presentation only: every numerical fact comes from the Phase 01 summary. */
export function createSubmarketBubble({ name, summary, mode = 'default', leed = null, selected = false }: {
  name: string; summary?: SubmarketSummary; mode?: RenderMode;
  leed?: number | null; selected?: boolean;
}): HTMLButtonElement {
  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.className = 'map-submarket-bubble';
  bubble.dataset.submarket = name;
  bubble.dataset.renderMode = mode;
  bubble.setAttribute('aria-pressed', String(selected));
  const offices = summary?.officeCount ?? 0;
  const parks = summary?.parkCount ?? 0;
  const count = offices ? `甲乙级 ${offices} 个` : parks ? `产业园 ${parks} 个`
    : summary?.projectCount ? `办公项目 ${summary.projectCount} 个` : '区域资料';
  const rent = summary?.rent ?? null;
  const vacancy = summary?.vacancyPct ?? null;
  const rentText = rent == null ? null : `¥${rent.toFixed(1)}`;
  const vacancyText = vacancy == null ? null : `${vacancy.toFixed(1)}%`;
  const hasStock = Boolean(offices || parks || summary?.projectCount);
  bubble.dataset.factState = !hasStock ? 'profile' : !offices && parks ? 'park' : rentText || vacancyText ? 'observed' : 'not-recorded';
  const color = hasStock ? submarketColor(mode, rent, vacancy, leed) : SUBMARKET_NEUTRAL;
  bubble.style.setProperty('--sm-accent', color);
  bubble.style.setProperty('--sm-foreground', markerTextColor(color));
  const add = (parent: HTMLElement, className: string, text: string) => {
    const span = document.createElement('span'); span.className = className; span.textContent = text; parent.append(span); return span;
  };
  const heading = add(bubble, 'map-submarket-bubble__name', name);
  if (name === '通惠河传媒走廊') heading.replaceChildren(document.createTextNode('通惠河'), document.createElement('br'), document.createTextNode('传媒走廊'));
  if (hasStock) {
    const metrics = document.createElement('span'); metrics.className = 'map-submarket-bubble__metrics';
    const values: string[] = [];
    if (mode === 'leed') values.push(leed == null ? '认证未收录' : `LEED ${leed.toFixed(0)}%`);
    else if (!offices && parks) values.push('产业园市场');
    else {
      const ordered = mode === 'vacancy' ? [vacancyText, rentText] : [rentText, vacancyText];
      values.push(...ordered.filter((value): value is string => value !== null));
      if (!values.length) values.push('行情未收录');
    }
    values.forEach((value, index) => {
      if (index) add(metrics, 'map-submarket-bubble__sep', '·');
      add(metrics, index ? 'map-submarket-bubble__secondary' : 'map-submarket-bubble__primary', value);
    });
    bubble.append(metrics);
  } else bubble.classList.add('map-submarket-bubble--name-only');
  add(bubble, 'map-submarket-bubble__count', count);
  // Complete facts remain available to keyboard, touch accessibility and the brief.
  const description = `${name}，${count}，净有效租金${rent == null ? '未收录' : `${rent.toFixed(1)}元/平方米/月`}，空置率${vacancyText ?? '未收录'}${mode === 'leed' ? `，LEED ${leed == null ? '未收录' : `${leed.toFixed(0)}%`}` : ''}`;
  bubble.title = description;
  bubble.setAttribute('aria-label', `查看${description}子市场介绍`);
  return bubble;
}
