'use client';

import { useLayoutEffect, useRef } from 'react';

/** A restored project is a new DOM tree. Give it a reading focus once, while
 * leaving an already focused control or a newer user action in charge. */
export function useMapReturnFocus(ready: boolean) {
  const completed = useRef(false);
  useLayoutEffect(() => {
    if (!ready || completed.current) return;
    let observer: MutationObserver | undefined;
    const cancel = () => { completed.current = true; observer?.disconnect(); };
    const restore = () => {
      if (completed.current) return;
      if (document.activeElement && document.activeElement !== document.body) { cancel(); return; }
      const title = Array.from(document.querySelectorAll<HTMLElement>('.workspace-building .workspace-panel-header h2'))
        .find(node => !node.closest('[hidden], [inert], [aria-hidden="true"]') && node.getClientRects().length > 0);
      if (!title) return;
      title.focus({ preventScroll: true });
      cancel();
    };
    restore();
    if (!completed.current) {
      observer = new MutationObserver(restore);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden'] });
    }
    document.addEventListener('pointerdown', cancel, true);
    document.addEventListener('keydown', cancel, true);
    document.addEventListener('focusin', cancel, true);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('keydown', cancel, true);
      document.removeEventListener('focusin', cancel, true);
    };
  }, [ready]);
}
