'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

/**
 * 脱敏渲染器 — demo 模式下模糊显示
 * 通过 params.context.isDemo 判断是否为 demo 用户
 */
export function MaskedRenderer(params: CustomCellRendererProps) {
  const isDemo = params.context?.isDemo as boolean
  const masked = (params.colDef as any)?.cellRendererParams?.masked as boolean

  if (isDemo && masked) {
    return (
      <span style={{
        filter: 'blur(5px)',
        userSelect: 'none',
        display: 'inline-block',
        minWidth: 60,
      }}>
        {params.value ?? ''}
      </span>
    )
  }

  return <>{params.value ?? ''}</>
}
