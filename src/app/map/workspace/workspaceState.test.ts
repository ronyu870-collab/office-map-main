import { describe, expect, it } from 'vitest';
import { initialWorkspaceState, PANEL_SIZES, mapCanvasMinimum, contentPanelWidth, workspaceColumns, workspaceReducer, workspaceSheetHeight, type WorkspaceKind } from './workspaceState';
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
    expect(state.width).toBe(400);
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
    expect(workspaceSheetHeight(240, 160, 'compact')).toBe(160);
    expect(workspaceSheetHeight(200, 900, 'compact')).toBeLessThanOrEqual(136);
  });
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

it('uses a readable side pane in low-height landscape while keeping half the map', () => {
  const result = workspaceColumns(844, false, true, 400, 'submarket', 212);
  expect(result.compact).toBe(false);
  expect(result.right).toBeGreaterThanOrEqual(360);
  expect(844 - result.right).toBeGreaterThanOrEqual(422);
});
