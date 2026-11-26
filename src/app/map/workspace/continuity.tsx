'use client';

import * as React from 'react';
import { restoreLeedFilterCatalog } from '@/src/lib/leed-display';
import { mapBuildingHref } from '@/src/lib/broker/links';
import { z } from 'zod';
import { mapFilterCriteria } from '../model/mapFilterPreference';
import type { WorkspaceState, WorkspaceView } from './workspaceState';
import type { FullListBuilding } from '../model/fullBuildingList';

const view = z.object({ kind: z.enum(['building', 'submarket', 'list', 'supply', 'search', 'compare', 'full-list']), id: z.string().max(100).optional(), future: z.boolean().optional(), name: z.string().max(100).optional() });
const scrollPosition = z.number().finite().min(0).max(10000000);
const sort = z.enum(['default', 'name', 'area', 'rent', 'rent-desc', 'vacancy', 'vacancy-desc']);
const readingSchema = z.object({
  baseMapPointsVisible: z.boolean().optional(),
  listQuery: z.string().max(200).optional(), listSort: sort.optional(), fullSort: sort.optional(),
  listCount: z.number().int().min(1).max(100000).optional(), listViewMode: z.enum(['cards', 'compact']).optional(),
  listScroll: scrollPosition.optional(), fullScroll: scrollPosition.optional(),
  fullPaging: z.object({ queryKey: z.string().max(10000), page: z.number().int().min(1).max(10000) }).optional(),
  sheetModes: z.record(z.string().max(30), z.enum(['compact', 'reading', 'full'])).optional(),
  comparisonIds: z.array(z.string().max(110)).max(500).optional(),
  previousSheetModes: z.record(z.string().max(30), z.enum(['compact', 'reading', 'full'])).optional(),
  filterSections: z.record(z.string().max(40), z.boolean()).optional(), filterScroll: scrollPosition.optional(),
  supplyExpanded: z.record(z.string().max(80), z.boolean()).optional(), supplyScroll: scrollPosition.optional(),
  submarkets: z.record(z.string().max(100), z.object({ section: z.enum(['overview', 'trend', 'profile', 'buildings']), grade: z.enum(['all', 'a', 'b']), scrollTop: scrollPosition })).optional(),
  buildings: z.record(z.string().max(110), z.object({ tab: z.string().max(20).refine(value => ['overview', 'market', 'materials'].includes(value)), scrollTop: scrollPosition, scrolls: z.record(z.string().max(20), scrollPosition).optional(), trendOpen: z.boolean().optional(), trendHeight: scrollPosition.optional(), trend: z.object({ metric: z.enum(['rent', 'vac']), tableOpen: z.boolean() }).optional(), photo: z.object({ open: z.boolean(), index: z.number().int().min(0).max(10000) }).optional() })).optional(),
});
const snapshot = z.object({
  leedCatalogVersion: z.literal(2).optional(), savedAt: z.number(), focus: z.boolean().optional(), selected: z.string().max(100).nullable(),
  camera: z.object({ center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]), zoom: z.number().min(3).max(22) }).nullable(),
  mode: z.enum(['default', 'rent', 'vacancy', 'leed']), input: z.string().max(200), filters: mapFilterCriteria.nullable(),
  right: view.nullable(), history: z.array(view).max(20), leftOpen: z.boolean(), widths: z.record(z.string(), z.number().min(280).max(600)),
  reading: readingSchema, comparison: z.array(z.string().max(110)).max(500),
  competitors: z.array(z.string().max(100)).max(1000).nullable(), target: z.string().max(100).nullable(),
  groups: z.array(z.object({ id: z.string().max(100), name: z.string().max(100), color: z.string().max(50), submarkets: z.array(z.string()).max(100), grades: z.array(z.string()).max(100), districts: z.array(z.string()).max(100) })).max(20).default([]),
  research: z.object({ filters: mapFilterCriteria, input: z.string().max(200), center: z.tuple([z.number(), z.number()]).optional(), zoom: z.number().optional(), retained: z.boolean() }).nullable().default(null),
});
export type MapReturnSnapshot = z.infer<typeof snapshot>;
export type Camera = NonNullable<MapReturnSnapshot['camera']>;
const TOKEN = /^[a-zA-Z0-9-]{8,80}$/;
const PREFIX = 'map-workspace-return:v1:';
const MAX_AGE = 8 * 60 * 60 * 1000;

