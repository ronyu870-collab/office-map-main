'use client'

import * as React from 'react'
import { useIsDemo } from './DemoProvider'

export function DemoBanner() {
  const isDemo = useIsDemo()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!isDemo) return
    const key = '__demo_banner_dismissed'
    if (!sessionStorage.getItem(key)) {
      setOpen(true)
    }
  }, [isDemo])

  const handleDismiss = () => {
    setOpen(false)
    sessionStorage.setItem('__demo_banner_dismissed', '1')
  }

  if (!isDemo || !open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-zinc-200/60 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-zinc-900">演示模式</h3>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          当前为演示环境，部分敏感数据已做脱敏处理，仅供系统功能展示使用。
        </p>
        <button
          onClick={handleDismiss}
          className="mt-5 w-full rounded-lg bg-[#003e7e] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#002b5e]"
        >
          我知道了
        </button>
      </div>
    </div>
  )
}
