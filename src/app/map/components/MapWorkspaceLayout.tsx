'use client';
import * as React from 'react';
import { workspaceColumns } from '../workspace/workspaceState';

type Props = {
  left: React.ReactNode; right: React.ReactNode; children: React.ReactNode;
  leftOpen: boolean; rightOpen: boolean; focus: boolean; width: number;
  onWidthChange: (width: number) => void; onCollapseLeft: () => void;
};
export function MapWorkspaceLayout({ left, right, children, leftOpen, rightOpen, focus, width, onWidthChange, onCollapseLeft }: Props) {
  const root = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [available, setAvailable] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => setAvailable(el.getBoundingClientRect().width || window.innerWidth);
    update();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columns = workspaceColumns(available, leftOpen && !focus, rightOpen && !focus, width);
  React.useEffect(() => {
    if (columns.leftCollapsed) onCollapseLeft();
  }, [columns.leftCollapsed, onCollapseLeft]);
  const dragRef = React.useRef<{ start: number; width: number } | null>(null);
  return <div ref={root} className="map-workspace-layout" data-compact={columns.compact || undefined} data-expanded={expanded && columns.compact || undefined}
    style={{ '--workspace-left': `${columns.left}px`, '--workspace-right': `${columns.right}px` } as React.CSSProperties}>
    <aside className="map-workspace-left" data-open={leftOpen && !focus || undefined}
      inert={!leftOpen || focus || undefined} aria-hidden={!leftOpen || focus}>{left}</aside>
    {children}
    <aside className="map-workspace-right" data-open={rightOpen && !focus || undefined}
      inert={!rightOpen || focus || undefined} aria-hidden={!rightOpen || focus} aria-label="地图业务工作区">
      {columns.compact ? <button type="button" className="map-workspace-back" onClick={() => setExpanded(current => !current)}>{expanded ? '返回地图分屏' : '全屏阅读工作区'}</button> : null}
      <div role="separator" aria-label="调整业务工作区宽度" aria-orientation="vertical" tabIndex={0}
        aria-valuemin={360} aria-valuemax={520} aria-valuenow={width} className="map-workspace-resize"
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); onWidthChange(width + (event.key === 'ArrowLeft' ? 20 : -20));
          } else if (event.key === 'Home') onWidthChange(360);
          else if (event.key === 'End') onWidthChange(520);
        }}
        onPointerDown={event => {
          dragRef.current = { start: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (dragRef.current) onWidthChange(dragRef.current.width + dragRef.current.start - event.clientX); }}
        onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} />
      {right}
    </aside>
  </div>;
}
