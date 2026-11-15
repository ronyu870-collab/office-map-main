// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeVisibleMapFocusOffset, panMapFocusIntoAvailableArea } from '../mapFocusViewport';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('map focus uses the unobstructed workbench viewport', () => {
  it('shifts the focal point left from a right-side list and below the search toolbar', () => {
    const offset = computeVisibleMapFocusOffset(
      new DOMRect(0, 80, 1200, 800),
      { top: new DOMRect(0, 80, 1200, 80), right: new DOMRect(850, 190, 350, 600) },
    );
    expect(offset.x).toBeLessThan(-100);
    expect(offset.y).toBeGreaterThan(0);
  });

  it('does not overcorrect when a drawer consumes nearly all of a phone viewport', () => {
    const offset = computeVisibleMapFocusOffset(new DOMRect(0, 80, 390, 680), {
      right: new DOMRect(30, 120, 360, 600),
    });
    expect(offset.x).toBe(0);
  });

  it('pans exactly once for the measured safe area and ignores hidden overlays', () => {
    const main = document.createElement('main');
    const map = document.createElement('div');
    const search = document.createElement('div');
    const right = document.createElement('div');
    search.dataset.mapFocusTop = '';
    right.dataset.mapFocusRight = '';
    main.append(map, search, right);
    document.body.append(main);
    map.getBoundingClientRect = () => new DOMRect(0, 50, 1200, 750);
    search.getBoundingClientRect = () => new DOMRect(5, 55, 1190, 90);
    right.getBoundingClientRect = () => new DOMRect(855, 170, 345, 630);
    const panBy = vi.fn();
    const offset = panMapFocusIntoAvailableArea({ panBy }, map);
    expect(offset.x).toBeLessThan(0);
    expect(panBy).toHaveBeenCalledOnce();
    expect(panBy).toHaveBeenCalledWith(offset.x, offset.y, 0);
    right.style.display = 'none';
    const noSidebar = panMapFocusIntoAvailableArea({ panBy }, map);
    expect(noSidebar.x).toBe(0);
  });

  it('accounts for a left-side filter panel rendered outside <main>', () => {
    const root = document.createElement('div');
    root.dataset.mapFocusRoot = '';
    const workbench = document.createElement('div');
    const main = document.createElement('main');
    const map = document.createElement('div');
    const filter = document.createElement('div');
    filter.dataset.mapFocusLeft = '';
    main.append(map);
    workbench.append(main);
    root.append(workbench, filter);
    document.body.append(root);
    map.getBoundingClientRect = () => new DOMRect(0, 60, 1200, 760);
    filter.getBoundingClientRect = () => new DOMRect(10, 160, 330, 600);
    const panBy = vi.fn();
    const offset = panMapFocusIntoAvailableArea({ panBy }, map);
    expect(offset.x).toBeGreaterThan(140);
    expect(panBy).toHaveBeenCalledWith(offset.x, offset.y, 0);
  });
});
