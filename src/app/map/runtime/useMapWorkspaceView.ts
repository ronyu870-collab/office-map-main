'use client';
import * as React from 'react';
export type MapWorkspaceView = 'map' | 'list';
function readView(): MapWorkspaceView {
  return new URL(window.location.href).searchParams.get('view') === 'list' ? 'list' : 'map';
}
/** A single view state for controls and native browser history. */
export function useMapWorkspaceView(onEnterList: () => void) {
  const [state, setState] = React.useState({ view: 'map' as MapWorkspaceView, listVisited: false, revision: 0 });
  const viewRef = React.useRef<MapWorkspaceView>('map');
  const applyView = React.useCallback((next: MapWorkspaceView) => {
    if (next === viewRef.current) return;
    if (next === 'list') onEnterList();
    viewRef.current = next;
    setState(previous => ({ view: next, listVisited: previous.listVisited || next === 'list', revision: previous.revision + 1 }));
  }, [onEnterList]);
  React.useEffect(() => {
    const sync = () => applyView(readView());
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [applyView]);
  const changeView = React.useCallback((next: MapWorkspaceView) => {
    if (next === viewRef.current) return;
    const url = new URL(window.location.href);
    if (next === 'list') url.searchParams.set('view', 'list');
    else url.searchParams.delete('view');
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    applyView(next);
  }, [applyView]);
  return { view: state.view, revision: state.revision, listVisited: state.listVisited, viewRef, changeView };
}
