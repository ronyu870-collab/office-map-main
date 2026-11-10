'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import NProgress from 'nprogress';

const FEEDBACK_DELAY_MS = 80;
const MAX_PENDING_MS = 10_000;

NProgress.configure({
  showSpinner: false,
  minimum: 0.1,
  easing: 'ease',
  speed: 300,
  trickleSpeed: 200,
});

function pathKey(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/';
}

export function NavigationProgress() {
  const pathname = usePathname();
  const pending = useRef({
    start: null as ReturnType<typeof setTimeout> | null,
    expire: null as ReturnType<typeof setTimeout> | null,
    visible: false,
  });

  const finish = useCallback(() => {
    const state = pending.current;
    if (state.start !== null) clearTimeout(state.start);
    if (state.expire !== null) clearTimeout(state.expire);
    state.start = null;
    state.expire = null;
    if (state.visible) NProgress.done();
    state.visible = false;
  }, []);

  useEffect(() => finish(), [pathname, finish]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')
        || link.getAttribute('aria-disabled') === 'true') return;
      if (!URL.canParse(link.href, window.location.href)) return;
      const destination = new URL(link.href, window.location.href);
      // Hashes and in-page query changes do not commit a new workspace pathname.
      if (destination.origin !== window.location.origin ||
        pathKey(destination.pathname) === pathKey(window.location.pathname)) return;

      const state = pending.current;
      if (state.start !== null) clearTimeout(state.start);
      if (state.expire !== null) clearTimeout(state.expire);
      if (!state.visible) {
        state.start = setTimeout(() => {
          state.start = null;
          state.visible = true;
          NProgress.start();
        }, FEEDBACK_DELAY_MS);
      }
      // A cancelled or failed navigation should never leave a perpetual indicator.
      state.expire = setTimeout(finish, MAX_PENDING_MS);
    };

    // Observe before Next's handler prevents the browser's default navigation.
    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      finish();
    };
  }, [finish]);

  return null;
}
