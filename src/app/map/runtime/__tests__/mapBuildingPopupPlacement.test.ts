import { waitFor } from '@testing-library/dom';
import { expect, it, vi } from 'vitest';
import { installInfoWindowAvoidance } from '../mapInfoWindowAvoidance';
import { BUILDING_POPUP_LAYOUT_EVENT } from '@/src/services/map/buildingPopup';

it('fits a tall stock popup between the phone controls without panning or accumulating offsets', async () => {
  const frame = document.createElement('div');
  const mapNode = document.createElement('div');
  const search = document.createElement('div');
  const footer = document.createElement('div');
  const info = document.createElement('div');
  const card = document.createElement('section');
  info.className = 'amap-info';
  card.className = 'building-popup';
  info.append(card);
  frame.append(mapNode, search, footer);
  document.body.append(frame);
  Object.assign(search.style, { position: 'absolute', zIndex: '330' });
  Object.assign(footer.style, { position: 'absolute', zIndex: '300' });
  const viewport = new DOMRect(0, 54, 390, 790);
  frame.getBoundingClientRect = mapNode.getBoundingClientRect = () => viewport;
  search.getBoundingClientRect = () => new DOMRect(12, 66, 366, 84);
  footer.getBoundingClientRect = () => new DOMRect(12, 748, 366, 84);
  const axis = (name: 'x' | 'y') => parseFloat(info.style.getPropertyValue('--building-popup-shift-' + name)) || 0;
  let unshiftedTop = -200;
  info.getBoundingClientRect = () => new DOMRect(-39 + axis('x'), unshiftedTop + axis('y'), 358, 530);
  const panBy = vi.fn();
  const on = vi.fn();
  const dispose = installInfoWindowAvoidance({ panBy, on }, mapNode);
  try {
    const closed = document.createElement('div');
    closed.className = 'amap-info';
    closed.style.display = 'none';
    info.style.display = 'none';
    mapNode.append(closed, info);
    await new Promise(resolve => setTimeout(resolve, 55));
    expect(info.getBoundingClientRect().top).toBe(-200);
    info.style.display = '';
    card.dispatchEvent(new Event(BUILDING_POPUP_LAYOUT_EVENT, { bubbles: true }));
    expect(info.getBoundingClientRect().top).toBe(162);
    expect(info.getBoundingClientRect().left).toBe(12);
    expect(info.getBoundingClientRect().bottom).toBeLessThan(736);
    expect(card.style.getPropertyValue('--building-popup-available-height')).toBe('564px');
    const moveEnd = on.mock.calls.find(([event]) => event === 'moveend')?.[1];
    unshiftedTop = 400;
    moveEnd?.();
    await waitFor(() => expect(info.getBoundingClientRect().bottom).toBe(736));
    moveEnd?.();
    await new Promise(resolve => setTimeout(resolve, 55));
    expect(info.getBoundingClientRect().bottom).toBe(736);
    expect(panBy).not.toHaveBeenCalled();
  } finally {
    dispose();
    frame.remove();
  }
  expect(info.hasAttribute('data-building-popup-shifted')).toBe(false);
});
