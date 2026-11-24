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
export type WorkspaceKind = WorkspaceView['kind'];
export const PANEL_SIZES: Record<WorkspaceKind, { initial: number; min: number; max: number }> = {
  search: { initial: 304, min: 288, max: 360 },
  list: { initial: 320, min: 300, max: 400 },
  supply: { initial: 336, min: 320, max: 420 },
  building: { initial: 376, min: 344, max: 480 },
  submarket: { initial: 400, min: 360, max: 520 },
  compare: { initial: 360, min: 320, max: 420 },
  'full-list': { initial: 400, min: 320, max: 520 },
};
export type PanelWidths = Partial<Record<WorkspaceKind, number>>;
export function panelWidth(kind: WorkspaceKind, widths: PanelWidths) {
  return widths[kind] ?? PANEL_SIZES[kind].initial;
}
export type WorkspaceState = {
  leftOpen: boolean; right: WorkspaceView | null; history: WorkspaceView[];
  width: number; widths: PanelWidths; focus: boolean; research: ResearchSnapshot | null;
};
export const initialWorkspaceState: WorkspaceState = {
  leftOpen: false, right: null, history: [], width: 320, widths: {}, focus: false, research: null,
};
export type WorkspaceAction =
  | { type: 'restore'; state: WorkspaceState }
  | { type: 'left'; open: boolean }
  | { type: 'open'; view: WorkspaceView; replace?: boolean }
  | { type: 'close' | 'back' | 'focus' | 'retain' }
  | { type: 'width'; width: number; kind?: WorkspaceKind }
  | { type: 'research'; name: string; snapshot: ResearchSnapshot }
  | { type: 'end-research' };
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'restore': return action.state;
    case 'left': return { ...state, leftOpen: action.open, focus: false };
    case 'width': {
      if (!Number.isFinite(action.width)) return state;
      const kind = action.kind ?? state.right?.kind ?? 'list';
      const range = PANEL_SIZES[kind];
      const width = Math.max(range.min, Math.min(range.max, action.width));
      return { ...state, width, widths: { ...state.widths, [kind]: width } };
    }
    case 'focus': return { ...state, focus: !state.focus };
    case 'open': {
      // A → B replaces the current building, while list/research → building has a return path.
      const replace = action.replace || state.right?.kind === action.view.kind;
      return { ...state, focus: false, right: action.view, width: panelWidth(action.view.kind, state.widths),
        history: replace || !state.right ? state.history : [...state.history, state.right].slice(-20) };
    }
    case 'back': return { ...state, right: state.history.at(-1) ?? null, history: state.history.slice(0, -1),
      width: panelWidth(state.history.at(-1)?.kind ?? 'list', state.widths) };
    case 'close': return { ...state, right: null, history: [] };
    case 'research': return { ...state, focus: false, right: { kind: 'submarket', name: action.name }, width: panelWidth('submarket', state.widths), history: [], research: state.research?.retained ? action.snapshot : state.research ?? action.snapshot };
    case 'retain': return { ...state, research: state.research ? { ...state.research, retained: true } : null };
    case 'end-research': return { ...state, research: null };
  }
}

/** Content drives the initial width; explicit user widths always win. */
export function contentPanelWidth(kind: WorkspaceKind, count: number, title = '') {
  const range = PANEL_SIZES[kind];
  const compact = ['search', 'list', 'supply'].includes(kind) && count <= 3;
  const longIdentity = kind === 'building' && title.length > 28;
  return Math.max(range.min, Math.min(range.max, compact ? range.min : range.initial + (longIdentity ? 24 : 0)));
}
export function mapCanvasMinimum(width: number, both = false) {
  return Math.max(Math.min(560, Math.max(420, width - 344)), width * (both ? .5 : .56));
}
/** Reserve a real map column. Narrow layouts use vertical drawers instead. */
export function workspaceColumns(width: number, left: boolean, right: boolean, preferred: number, kind: WorkspaceKind = 'list', height = Infinity) {
  const range = PANEL_SIZES[kind];
  // A landscape sheet can leave only a few pixels of map below the toolbar.
  // Keep the two work surfaces beside each other when each has usable width.
  const landscape = width >= 760 && height > 0 && height < 360;
  const mapMinimum = landscape ? Math.min(mapCanvasMinimum(width), Math.max(360, width * .5)) : mapCanvasMinimum(width);
  if (width < 760 || (right && width - range.min < mapMinimum) || (!right && left && width - 248 < mapMinimum)) {
    return { left: 0, right: 0, compact: true, leftCollapsed: false };
  }
  let rightWidth = right ? Math.max(range.min, Math.min(range.max, preferred, width - mapMinimum)) : 0;
  let leftWidth = 0;
  if (left) {
    // Budget both panels before temporarily yielding the filter. Never mutate the user's open intent.
    const room = width - rightWidth - (landscape ? mapMinimum : mapCanvasMinimum(width, right));
    if (room >= 248) leftWidth = Math.min(280, room);
  }
  if (right && !leftWidth) rightWidth = Math.min(rightWidth, width - mapMinimum);
  return { left: leftWidth, right: rightWidth, compact: false, leftCollapsed: left && !leftWidth };
}

export type SheetMode = 'compact' | 'reading' | 'full';
export function workspaceSheetHeight(available: number, summary: number, mode: SheetMode, kind: WorkspaceKind | 'filters' = 'submarket') {
  if (mode === 'full') return available;
  const preserveMap = kind === 'submarket' || kind === 'building';
  // A fixed short-stage boundary avoids feeding the measured summary back
  // into its own visibility. The compact state is an identity/action bar; reading
  // remains explicit; its hidden body must not consume the camera's map strip.
  if (preserveMap && mode === 'compact' && available < 320) return Math.min(available, 52);
  // In a short phone viewport, keep the summary readable while retaining a
  // visible map strip. Reading/full remain explicit user choices.
  const reserveRatio = available < 320 ? .32 : .4;
  const limit = Math.max(0, available - Math.min(240, available * reserveRatio));
  const compactRatio = available < 320 ? .68 : available < 360 ? .6 : .55;
  return Math.max(0, Math.min(limit, mode === 'reading' ? available * .65 : Math.min(available * compactRatio, Math.max(128, summary))));
}