export function mapReturnToken(explicit?: string | null) {
  const url = new URL(window.location.href);
  const candidate = explicit ?? url.searchParams.get('resume') ?? window.history.state?.mapWorkspaceReturn;
  return typeof candidate === 'string' && TOKEN.test(candidate) ? candidate : crypto.randomUUID();
}
export function readMapReturn(scope: string, token: string, now = Date.now()): MapReturnSnapshot | null {
  if (!scope || !TOKEN.test(token)) return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + scope + ':' + token);
    if (!raw || raw.length > 200000) return null;
    const result = snapshot.safeParse(JSON.parse(raw));
    if (!result.success || now - result.data.savedAt > MAX_AGE || now < result.data.savedAt) return null;
    const value = result.data;
    value.filters = restoreLeedFilterCatalog(value.filters, value.leedCatalogVersion);
    if (value.research) value.research.filters = restoreLeedFilterCatalog(value.research.filters, value.leedCatalogVersion)!;
    return value;
  } catch { return null; }
}
export function saveMapReturn(scope: string, token: string, value: MapReturnSnapshot) {
  if (!scope || !TOKEN.test(token)) return;
  try {
    const key = PREFIX + scope + ':' + token;
    const parsed = snapshot.safeParse({ ...value, leedCatalogVersion: 2, history: value.history.slice(-20) });
    const encoded = parsed.success ? JSON.stringify(parsed.data) : '';
    if (!encoded || encoded.length > 200000) { sessionStorage.removeItem(key); return; }
    // Retain a bounded number of UI-only snapshots; no business records or credentials are cached.
    const keys = Object.keys(sessionStorage).filter(item => item.startsWith(PREFIX));
    for (const old of keys) {
      if (!old.startsWith(PREFIX + scope + ':')) sessionStorage.removeItem(old);
    }
    const own = keys.filter(item => item.startsWith(PREFIX + scope + ':') && item !== key);
    for (const old of own.slice(0, Math.max(0, own.length - 15))) sessionStorage.removeItem(old);
    sessionStorage.setItem(key, encoded);
  } catch { /* Browsing and explicit project links still work when storage is unavailable. */ }
}
export function rememberMapEntry(token: string, selection?: { id: string; future?: boolean } | null) {
  const url = new URL(window.location.href);
  url.searchParams.set('resume', token);
  if (selection !== undefined) {
    url.searchParams.delete('building'); url.searchParams.delete('future'); url.searchParams.delete('section');
    if (selection) url.searchParams.set(selection.future ? 'future' : 'building', selection.id);
  }
  window.history.replaceState({ ...window.history.state, mapWorkspaceReturn: token }, '', url);
}
export function currentMapReturnHref(id: string, section?: 'deals') {
  window.dispatchEvent(new Event('map-workspace-save-return'));
  const href = mapBuildingHref(id, { section });
  return `${href}&resume=${encodeURIComponent(mapReturnToken())}`;
}
export function compactView(value: WorkspaceView | null): MapReturnSnapshot['right'] {
  if (!value) return null;
  if (value.kind === 'building') return { kind: value.kind, id: value.building.id, future: value.building._dataType === 'future' };
  if (value.kind === 'submarket') return { kind: value.kind, name: value.name };
  return { kind: value.kind };
}
export function restoreWorkspace(saved: MapReturnSnapshot, buildings: FullListBuilding[], futures: FullListBuilding[]): WorkspaceState {
  const hydrate = (entry: MapReturnSnapshot['right']): WorkspaceView | null => {
    if (!entry) return null;
    if (entry.kind === 'building') {
      const building = (entry.future ? futures : buildings).find(item => item.id === entry.id);
      return building ? { kind: 'building', building: { ...building, _dataType: entry.future ? 'future' : 'existing' } } : null;
    }
    if (entry.kind === 'submarket') return entry.name ? { kind: 'submarket', name: entry.name } : null;
    return { kind: entry.kind };
  };
  const right = hydrate(saved.right);
  return { leftOpen: saved.leftOpen, right, history: saved.history.map(hydrate).filter((item): item is WorkspaceView => Boolean(item)),
    width: saved.widths[right?.kind ?? 'list'] ?? 320, widths: saved.widths, focus: saved.focus ?? false, research: saved.research };
}

