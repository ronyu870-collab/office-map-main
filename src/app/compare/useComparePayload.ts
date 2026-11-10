'use client';

import { useEffect, useState } from 'react';
import { fetchComparePayload, type CompareReadIdentity } from '@/src/services/mapDataClient';
import { subscribeCompareInvalidation } from '@/src/services/compareSnapshot';

type Payload = Awaited<ReturnType<typeof fetchComparePayload>>;
type Resource = '' | 'catalog' | 'all' | `selected:${string}`;
type Result = { key: Resource; retry: number; value: Payload | null; loading: boolean; refreshing: boolean; error: string | null };
const initial: Result = { key: '', retry: -1, value: null, loading: false, refreshing: false, error: null };

export function useComparePayload({ token, userId, role, targetUserId }: CompareReadIdentity, key: Resource, retry: number, onDenied: (message: string) => void) {
  const [state, setState] = useState(initial);
  const isSelection = key.startsWith('selected:');

  useEffect(() => {
    if (!key) return;
    let generation = 0;
    let expiresAt = 0;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let hasSnapshot = false;
    const slice = key === 'catalog' ? { scope: 'catalog' } as const : key === 'all' ? undefined
      : { scope: 'selected', ids: key.slice('selected:'.length).split(',') } as const;

    const load = async () => {
      const request = ++generation;
      clearTimeout(refreshTimer);
      expiresAt = Infinity;
      setState(previous => {
        const value = previous.retry === retry && (hasSnapshot || (isSelection && previous.key !== key)) ? previous.value : null;
        return { ...initial, key, retry, value, loading: !hasSnapshot, refreshing: hasSnapshot };
      });
      try {
        const payload = await fetchComparePayload({ token, userId, role, targetUserId }, slice);
        if (request !== generation) return;
        hasSnapshot = true;
        expiresAt = payload.expiresAt;
        setState({ ...initial, key, retry, value: payload });
        if (Number.isFinite(expiresAt)) refreshTimer = setTimeout(checkFreshness, Math.max(1, expiresAt - Date.now()));
      } catch (error) {
        if (request !== generation) return;
        hasSnapshot = false;
        const denied = error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403);
        const message = error instanceof Error ? error.message : '楼宇对比数据加载失败';
        if (denied) onDenied(message);
        setState({ ...initial, key, retry, error: message });
      }
    };
    function checkFreshness() {
      if (!hasSnapshot || Date.now() < expiresAt || document.visibilityState !== 'visible') return;
      setState(previous => ({ ...previous, refreshing: true }));
      if (navigator.onLine) void load();
    }
    const unsubscribe = subscribeCompareInvalidation(() => {
      expiresAt = 0;
      if (!hasSnapshot || document.visibilityState === 'visible') void load();
    });
    document.addEventListener('visibilitychange', checkFreshness);
    window.addEventListener('online', checkFreshness);
    void load();
    return () => {
      generation += 1;
      clearTimeout(refreshTimer);
      unsubscribe();
      document.removeEventListener('visibilitychange', checkFreshness);
      window.removeEventListener('online', checkFreshness);
    };
  }, [isSelection, key, retry, token, userId, role, targetUserId, onDenied]);

  if (!key) return initial;
  if (state.retry !== retry || state.key !== key) return { ...initial, key, retry, value: isSelection && state.retry === retry ? state.value : null, loading: true };
  return state;
}
