'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Guard = () => Promise<boolean>
const Context = createContext<{ register: (key: symbol, guard: Guard) => () => void; requestNavigation: (action: () => void) => Promise<void> }>({
  register: () => () => {},
  requestNavigation: async (action: () => void) => { action() },
})

/** Only registered editing sessions participate; cached, hidden tables keep their own session. */
export function AdminEditProtection({ children }: { children: React.ReactNode }) {
  const guards = useRef(new Map<symbol, Guard>())
  const navigating = useRef(false)
  const router = useRouter()
  const register = useCallback((key: symbol, guard: Guard) => {
    guards.current.set(key, guard)
    return () => { guards.current.delete(key) }
  }, [])
  const requestNavigation = useCallback(async (action: () => void) => {
    if (navigating.current) return
    navigating.current = true
    try {
      for (const guard of guards.current.values()) if (!await guard()) return
      action()
    } finally { navigating.current = false }
  }, [])
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, location.href)
      if (url.origin !== location.origin || url.href === location.href || url.hash && url.pathname === location.pathname && url.search === location.search) return
      if (!guards.current.size) return
      event.preventDefault(); event.stopPropagation()
      void requestNavigation(() => router.push(url.pathname + url.search + url.hash))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [requestNavigation, router])
  return <Context.Provider value={{ register, requestNavigation }}>{children}</Context.Provider>
}
export const useAdminEditProtection = () => useContext(Context)
