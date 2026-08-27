'use client'

import * as React from 'react'
import { useIsDemo } from './DemoProvider'
import { Button, Dialog } from '@/src/components/ui'

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

  return (
    <Dialog
      open={isDemo && open}
      onOpenChange={(nextOpen) => { if (!nextOpen) handleDismiss(); }}
      title="演示模式"
      description="当前为演示环境，部分敏感数据已做脱敏处理，仅供系统功能展示使用。"
      size="sm"
      footer={<Button onClick={handleDismiss}>我知道了</Button>}
    >
      <span className="sr-only">演示环境说明</span>
    </Dialog>
  )
}
