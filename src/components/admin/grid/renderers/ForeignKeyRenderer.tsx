'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

/**
 * 外键渲染器 — 将 UUID 解析为可读名称
 * 通过 params.context.dicts 获取字典
 */
export function ForeignKeyRenderer(params: CustomCellRendererProps) {
  const fk = (params.colDef as any)?.cellRendererParams?.foreignKey as string | undefined
  const masked = (params.colDef as any)?.cellRendererParams?.masked as boolean

  if (!params.value) return <span className="text-zinc-300">-</span>

  const dicts = params.context?.dicts
  let displayValue = params.value

  if (fk && dicts?.[fk]) {
    displayValue = dicts[fk][params.value] ?? params.value
  }

  // UUID fallback: 截断显示
  if (typeof displayValue === 'string' && displayValue.match(/^[0-9a-f]{8}-/)) {
    displayValue = displayValue.slice(0, 8) + '...'
  }

  // 脱敏
  const isDemo = params.context?.isDemo as boolean
  if (isDemo && masked) {
    return (
      <span className="inline-block min-w-[60px]" style={{
        filter: 'blur(5px)',
        userSelect: 'none',
      }}>
        {displayValue}
      </span>
    )
  }

  return <span className="text-zinc-700">{displayValue}</span>
}
