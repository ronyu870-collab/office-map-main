'use client'

import { useIsDemo } from './DemoProvider'

interface MaskedCellProps {
  children: React.ReactNode
  /** 是否对该列打码 */
  masked?: boolean
}

/**
 * 表格单元格脱敏
 * 用法：在表格列渲染时包裹需要打码的字段
 *
 * <td><MaskedCell masked>{row.company_name}</MaskedCell></td>
 * <td><MaskedCell>{row.rent}</MaskedCell></td>  ← 不打码
 */
export function MaskedCell({ children, masked = false }: MaskedCellProps) {
  const isDemo = useIsDemo()

  if (!isDemo || !masked) {
    return <>{children}</>
  }

  return (
    <span
      style={{
        filter: 'blur(5px)',
        userSelect: 'none',
        display: 'inline-block',
        minWidth: '60px',
      }}
    >
      {children}
    </span>
  )
}
