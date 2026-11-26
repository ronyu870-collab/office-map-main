import { expect, it } from 'vitest';
import { futureSupplyImage, markerBadgeImage } from '../mapSelectionMarker';

function geometry(image: string) {
  const svg = new DOMParser().parseFromString(decodeURIComponent(image.split(',')[1]), 'image/svg+xml');
  return Array.from(svg.querySelectorAll('circle, polygon, path, rect')).map(shape => {
    const copy = shape.cloneNode(true) as Element;
    for (const attr of ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray']) copy.removeAttribute(attr);
    return copy.outerHTML;
  }).join('');
}

it.each(['default', 'rent', 'vacancy', 'leed'] as const)('distinguishes stock, future and pending geometry without color in %s mode', mode => {
  const stock = markerBadgeImage({background:'#4f7968',border:'#ffffff',textColor:'#ffffff',text:'–',fontSize:12});
  const future = futureSupplyImage({}, mode);
  const pending = futureSupplyImage({status:'pending'}, mode);
  expect(new Set([stock,future,pending].map(geometry)).size).toBe(3);
});
