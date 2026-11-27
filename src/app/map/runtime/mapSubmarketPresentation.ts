import type { BubbleMarketSummary } from './mapSubmarketOverview';
import type { RenderMode } from '../model/mapDomain';
import { markerTextColor } from './mapMarkerContrast';

/** Sequential quantity scale. Color describes magnitude, never market quality. */
export const SUBMARKET_COLORS = ['#536f83', '#416480', '#2e5372', '#193e5b'] as const;
export const SUBMARKET_NEUTRAL = '#596b78';
export const SUBMARKET_VACANCY_COLORS = ['#4f7968', '#786d43', '#995d43', '#884851'] as const;
export const SUBMARKET_LEED_COLORS = ['#536f83', '#527666', '#3f6c55', '#285640'] as const;
export function submarketScale(mode: RenderMode) {
  return mode === 'vacancy' ? SUBMARKET_VACANCY_COLORS : mode === 'leed' ? SUBMARKET_LEED_COLORS : SUBMARKET_COLORS;
}

export function submarketColor(mode: RenderMode, rent: number | null, vacancy: number | null, leed: number | null): string {
  if (mode === 'default') return '#245b78';
  const value = mode === 'rent' ? rent : mode === 'vacancy' ? vacancy : leed;
  if (value == null || !Number.isFinite(value)) return SUBMARKET_NEUTRAL;
  const steps = mode === 'rent' ? [100, 200, 300] : mode === 'vacancy' ? [10, 20, 30] : [20, 40, 60];
  return submarketScale(mode)[steps.filter(step => value >= step).length];
}

/** Presentation only: every numerical fact comes from the Phase 01 summary. */
export function createSubmarketBubble({ name, summary, mode = 'default', leed = null, selected = false }: {
  name: string; summary?: BubbleMarketSummary; mode?: RenderMode;
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
  const count = offices ? (parks ? `甲乙级 ${offices} · 园区 ${parks}` : `甲乙级 ${offices} 个`) : parks ? `产业园 ${parks} 个`
    : summary?.projectCount ? `办公项目 ${summary.projectCount} 个` : '区域资料';
  const parkOnly = !offices && parks > 0;
  const facts = parkOnly ? summary?.parkFacts : summary;
  // A single park observation is not a market statistic (Goal02).
  const rent = parkOnly && (facts?.rentSampleCount ?? 0) < 2 ? null : facts?.rent ?? null;
  const vacancy = parkOnly && (facts?.vacancySampleCount ?? 0) < 2 ? null : facts?.vacancyPct ?? null;
  const rentText = rent == null ? null : `¥${rent.toFixed(1)}`;
  const vacancyText = vacancy == null ? null : `${vacancy.toFixed(1)}%`;
  const certification = summary?.leedFacts;
  const leedPercent = certification ? certification.percent : leed;
  const leedText = certification
    ? certification.unknown === certification.total ? '认证未收录'
      : certification.unknown > 0 ? `已认证 ${certification.certified} 个`
      : `LEED ${(certification.percent ?? 0).toFixed(0)}%`
    : leedPercent == null ? '认证未收录' : `LEED ${leedPercent.toFixed(0)}%`;
  const hasStock = Boolean(offices || parks || summary?.projectCount);
  bubble.dataset.factState = !hasStock ? 'profile' : parkOnly ? 'park' : rentText || vacancyText ? 'observed' : 'not-recorded';
  bubble.dataset.productScope = parkOnly ? 'park' : 'office';
  const color = hasStock ? submarketColor(mode, rent, vacancy, leedPercent) : SUBMARKET_NEUTRAL;
  bubble.style.setProperty('--sm-accent', color);
  bubble.style.setProperty('--sm-foreground', markerTextColor(color));
  const add = (parent: HTMLElement, className: string, text: string) => {
    const span = document.createElement('span'); span.className = className; span.textContent = text; parent.append(span); return span;
  };
  const heading = add(bubble, 'map-submarket-bubble__name', name);
  if (name === '通惠河传媒走廊' || name === '望京-酒仙桥') {
    const parts = name === '通惠河传媒走廊' ? ['通惠河', '传媒走廊'] : ['望京-', '酒仙桥'];
    heading.replaceChildren(document.createTextNode(parts[0]), document.createElement('br'), document.createTextNode(parts[1]));
  }
  if (hasStock) {
    const metrics = document.createElement('span'); metrics.className = 'map-submarket-bubble__metrics';
    const values: string[] = [];
    if (mode === 'leed') values.push(leedText);
    else {
      const primary = mode === 'vacancy' ? vacancyText : rentText;
      const secondary = mode === 'vacancy' ? rentText : vacancyText;
      const sparse = parkOnly && ((facts?.rentSampleCount ?? 0) === 1 || (facts?.vacancySampleCount ?? 0) === 1);
      if (mode === 'rent' || mode === 'vacancy') {
        const insufficient = parkOnly && (mode === 'rent' ? facts?.rentSampleCount : facts?.vacancySampleCount) === 1;
        values.push(primary ?? (insufficient ? '样本不足' : mode === 'rent' ? '租金未收录' : '空置未收录'));
        if (secondary && primary) values.push(secondary);
      } else {
        values.push(...[rentText, vacancyText].filter((value): value is string => value !== null));
        if (!values.length) values.push(sparse ? '样本不足' : '行情未收录');
      }
    }
    values.forEach((value, index) => {
      if (index) add(metrics, 'map-submarket-bubble__sep', '·');
      add(metrics, index ? 'map-submarket-bubble__secondary' : 'map-submarket-bubble__primary', value);
    });
    bubble.append(metrics);
  } else bubble.classList.add('map-submarket-bubble--name-only');
  const countLine = add(bubble, 'map-submarket-bubble__count', count);
  if (offices && parks) {
    countLine.classList.add('map-submarket-bubble__count--mixed');
    countLine.replaceChildren();
    add(countLine, 'map-submarket-bubble__count-item', `甲乙级 ${offices}`);
    add(countLine, 'map-submarket-bubble__count-divider', ' · ');
    add(countLine, 'map-submarket-bubble__count-item', `园区 ${parks}`);
  }
  // Complete facts remain available to keyboard, touch accessibility and the brief.
  const coverage = certification ? `，已确认认证 ${certification.certified} 个，明确未认证 ${certification.negative} 个，未收录 ${certification.unknown} 个，共 ${certification.total} 个` : '';
  const sampleContext = [facts?.rentSampleCount === 1 && '租金单项目观测', facts?.vacancySampleCount === 1 && '空置率单项目观测'].filter(Boolean).join('，');
  if (sampleContext) bubble.dataset.sampleQuality = 'single';
  const description = `${name}，${count}，${parkOnly ? '园区' : '甲乙级'}净有效租金${rent == null ? '未收录或样本不足' : `${rent.toFixed(1)}元/平方米/月`}，空置率${vacancyText ?? '未收录或样本不足'}${mode === 'leed' ? `，${leedText}${coverage}` : ''}${sampleContext ? `，${sampleContext}` : ''}`;
  bubble.title = description;
  bubble.setAttribute('aria-label', `查看${description}子市场介绍`);
  return bubble;
}
