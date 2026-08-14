'use client'

import { useIsDemo } from './DemoProvider'
import { MASK_STYLE } from '@/src/config/demoMode'

interface MaskedTextProps {
  children: string
  /** 打码后显示的占位文字，默认自动根据长度生成 */
  placeholder?: string
  /** 是否强制打码（忽略 demo 模式检查） */
  forceMask?: boolean
}

export function MaskedText({ children, placeholder, forceMask }: MaskedTextProps) {
  const isDemo = useIsDemo()
  const shouldMask = forceMask || isDemo

  if (!shouldMask) {
    return <span>{children}</span>
  }

  const displayText = placeholder || '■'.repeat(Math.min(children.length, 8))

  if (MASK_STYLE === 'blur') {
    return (
      <span
        style={{
          filter: 'blur(6px)',
          userSelect: 'none',
          cursor: 'default',
        }}
        title="演示模式，数据已脱敏"
      >
        {children}
      </span>
    )
  }

  if (MASK_STYLE === 'blackbar') {
    return (
      <span
        style={{
          backgroundColor: '#1a1a1a',
          color: 'transparent',
          borderRadius: '2px',
          padding: '0 4px',
          userSelect: 'none',
        }}
        title="演示模式，数据已脱敏"
      >
        {children}
      </span>
    )
  }

  // asterisk 模式
  return <span>{displayText}</span>
}
