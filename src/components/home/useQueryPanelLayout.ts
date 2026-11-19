'use client';

import * as React from 'react';
import type { QueryWorkspaceMode } from './useQueryWorkspace';

export type QueryPanelLayout = 'drawer' | 'single' | 'both';

/** Panel capacity belongs to the actual workspace, which can be narrower than
 * the viewport in focus mode. One mounted sidebar changes only its layout. */
export function useQueryPanelLayout(surface: React.RefObject<HTMLDivElement | null>, mode: QueryWorkspaceMode, onDrawer: () => void) {
  const [layout, setLayout] = React.useState<QueryPanelLayout>('single');
  const previousLayout = React.useRef<QueryPanelLayout>('single');
  React.useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    const measure = () => {
      const viewport = window.visualViewport?.width ?? window.innerWidth;
      const fallback = mode === 'focus' && viewport >= 640 ? Math.min(1200, viewport - 64) : viewport;
      const width = node.clientWidth || fallback;
      const next = width < 960 ? 'drawer' : width < 1360 ? 'single' : 'both';
      if (next === 'drawer' && previousLayout.current !== 'drawer') onDrawer();
      previousLayout.current = next;
      setLayout(next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [surface, mode, onDrawer]);
  return layout;
}

export function panelControls(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(':is(button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"])'))
    .filter(control => {
      if (control.tabIndex < 0 || control.closest('[hidden], [inert], details:not([open]) > :not(summary)')) return false;
      for (let parent: HTMLElement | null = control; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parent === panel) break;
      }
      return true;
    });
}
