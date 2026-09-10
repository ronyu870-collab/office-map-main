'use client';

import { useCallback, useEffect, useState } from 'react';

const EXIT_SELECTOR = '.comp-exit-btn';

function findNativeExitControl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(EXIT_SELECTOR);
}

function raiseNativeToolbar(): void {
  const exit = findNativeExitControl();
  if (!exit) return;

  exit.setAttribute('role', 'button');
  exit.setAttribute('tabindex', '0');
  exit.setAttribute('aria-label', '退出周边项目对比');

  const toolbarWrapper = exit.parentElement?.parentElement?.parentElement;
  if (toolbarWrapper instanceof HTMLElement) {
    toolbarWrapper.style.zIndex = '520';
    toolbarWrapper.style.maxWidth = 'calc(100vw - 24px)';
  }
}

function clickNativeExit(): boolean {
  const exit = findNativeExitControl();
  if (!exit) return false;
  exit.click();
  return true;
}

export function MapCompetitorModeGuard() {
  const [active, setActive] = useState(false);

  const requestExit = useCallback(() => {
    if (clickNativeExit()) return;

    // The controller creates the native toolbar synchronously after competitor markers,
    // but allow one frame for map overlay work before retrying.
    window.requestAnimationFrame(() => {
      clickNativeExit();
    });
  }, []);

  useEffect(() => {
    const onFound = () => {
      setActive(true);
      window.requestAnimationFrame(raiseNativeToolbar);
    };
    const onCleared = () => setActive(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || event.key !== 'Escape') return;
      event.preventDefault();
      requestExit();
    };

    window.addEventListener('competitors-found', onFound);
    window.addEventListener('competitors-cleared', onCleared);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('competitors-found', onFound);
      window.removeEventListener('competitors-cleared', onCleared);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [active, requestExit]);

  if (!active) return null;

  return (
    <button
      type="button"
      onClick={requestExit}
      className="fixed right-4 top-[72px] z-[540] rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
      aria-label="退出周边项目对比"
    >
      退出周边对比
    </button>
  );
}
