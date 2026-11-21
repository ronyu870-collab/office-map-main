'use client';
import * as React from 'react';

/** Protect actual edits on links, refresh/close and browser history navigation. */
export function useUnsavedNavigation(dirty: boolean) {
  React.useEffect(() => {
    if (!dirty) return;
    const message = '编辑内容尚未保存，确定离开吗？';
    let leaving = false;
    const confirm = () => leaving || (leaving = window.confirm(message));
    const unload = (event: BeforeUnloadEvent) => { if (!leaving) { event.preventDefault(); event.returnValue = ''; } };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.('a[href]');
      if (!anchor || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0 || anchor.getAttribute('target') === '_blank' || anchor.hasAttribute('download')) return;
      if (!confirm()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType === 'traverse' && event.cancelable && !confirm()) event.preventDefault();
    };
    const marker = crypto.randomUUID();
    const address = window.location.href;
    const pop = () => {
      if (leaving || window.history.state?.unsavedNavigation === marker) return;
      if (confirm()) window.history.back();
      else window.history.pushState({ ...window.history.state, unsavedNavigation: marker }, '', address);
    };
    if (navigation) navigation.addEventListener('navigate', navigate);
    else { window.history.pushState({ ...window.history.state, unsavedNavigation: marker }, '', address); window.addEventListener('popstate', pop); }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', navigate); window.removeEventListener('popstate', pop);
      if (!navigation && !leaving && window.history.state?.unsavedNavigation === marker) window.history.back();
    };
  }, [dirty]);
}
