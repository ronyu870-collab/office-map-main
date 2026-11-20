'use client';

import * as React from 'react';
import {
  DEFAULT_LANGUAGE, translateUiText,
  type InterfaceLanguage,
} from './messages';

const STORAGE_KEY = 'colliers.interface-language.v1';
const CHANGE_EVENT = 'colliers:language-change';
let inMemoryLanguage: InterfaceLanguage = DEFAULT_LANGUAGE;

function readLanguage(): InterfaceLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'en-US' ? 'en-US' : saved === 'zh-CN' ? 'zh-CN' : inMemoryLanguage;
  } catch {
    return inMemoryLanguage;
  }
}

function subscribeLanguage(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onStoreChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export function setInterfaceLanguage(language: InterfaceLanguage): void {
  if (language !== 'zh-CN' && language !== 'en-US') return;
  inMemoryLanguage = language;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Still switch in-memory if browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useLanguage() {
  const language = React.useSyncExternalStore(
    subscribeLanguage, readLanguage, () => DEFAULT_LANGUAGE,
  );
  const t = React.useCallback(
    (source: string) => translateUiText(source, language),
    [language],
  );
  return { language, setLanguage: setInterfaceLanguage, t };
}

/** Keep screen-reader language aligned with the selected interface copy. */
export function HtmlLanguage() {
  const { language } = useLanguage();
  React.useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return null;
}
