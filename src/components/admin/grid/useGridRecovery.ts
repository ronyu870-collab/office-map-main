'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getSession } from '@/src/services/Auth'
import type { GridRecord } from './recordModel'

export type RecordDraft = { kind: 'edit' | 'add'; dirty?: boolean; original: GridRecord; values: GridRecord }
export const GRID_DRAFT_PREFIX = '__admin_record_draft_v1:'

/** Tab-local recovery is isolated by authenticated user and table/filter/view context. */
export function useGridRecovery(scope: string, readDraft: () => RecordDraft | null) {
  const [recovery, setRecovery] = useState<{ scope: string; draft: RecordDraft } | null>(null)
  const [storageError, setStorageError] = useState(false)
  const storageKey = useRef<string | null>(null)
  const readRef = useRef(readDraft)
  useLayoutEffect(() => { readRef.current = readDraft }, [readDraft])
  const flush = useCallback(() => {
    const key = storageKey.current
    if (!key) return
    const draft = readRef.current()
    if (!draft) return
    try {
      if (draft.dirty === false) { sessionStorage.removeItem(key); setRecovery(null) }
      else sessionStorage.setItem(key, JSON.stringify(draft))
      setStorageError(false)
    }
    catch { setStorageError(true) }
  }, [])
  const clear = useCallback(() => {
    try { if (storageKey.current) sessionStorage.removeItem(storageKey.current) }
    catch { setStorageError(true) }
    setRecovery(null)
  }, [])
  useEffect(() => {
    let cancelled = false
    storageKey.current = null
    void getSession().then(session => {
      if (cancelled || !session?.user?.id) return
      const key = `${GRID_DRAFT_PREFIX}${session.user.id}:${scope}`
      storageKey.current = key
      try {
        const parsed = JSON.parse(sessionStorage.getItem(key) ?? 'null')
        if (parsed && ['add', 'edit'].includes(parsed.kind) && parsed.values && typeof parsed.values === 'object' && parsed.original && typeof parsed.original === 'object') setRecovery({ scope, draft: parsed })
      } catch { setStorageError(true) }
      flush()
    }).catch(() => { if (!cancelled) setStorageError(true) })
    return () => { flush(); cancelled = true; storageKey.current = null }
  }, [scope, flush])
  return { recovery: recovery?.scope === scope ? recovery.draft : null, clear, flush, storageError }
}
