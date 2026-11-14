import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { RenderMode } from './mapDomain';

export const MAP_COMPARE_LEAVE_EVENT = 'map-compare-leave';
export const MAP_COMPARE_RETURN_PARAM = 'mapReturn';
const historyKey = '__colliersMapCompareReturn';
const maxAgeMs = 30 * 60_000;

export type MapCompareReturn = {
  scope: string;
  buildingId: string;
  search: string;
  filter: SidebarFilterState | null;
  mode: RenderMode;
  viewport: { zoom: number; center: [number, number] } | null;
};

// Keep only the last comparison handoff in this document. No business records or
// search text go into the URL, browser storage or other tabs.
let saved: { token: string; at: number; state: MapCompareReturn } | null = null;

export function rememberMapCompareReturn(token: string, state: MapCompareReturn) {
  window.history.replaceState({ ...window.history.state, [historyKey]: token }, '');
  saved = { token, at: Date.now(), state };
}

export function hasMapCompareReturn(token: string | null) {
  return token !== null && saved?.token === token && Date.now() - saved.at <= maxAgeMs;
}

export function readMapCompareReturn(scope: string | null): MapCompareReturn | null {
  if (typeof window === 'undefined' || !scope || saved?.state.scope !== scope) return null;
  const token = window.history.state?.[historyKey] ?? null;
  return hasMapCompareReturn(token) ? saved.state : null;
}
