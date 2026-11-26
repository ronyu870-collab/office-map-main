import { describe, expect, it } from 'vitest';
import { initialWorkspaceState, PANEL_SIZES, mapCanvasMinimum, contentPanelWidth, workspaceColumns, workspaceReducer, workspaceSheetHeight, type WorkspaceKind } from './workspaceState';
import { fitMapExtent, mercatorPoint } from '../runtime/mapExtent';
import { visibleMapRect } from '../runtime/mapFocusViewport';
import { createDefaultFilterState } from '../model/mapDomain';

describe('map workspace navigation and physical canvas budget', () => {
  it('reserves map proportion as well as a pixel minimum when two panels compete', () => {
    const columns = workspaceColumns(1280, true, true, 400);
    expect(1280 - columns.left - columns.right).toBeGreaterThanOrEqual(1280 * .52);
    expect(columns.leftCollapsed).toBe(true);
    expect(workspaceColumns(1536, true, true, 400).left).toBeGreaterThan(0);
  });
  it('uses a stable width for each task and restores the user width on return', () => {
    let state = workspaceReducer(initialWorkspaceState, { type: 'open', view: { kind: 'list' } });
    expect(state.width).toBe(320);
    state = workspaceReducer(state, { type: 'width', width: 390 });
    state = workspaceReducer(state, { type: 'open', view: { kind: 'submarket', name: 'CBD' } });
    expect(state.width).toBe(PANEL_SIZES.submarket.initial);
    state = workspaceReducer(state, { type: 'width', width: 500 });
    state = workspaceReducer(state, { type: 'open', view: { kind: 'search' } });
    expect(state.width).toBe(304);
    state = workspaceReducer(state, { type: 'back' });
    expect(state.width).toBe(500);
    state = workspaceReducer(state, { type: 'back' });
    expect(state.width).toBe(390);
  });
  it('starts collapsed and restores both panels after focus mode without losing their history', () => {
    let state = workspaceReducer(initialWorkspaceState, { type: 'left', open: true });
    state = workspaceReducer(state, { type: 'open', view: { kind: 'list' } });
    state = workspaceReducer(state, { type: 'open', view: { kind: 'building', building: { id: 'a' } } });
    state = workspaceReducer(state, { type: 'open', view: { kind: 'building', building: { id: 'b' } } });
    expect(state.history).toEqual([{ kind: 'list' }]);
    const focused = workspaceReducer(state, { type: 'focus' });
    expect(focused.focus).toBe(true);
    expect(workspaceReducer(focused, { type: 'focus' })).toEqual(state);
    expect(workspaceReducer(state, { type: 'back' }).right?.kind).toBe('list');
  });
  it('retains the first research snapshot across area switches and distinguishes keeping its filter', () => {
    const snapshot = { filters: createDefaultFilterState(), input: '原输入', retained: false };
    const first = workspaceReducer(initialWorkspaceState, { type: 'research', name: 'CBD', snapshot });
    const next = workspaceReducer(first, { type: 'research', name: '金融街', snapshot: { ...snapshot, input: 'changed' } });
    expect(next.research).toBe(snapshot);
    expect(next.right).toEqual({ kind: 'submarket', name: '金融街' });
    expect(workspaceReducer(next, { type: 'retain' }).research?.retained).toBe(true);
  });
  it('keeps the retained area as the next research baseline without retaining a different area implicitly', () => {
    const initial = { filters: createDefaultFilterState(), input: '', retained: false };
    let state = workspaceReducer(initialWorkspaceState, { type: 'research', name: 'CBD', snapshot: initial });
    state = workspaceReducer(state, { type: 'retain' });
    const baseline = { ...initial, filters: { ...initial.filters, submarkets: ['CBD'] } };
    state = workspaceReducer(state, { type: 'research', name: '中关村', snapshot: baseline });
    expect(state.research).toBe(baseline);
    expect(state.research?.retained).toBe(false);
    state = workspaceReducer(state, { type: 'research', name: '金融街', snapshot: initial });
    expect(state.research).toBe(baseline);
  });
  it('never spends the minimum desktop canvas width on panels, even when resizing', () => {
    for (let width = 1000; width <= 2200; width += 10) {
      for (const preferred of [360, 440, 520]) {
        const columns = workspaceColumns(width, true, true, preferred);
        expect(width - columns.left - columns.right).toBeGreaterThanOrEqual(560);
      }
    }
    expect(workspaceColumns(390, true, true, 520).compact).toBe(true);
    expect(workspaceColumns(1280, true, true, 440).leftCollapsed).toBe(true);
    expect(workspaceColumns(1536, true, true, 440).left).toBe(280);
  });
  it('fits every task to a real map budget at intermediate widths without overwriting preferred widths', () => {
    for (let width = 320; width <= 2200; width += 16) for (const kind of Object.keys(PANEL_SIZES) as WorkspaceKind[]) {
      const { min, max } = PANEL_SIZES[kind];
      for (const left of [false, true]) {
        const columns = workspaceColumns(width, left, true, max, kind);
        if (columns.compact) continue;
        const canvas = width - columns.left - columns.right;
        expect(canvas).toBeGreaterThanOrEqual(mapCanvasMinimum(width, columns.left > 0) - .01);
        expect(columns.right).toBeGreaterThanOrEqual(min);
        expect(columns.right).toBeLessThanOrEqual(max);
      }
    }
  });
  it('sizes short content compactly and preserves map space until full reading is requested', () => {
    expect(workspaceSheetHeight(700, 160, 'compact')).toBe(160);
    expect(workspaceSheetHeight(700, 900, 'compact')).toBeCloseTo(385);
    expect(workspaceSheetHeight(700, 160, 'reading')).toBeCloseTo(455);
    expect(workspaceSheetHeight(700, 160, 'full')).toBe(700);
    expect(workspaceSheetHeight(200, 900, 'compact')).toBeLessThanOrEqual(136);
  });
});

