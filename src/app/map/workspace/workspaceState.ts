import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import type { FullListBuilding } from '../model/fullBuildingList';

export type WorkspaceView =
  | { kind: 'building'; building: FullListBuilding }
  | { kind: 'submarket'; name: string }
  | { kind: 'list' | 'supply' | 'search' | 'compare' | 'full-list' };
export type ResearchSnapshot = {
  filters: SidebarFilterState; input: string;
  center?: [number, number]; zoom?: number; retained: boolean;
};
export type WorkspaceState = {
  leftOpen: boolean; right: WorkspaceView | null; history: WorkspaceView[];
  width: number; focus: boolean; research: ResearchSnapshot | null;
};
export const initialWorkspaceState: WorkspaceState = {
  leftOpen: false, right: null, history: [], width: 440, focus: false, research: null,
};
export type WorkspaceAction =
  | { type: 'left'; open: boolean }
  | { type: 'open'; view: WorkspaceView; replace?: boolean }
  | { type: 'close' | 'back' | 'focus' | 'retain' }
  | { type: 'width'; width: number }
  | { type: 'research'; name: string; snapshot: ResearchSnapshot }
  | { type: 'end-research' };
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'left': return { ...state, leftOpen: action.open, focus: false };
    case 'width': return { ...state, width: Math.max(360, Math.min(520, action.width)) };
    case 'focus': return { ...state, focus: !state.focus };
    case 'open': {
      // A → B replaces the current building, while list/research → building has a return path.
      const replace = action.replace || state.right?.kind === action.view.kind;
      return { ...state, focus: false, right: action.view,
        history: replace || !state.right ? state.history : [...state.history, state.right] };
    }
    case 'back': return { ...state, right: state.history.at(-1) ?? null, history: state.history.slice(0, -1) };
    case 'close': return { ...state, right: null, history: [] };
    case 'research': return { ...state, focus: false, right: { kind: 'submarket', name: action.name }, history: [], research: state.research?.retained ? action.snapshot : state.research ?? action.snapshot };
    case 'retain': return { ...state, research: state.research ? { ...state.research, retained: true } : null };
    case 'end-research': return { ...state, research: null };
  }
}

/** Reserve a real map column. Narrow layouts use vertical drawers instead. */
export function workspaceColumns(width: number, left: boolean, right: boolean, preferred: number) {
  if (width < 1000) return { left: 0, right: 0, compact: true, leftCollapsed: false };
  const rightWidth = right ? Math.max(360, Math.min(preferred, width - 560)) : 0;
  const leftWidth = left && width - rightWidth - 312 >= 560 ? 312 : 0;
  return { left: leftWidth, right: rightWidth, compact: false, leftCollapsed: left && !leftWidth };
}
