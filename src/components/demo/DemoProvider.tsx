'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSessionFast } from '@/src/services/Auth'
import { DEMO_ACCOUNTS } from '@/src/config/demoMode'

interface DemoContextValue {
  isDemo: boolean
}

const DemoContext = createContext<DemoContextValue>({ isDemo: false })

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const session = await getSessionFast()
        if (!cancelled && session?.user?.email) {
          setEmail(session.user.email)
        }
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [])

  const isDemo = useMemo(() => {
    if (!email) return false
    return DEMO_ACCOUNTS.includes(email.toLowerCase())
  }, [email])

  return (
    <DemoContext.Provider value={{ isDemo }}>
      {children}
    </DemoContext.Provider>
  )
}

export function useIsDemo() {
  return useContext(DemoContext).isDemo
}