it('leaves room for an actual region camera and marker edges in very short sheets', () => {
  const rows = [
    { id: 'west', location_lng: 116.46, location_lat: 39.91 },
    { id: 'east', location_lng: 116.53, location_lat: 39.95 },
  ];
  for (const height of [158, 176, 240, 300]) {
    const sheet = workspaceSheetHeight(height, 900, 'compact');
    const canvas = { left: 0, top: 0, right: 626, bottom: height, width: 626, height };
    const panel = { left: 0, right: 626, top: height - 24 - sheet, bottom: height - 24, width: 626, height: sheet };
    const target = fitMapExtent(rows, canvas, visibleMapRect(canvas, { bottom: panel }));
    expect(target, `a ${height}px stage can issue a region camera`).not.toBeNull();
    const center = mercatorPoint(...target!.center), scale = 256 * 2 ** target!.zoom;
    for (const row of rows) {
      const world = mercatorPoint(row.location_lng, row.location_lat);
      const x = (world[0] - center[0]) * scale + 313;
      const y = (world[1] - center[1]) * scale + height / 2;
      expect(Math.min(x, 626 - x, y, panel.top - y)).toBeGreaterThanOrEqual(24);
    }
    expect(sheet).toBeGreaterThanOrEqual(52);
  }
  expect(workspaceSheetHeight(176, 900, 'compact', 'search')).toBeGreaterThan(100);
  expect(workspaceSheetHeight(176, 900, 'compact', 'filters')).toBeGreaterThan(100);
});

it('uses compact content widths before a user preference exists and avoids unnecessary tablet sheets', () => {
  expect(contentPanelWidth('search', 1)).toBe(288);
  expect(contentPanelWidth('list', 2)).toBe(300);
  expect(contentPanelWidth('list', 20)).toBe(320);
  expect(workspaceColumns(820, false, true, 344, 'building').compact).toBe(false);
  let state = initialWorkspaceState;
  for (let i = 0; i < 40; i++) state = workspaceReducer(state, { type: 'open', view: { kind: i % 2 ? 'list' : 'supply' } });
  expect(state.history).toHaveLength(20);
});

it('adapts research width only inside the map budget and restores the requested width on return', () => {
  expect(workspaceColumns(1200, false, true, undefined, 'submarket').right).toBe(480);
  expect(workspaceColumns(1500, false, true, undefined, 'submarket').right).toBe(540);
  expect(workspaceColumns(1920, false, true, undefined, 'submarket').right).toBe(640);
  expect(workspaceColumns(390, false, true, undefined, 'submarket').compact).toBe(true);
  const snapshot = { filters: createDefaultFilterState(), input: '', retained: false };
  let state = workspaceReducer(initialWorkspaceState, { type: 'research', name: 'CBD', snapshot });
  state = workspaceReducer(state, { type: 'width', width: 620 });
  const narrowed = workspaceColumns(1024, false, true, state.widths.submarket, 'submarket');
  expect(narrowed.right).toBeLessThan(480);
  expect(1024 - narrowed.right).toBeGreaterThanOrEqual(mapCanvasMinimum(1024));
  state = workspaceReducer(state, { type: 'open', view: { kind: 'building', building: { id: 'retained' } } });
  state = workspaceReducer(state, { type: 'back' });
  expect(state.right).toEqual({ kind: 'submarket', name: 'CBD' });
  expect(workspaceColumns(1920, false, true, state.widths.submarket, 'submarket').right).toBe(620);
});

it('uses a readable side pane in low-height landscape while keeping half the map', () => {
  const result = workspaceColumns(844, false, true, 400, 'submarket', 212);
  expect(result.compact).toBe(false);
  expect(result.right).toBeGreaterThanOrEqual(360);
  expect(844 - result.right).toBeGreaterThanOrEqual(422);
});

it('keeps the short identity state stable when its own hidden header reduces measured content', () => {
  const expandedHeaderSummary = workspaceSheetHeight(272, 190, 'compact');
  const reducedHeaderSummary = workspaceSheetHeight(272, 130, 'compact');
  expect(expandedHeaderSummary).toBe(52);
  expect(reducedHeaderSummary).toBe(expandedHeaderSummary);
});
