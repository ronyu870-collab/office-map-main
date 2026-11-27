import { isPendingFutureSupply } from '@/src/lib/future-supply-status';
import { leedFallbackBadge } from '@/src/lib/leed-display';
import { markerTextColor } from './mapMarkerContrast';
import { mapLeedLevel } from './mapSubmarketOverview';

type Mode = 'default' | 'rent' | 'vacancy' | 'leed';
type Visual = { background: string; border: string; textColor: string; text: string; fontSize: number };

function badgeImage(visual: Visual, shape: 'stock' | 'future' | 'pending', dashed = false): string {
  const text = visual.text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const outline = shape === 'stock'
    ? `<circle cx="17" cy="17" r="16" fill="#ffffff" fill-opacity=".97"/><circle cx="17" cy="17" r="13.7" fill="${visual.background}" stroke="${visual.border}" stroke-width="1.3"/>`
    : `<polygon points="${shape === 'pending' ? '17,2 32,17 17,32 2,17' : '17,3 29,10 29,24 17,31 5,24 5,10'}" fill="${visual.background}" stroke="${visual.border}" stroke-width="2"${dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">${outline}<text x="17" y="17.4" text-anchor="middle" dominant-baseline="middle" font-family="Arial,PingFang SC,Microsoft YaHei,sans-serif" font-size="${visual.fontSize}" font-weight="600" fill="${markerTextColor(visual.background, visual.textColor)}">${text}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function markerBadgeImage(visual: Visual): string {
  return badgeImage(visual, 'stock');
}

export function futureSupplyImage(supply: { status?: unknown; leed_certification?: unknown; leed?: unknown }, mode: Mode): string {
  let visual: Visual = { background: '#4f7968', border: '#ffffff', textColor: '#ffffff', text: isPendingFutureSupply(supply) ? '?' : 'F', fontSize: 12 };
  if (mode === 'rent' || mode === 'vacancy') {
    visual = { ...visual, background: '#94a3b8', text: '–', fontSize: 10 };
  } else if (mode === 'leed') {
    const leed = mapLeedLevel(supply.leed_certification ?? supply.leed);
    const colors = leed.includes('PLATINUM') ? ['#d9edf3', '#68aebf', '#225a68', 'P']
      : leed.includes('GOLD') ? ['#eadfbd', '#b69a52', '#6f5a25', 'G']
      : leed.includes('SILVER') ? ['#e7ebef', '#9ca8b3', '#52606d', 'S']
      : ['#eef1f4', '#bdc6ce', '#6f7c89', leedFallbackBadge(leed)];
    visual = { ...visual, background: colors[0], border: colors[1], textColor: colors[2], text: colors[3] };
  }
  return badgeImage(visual, isPendingFutureSupply(supply) ? 'pending' : 'future', mode === 'default');
}

export function createSelectionMarker(image: string, future = false, action?: { name: string; onLocate: () => void }): HTMLDivElement {
  const content = document.createElement('div');
  content.className = `map-selected-marker${future ? ' map-selected-marker--future' : ''}`;
  if (!action) content.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('img');
  badge.className = 'map-selected-marker__badge';
  badge.alt = '';
  badge.width = 34;
  badge.height = 34;
  badge.src = image;
  if (action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'map-selected-marker__locate';
    button.setAttribute('aria-label', `定位当前项目：${action.name}`);
    button.title = `定位当前项目：${action.name}`;
    button.onclick = event => { event.stopPropagation(); action.onLocate(); };
    button.append(badge); content.append(button);
  } else content.append(badge);
  return content;
}
