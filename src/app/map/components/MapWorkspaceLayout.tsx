'use client';
import * as React from 'react';
import { PANEL_SIZES, mapCanvasMinimum, workspaceColumns, workspaceSheetHeight, type SheetMode, type WorkspaceKind } from '../workspace/workspaceState';
import { WorkspacePanelContext } from './WorkspacePanelHeader';
import { useMapReadingState } from '../workspace/continuity';
import { useSurfaceMotion, useSurfacePresence } from '../runtime/workspaceMotion';

type Props = {
  left: React.ReactNode; right: React.ReactNode; children: React.ReactNode;
  leftOpen: boolean; rightOpen: boolean; focus: boolean; width: number; kind?: WorkspaceKind;
  onWidthChange: (width: number) => void; backLabel?: string | null; onBack?: () => void;
};
export function MapWorkspaceLayout({ left, right, children, leftOpen, rightOpen, focus, width, kind = 'list', onWidthChange, backLabel, onBack }: Props) {
  const root = React.useRef<HTMLDivElement>(null);
  const rightRef = React.useRef<HTMLElement>(null);
  const leftRef = React.useRef<HTMLElement>(null);
  const [available, setAvailable] = React.useState({ width: 0, height: 0 });
  const [summary, setSummary] = React.useState(200);
  const [modes, setModes] = useMapReadingState<Partial<Record<WorkspaceKind | 'filters', SheetMode>>>('sheetModes', {});
  const [previousModes, setPreviousModes] = useMapReadingState<Partial<Record<WorkspaceKind | 'filters', SheetMode>>>('previousSheetModes', {});
  const [leftPriority, setLeftPriority] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{ start: number; width: number } | null>(null);
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => {
      const bounds = el.getBoundingClientRect();
      setAvailable(previous => previous.width === bounds.width && previous.height === bounds.height ? previous : { width: bounds.width, height: bounds.height });
    };
    update();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }
    const observer = new ResizeObserver(update); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const navigation = React.useRef({ leftOpen, rightOpen, kind });
  React.useEffect(() => {
    const previous = navigation.current;
    if (leftOpen && !previous.leftOpen) setLeftPriority(true);
    if (rightOpen && (!previous.rightOpen || previous.kind !== kind)) setLeftPriority(false);
    navigation.current = { leftOpen, rightOpen, kind };
  }, [leftOpen, rightOpen, kind]);
  const desired = workspaceColumns(available.width, leftOpen && !focus, rightOpen && !focus, width, kind, available.height);
  const showLeftFirst = leftOpen && !focus && (!rightOpen || leftPriority);
  const columns = leftPriority && desired.leftCollapsed ? workspaceColumns(available.width, leftOpen && !focus, false, width, kind, available.height) : desired;
  const leftVisible = leftOpen && !focus && (columns.compact ? showLeftFirst : columns.left > 0);
  const rightVisible = rightOpen && !focus && (!columns.compact || !showLeftFirst) && !(leftPriority && desired.leftCollapsed);
  const modeKey = leftVisible && (columns.compact || !rightVisible) ? 'filters' : kind;
  const mode = modes[modeKey] ?? 'compact';
  const setMode = React.useCallback((next: SheetMode) => {
    if (next === 'full' && mode !== 'full') setPreviousModes(old => ({ ...old, [modeKey]: mode }));
    setModes(previous => ({ ...previous, [modeKey]: next }));
  }, [mode, modeKey, setModes, setPreviousModes]);
  const restoreMode = () => setMode(previousModes[modeKey] ?? 'compact');

  React.useLayoutEffect(() => {
    const aside = leftVisible ? leftRef.current : rightRef.current;
    if (!aside || (!leftVisible && !rightVisible)) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A visible scroller can temporarily be 0px tall before its first content measurement.
        const visible = (selector: string) => Array.from(aside.querySelectorAll<HTMLElement>(selector)).find(el => !el.closest('[hidden], .hidden, [aria-hidden="true"]'));
        const header = visible('.workspace-panel-header');
        const scroller = visible('.workspace-scroll');
        const marker = visible('[data-workspace-summary]');
        // A lazy list's loading placeholder has no reading geometry yet. Keep
        // the previous sheet rather than shrinking and expanding it in succession.
        if ((kind === 'list' || kind === 'compare') && !scroller) return;
        const prefix = Math.max(header?.getBoundingClientRect().height ?? 52, scroller ? scroller.getBoundingClientRect().top - aside.getBoundingClientRect().top : 0);
        let height = prefix + Math.min(scroller?.scrollHeight ?? aside.scrollHeight, 240);
        if (marker) height = marker.getBoundingClientRect().bottom - aside.getBoundingClientRect().top + (scroller?.scrollTop ?? 0) + 12;
        if (kind === 'list' || kind === 'compare') height = prefix + Math.min(scroller?.scrollHeight ?? 0, 160);
        setSummary(previous => Math.abs(previous - height) < 1 ? previous : height);
      });
    };
    measure();
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    aside.querySelectorAll('.workspace-panel-header, [data-workspace-summary], .workspace-scroll > div, .workspace-list-tools').forEach(el => resize?.observe(el));
    const mutations = new MutationObserver(measure);
    mutations.observe(aside, { childList: true, subtree: true, characterData: true });
    return () => { cancelAnimationFrame(frame); resize?.disconnect(); mutations.disconnect(); };
  }, [kind, leftVisible, rightVisible, columns.compact]);

  const sheetHeight = workspaceSheetHeight(available.height, summary, mode);
  const range = PANEL_SIZES[kind];
  const displayWidth = columns.right;
  // A wider right pane may temporarily yield the left pane; the user's width
  // should not be permanently capped by a filter that can be restored later.
  const maxWidth = Math.min(range.max, Math.floor(available.width - mapCanvasMinimum(available.width)));
  const expanded = mode === 'full' && (rightVisible || leftVisible);
  const accessibleLeft = leftVisible && (!expanded || modeKey === 'filters');
  const accessibleRight = rightVisible && (!expanded || modeKey !== 'filters');
  const lastGeometry = React.useRef({ right: width, left: 280, height: sheetHeight });
  if (accessibleRight) lastGeometry.current.right = expanded ? available.width : displayWidth;
  if (accessibleLeft) lastGeometry.current.left = columns.left || 280;
  if (accessibleLeft || accessibleRight) lastGeometry.current.height = expanded ? available.height : sheetHeight;
  const rightPresence = useSurfacePresence(accessibleRight, right);
  const leftPresence = useSurfacePresence(accessibleLeft, left);
  useSurfaceMotion(rightRef, accessibleRight, columns.compact, `${kind}:${mode}:${displayWidth}:${columns.compact ? sheetHeight : 0}`, { disabled: dragging });
  useSurfaceMotion(leftRef, accessibleLeft, columns.compact, `${mode}:${columns.left}:${columns.compact ? sheetHeight : 0}`, { disabled: dragging });
  React.useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.map-disclosure[open], dialog[open], [aria-modal="true"], [data-map-related-leases], [data-building-metrics-edit], #__colliers_contact_modal_overlay')) return;
      event.preventDefault(); event.stopPropagation(); setMode(previousModes[modeKey] ?? 'compact');
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [expanded, modeKey, setMode, previousModes]);
  const focusState = React.useRef({ left: false, right: false, leftOrigin: null as HTMLElement | null, rightOrigin: null as HTMLElement | null });
  const panelFocused = React.useRef({ left: false, right: false });
  React.useLayoutEffect(() => {
    const state = focusState.current;
    const active = document.activeElement;
    const scope = root.current?.closest('.map-workbench') ?? root.current;
    for (const side of ['left', 'right'] as const) {
      const open = side === 'left' ? accessibleLeft : accessibleRight;
      const aside = side === 'left' ? leftRef.current : rightRef.current;
      const originKey = side === 'left' ? 'leftOrigin' : 'rightOrigin';
      if (open && !state[side]) state[originKey] = active instanceof HTMLElement && active !== document.body && !aside?.contains(active) ? active : null;
      if (!open && state[side] && (aside?.contains(active) || panelFocused.current[side] && active === document.body)) {
        const origin = state[originKey];
        const fallback = side === 'left' ? '.workspace-restore-filter, [aria-label="筛选"]' : '[aria-label="项目列表"], input[type="search"]';
        const target = origin?.isConnected && !origin.closest('[inert], [aria-hidden="true"]') ? origin : scope?.querySelector<HTMLElement>(fallback);
        target?.focus({ preventScroll: true });
        panelFocused.current[side] = false;
      }
      state[side] = open;
    }
  }, [accessibleLeft, accessibleRight]);
  const blurPanel = (side: 'left' | 'right', event: React.FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) panelFocused.current[side] = false;
  };
  const finishDrag = () => { dragRef.current = null; setDragging(false); };
  return <div ref={root} className="map-workspace-layout" data-compact={columns.compact || undefined}
    data-short-stage={columns.compact && available.height > 0 && available.height < 320 || undefined}
    data-expanded={expanded || undefined} data-dragging={dragging || undefined} data-left-priority={showLeftFirst || undefined}
    style={{ '--workspace-left': `${columns.left}px`, '--workspace-right': `${columns.right}px`, '--workspace-sheet-height': `${sheetHeight}px`, '--workspace-exit-right': `${lastGeometry.current.right}px`, '--workspace-exit-left': `${lastGeometry.current.left}px`, '--workspace-exit-height': `${lastGeometry.current.height}px` } as React.CSSProperties}>
    <WorkspacePanelContext.Provider value={columns.compact ? { compact: true, mode: modes.filters ?? 'compact', setMode, restore: restoreMode } : null}>
      <aside ref={leftRef} className="map-workspace-left" data-open={accessibleLeft || undefined}
        onFocusCapture={() => { panelFocused.current.left = true; }} onBlurCapture={event => blurPanel('left', event)}
        data-exiting={leftPresence.exiting || undefined} inert={!accessibleLeft || undefined} aria-hidden={!accessibleLeft}>
        {/* Keep hidden filters live; an exit-only copy must not retain stale local state on return. */}
        {left == null && leftPresence.exiting ? <React.Fragment key="filter-exit">{leftPresence.children}</React.Fragment> : left}
      </aside>
    </WorkspacePanelContext.Provider>
    {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ inert?: boolean; 'aria-hidden'?: boolean }>, { inert: expanded || undefined, 'aria-hidden': expanded || undefined }) : children}
    <WorkspacePanelContext.Provider value={{ compact: columns.compact, mode, setMode, restore: restoreMode, backLabel, onBack }}>
      <aside ref={rightRef} className="map-workspace-right" data-open={accessibleRight || undefined}
        onFocusCapture={() => { panelFocused.current.right = true; }} onBlurCapture={event => blurPanel('right', event)}
        data-exiting={rightPresence.exiting || undefined}
        inert={!accessibleRight || undefined} aria-hidden={!accessibleRight} aria-label="地图业务工作区">
        <div role="separator" aria-label="调整业务工作区宽度" aria-orientation="vertical" tabIndex={0}
          aria-valuemin={range.min} aria-valuemax={Math.max(range.min, maxWidth)} aria-valuenow={Math.round(displayWidth)} className="map-workspace-resize"
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault(); onWidthChange(Math.min(maxWidth, Math.max(range.min, displayWidth + (event.key === 'ArrowLeft' ? 20 : -20))));
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault(); onWidthChange(event.key === 'Home' ? range.min : maxWidth);
            }
          }}
          onPointerDown={event => { dragRef.current = { start: event.clientX, width: displayWidth }; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (dragRef.current) onWidthChange(Math.min(maxWidth, Math.max(range.min, dragRef.current.width + dragRef.current.start - event.clientX))); }}
          onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} />
        {rightPresence.children}
      </aside>
    </WorkspacePanelContext.Provider>
    {!focus && (desired.leftCollapsed || (columns.compact && leftOpen && rightOpen)) ? <button type="button" className="workspace-restore-filter" onClick={() => setLeftPriority(current => !current)}>{leftPriority ? '返回业务工作区' : '恢复筛选'}</button> : null}
  </div>;
}