export type ReadingStore = Record<string, unknown>;
export const MapReadingContext = React.createContext<ReadingStore | null>(null);
export function useMapReadingState<T>(key: string, initial: T) {
  const store = React.useContext(MapReadingContext);
  const [state, setValue] = React.useState<{ key: string; value: T }>(() => ({ key, value: (store?.[key] as T | undefined) ?? initial }));
  const value = state.key === key ? state.value : (store?.[key] as T | undefined) ?? initial;
  const initialRef = React.useRef(initial); initialRef.current = initial;
  const update = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(next => setValue(previous => {
    const current = previous.key === key ? previous.value : (store?.[key] as T | undefined) ?? initialRef.current;
    const result = typeof next === 'function' ? (next as (old: T) => T)(current) : next;
    if (store) store[key] = result;
    return { key, value: result };
  }), [key, store]);
  return [value, update] as const;
}
export function useMapObjectReadingState<T>(collection: string, identity: string, initial: T) {
  const [items, setItems] = useMapReadingState<Record<string, T>>(collection, {});
  const value = items[identity] ?? initial;
  const initialRef = React.useRef(initial); initialRef.current = initial;
  const update = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(next => setItems(previous => {
    const current = previous[identity] ?? initialRef.current;
    return { ...previous, [identity]: typeof next === 'function' ? (next as (old: T) => T)(current) : next };
  }), [identity, setItems]);
  return [value, update] as const;
}
/** Restore after late content/size changes without stealing the user's scroll. */
export function useMapReadingScroll(ref: React.RefObject<HTMLDivElement | null>, key: string, active = true, initial = 0) {
  const store = React.useContext(MapReadingContext);
  const reset = React.useRef<((position: number) => void) | null>(null);
  const resetScroll = React.useCallback((position = 0) => {
    if (store) store[key] = Math.max(0, position);
    if (reset.current) reset.current(position);
    else if (ref.current) ref.current.scrollTop = position;
  }, [key, ref, store]);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    let desired = typeof store?.[key] === 'number' ? Math.max(0, store[key] as number) : initial;
    let restoring = true;
    const measure = () => ({ height: element.clientHeight, total: element.scrollHeight });
    let geometry = measure();
    const changed = (next: typeof geometry) => next.height !== geometry.height || next.total !== geometry.total;
    const hidden = (next: typeof geometry) => next.height === 0 && geometry.height > 0;
    const clamp = (position: number, range: typeof geometry) => range.height > 0 ? Math.min(position, Math.max(0, range.total - range.height)) : position;
    const restore = () => {
      const next = measure();
      if (hidden(next)) return;
      const resized = changed(next);
      if (resized && !restoring && Math.abs(element.scrollTop - clamp(desired, geometry)) >= 1 && Math.abs(element.scrollTop - clamp(desired, next)) >= 1) {
        // A fresh user scroll can arrive in the same turn as late content.
        // Only a position explained by either range is a layout clamp.
        desired = element.scrollTop;
        if (store) store[key] = desired;
      }
      geometry = next;
      // Expanding a sheet can make its content fit and clamp scrollTop to 0.
      // Keep the user's last position until the range returns or they take over.
      if (restoring || resized) element.scrollTop = desired;
    };
    const takeOver = () => {
      restoring = false; desired = element.scrollTop; geometry = measure();
      if (store) store[key] = desired;
    };
    const save = () => {
      const next = measure();
      if (hidden(next)) return;
      // Browser scroll events may precede ResizeObserver delivery. A range
      // change is a layout clamp, not a new user reading position.
      if (changed(next)) { restore(); return; }
      if (restoring) return;
      const clamped = clamp(desired, next);
      if (Math.abs(element.scrollTop - clamped) < 1) return;
      desired = element.scrollTop;
      if (store) store[key] = desired;
    };
    reset.current = position => {
      desired = Math.max(0, position); if (store) store[key] = desired; restoring = true; restore();
    };
    restore();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restore);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    element.addEventListener('wheel', takeOver, { passive: true }); element.addEventListener('pointerdown', takeOver);
    element.addEventListener('keydown', takeOver); element.addEventListener('scroll', save);
    return () => { reset.current = null; observer?.disconnect(); element.removeEventListener('wheel', takeOver); element.removeEventListener('pointerdown', takeOver);
      element.removeEventListener('keydown', takeOver); element.removeEventListener('scroll', save); };
  }, [active, initial, key, ref, store]);
  return resetScroll;
}
