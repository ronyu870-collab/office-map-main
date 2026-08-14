'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

export function JsonbRenderer(params: CustomCellRendererProps) {
  if (!params.value) return <span className="text-zinc-300">-</span>

  const str = typeof params.value === 'string'
    ? params.value
    : JSON.stringify(params.value)

  const truncated = str.length > 80 ? str.slice(0, 80) + '...' : str

  return (
    <span
      className="font-mono text-xs text-zinc-500"
      title={str}
    >
      {truncated}
    </span>
  )
}
