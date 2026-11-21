'use client';

import * as React from 'react';
import { mapBuildingHref } from '@/src/lib/broker/links';
import { z } from 'zod';
import { mapFilterCriteria } from '../model/mapFilterPreference';
import type { WorkspaceState, WorkspaceView } from './workspaceState';
import type { FullListBuilding } from '../model/fullBuildingList';

const view = z.object({ kind: z.enum(['building', 'submarket', 'list', 'supply', 'search', 'compare', 'full-list']), id: z.string().max(100).optional(), future: z.boolean().optional(), name: z.string().max(100).optional() });
const scrollPosition = z.number().finite().min(0).max(10000000);
const sort = z.enum(['default', 'name', 'area', 'rent', 'rent-desc', 'vacancy', 'vacancy-desc']);
const readingSchema = z.object({
  listQuery: z.string().max(200).optional(), listSort: sort.optional(), fullSort: sort.optional(),
  listCount: z.number().int().min(1).max(100000).optional(), listViewMode: z.enum(['cards', 'compact']).optional(),
  listScroll: scrollPosition.optional(), fullScroll: scrollPosition.optional(),
  fullPaging: z.object({ queryKey: z.string().max(10000), page: z.number().int().min(1).max(10000) }).optional(),
  sheetModes: z.record(z.string().max(30), z.enum(['compact', 'reading', 'full'])).optional(),
  comparisonIds: z.array(z.string().max(110)).max(500).optional(),
  buildings: z.record(z.string().max(110), z.object({ tab: z.string().max(20).refine(value => ['overview', 'market', 'materials'].includes(value)), scrollTop: scrollPosition })).optional(),
});
const snapshot = z.object({
  savedAt: z.number(), selected: z.string().max(100).nullable(),
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
    return result.success && now - result.data.savedAt <= MAX_AGE && now >= result.data.savedAt ? result.data : null;
  } catch { return null; }
}
export function saveMapReturn(scope: string, token: string, value: MapReturnSnapshot) {
  if (!scope || !TOKEN.test(token)) return;
  try {
    const key = PREFIX + scope + ':' + token;
    const parsed = snapshot.safeParse(value);
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
export function rememberMapEntry(token: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('resume', token);
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
    width: saved.widths[right?.kind ?? 'list'] ?? 320, widths: saved.widths, focus: false, research: saved.research };
}

export type ReadingStore = Record<string, unknown>;
export const MapReadingContext = React.createContext<ReadingStore | null>(null);
export function useMapReadingState<T>(key: string, initial: T) {
  const store = React.useContext(MapReadingContext);
  const [value, setValue] = React.useState<T>(() => (store?.[key] as T | undefined) ?? initial);
  const update = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(next => setValue(previous => {
    const result = typeof next === 'function' ? (next as (old: T) => T)(previous) : next;
    if (store) store[key] = result;
    return result;
  }), [key, store]);
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
    const restore = () => { if (restoring) element.scrollTop = desired; };
    const takeOver = () => { restoring = false; };
    const save = () => { if (!restoring && store) store[key] = element.scrollTop; };
    reset.current = position => {
      desired = Math.max(0, position); if (store) store[key] = desired; restoring = true; restore();
    };
    restore();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restore);
    for (const child of element.children) observer?.observe(child);
    element.addEventListener('wheel', takeOver, { passive: true }); element.addEventListener('pointerdown', takeOver);
    element.addEventListener('keydown', takeOver); element.addEventListener('scroll', save);
    return () => { reset.current = null; observer?.disconnect(); element.removeEventListener('wheel', takeOver); element.removeEventListener('pointerdown', takeOver);
      element.removeEventListener('keydown', takeOver); element.removeEventListener('scroll', save); };
  }, [active, initial, key, ref, store]);
  return resetScroll;
}
