import { leedFallbackBadge } from '@/src/lib/leed-display';
import { markerTextColor } from './mapMarkerContrast';

type Mode = 'default' | 'rent' | 'vacancy' | 'leed';
type Visual = { background: string; border: string; textColor: string; text: string; fontSize: number };

export function markerBadgeImage(visual: Visual, future = false, dashed = false): string {
  const text = visual.text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const circles = future
    ? `<circle cx="17" cy="17" r="12" fill="${visual.background}" stroke="${visual.border}" stroke-width="2"${dashed ? ' stroke-dasharray="3 2"' : ''}/>`
    : `<circle cx="17" cy="17" r="16" fill="#ffffff" fill-opacity=".97"/><circle cx="17" cy="17" r="13.7" fill="${visual.background}" stroke="${visual.border}" stroke-width="1.3"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">${circles}<text x="17" y="17.4" text-anchor="middle" dominant-baseline="middle" font-family="Arial,PingFang SC,Microsoft YaHei,sans-serif" font-size="${visual.fontSize}" font-weight="600" fill="${markerTextColor(visual.background, visual.textColor)}">${text}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function futureSupplyImage(supply: { leed_certification?: unknown; leed?: unknown }, mode: Mode): string {
  let visual: Visual = { background: '#4f7968', border: '#ffffff', textColor: '#ffffff', text: 'F', fontSize: 12 };
  if (mode === 'rent' || mode === 'vacancy') {
    visual = { ...visual, background: '#94a3b8', text: '–', fontSize: 10 };
  } else if (mode === 'leed') {
    const leed = String(supply.leed_certification ?? supply.leed ?? '').toUpperCase();
    const colors = leed.includes('PLATINUM') ? ['#d9edf3', '#68aebf', '#225a68', 'P']
      : leed.includes('GOLD') ? ['#eadfbd', '#b69a52', '#6f5a25', 'G']
      : leed.includes('SILVER') ? ['#e7ebef', '#9ca8b3', '#52606d', 'S']
      : ['#eef1f4', '#bdc6ce', '#6f7c89', leedFallbackBadge(leed)];
    visual = { ...visual, background: colors[0], border: colors[1], textColor: colors[2], text: colors[3] };
  }
  return markerBadgeImage(visual, true, mode === 'default');
}

export function createSelectionMarker(image: string, future = false): HTMLDivElement {
  const content = document.createElement('div');
  content.className = `map-selected-marker${future ? ' map-selected-marker--future' : ''}`;
  content.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('img');
  badge.className = 'map-selected-marker__badge';
  badge.alt = '';
  badge.width = 34;
  badge.height = 34;
  badge.src = image;
  content.append(badge);
  return content;
}
