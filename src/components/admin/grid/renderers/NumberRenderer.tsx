'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

interface NumberRendererParams {
  decimals?: number
  suffix?: string
  noThousandSeparator?: boolean
}

export function NumberRenderer(params: CustomCellRendererProps) {
  const raw = params.value
  if (raw === null || raw === undefined || raw === '') {
    return <span className="text-zinc-300 text-right block pr-4">-</span>
  }

  const num = Number(raw)
  if (isNaN(num)) return <span className="text-right block pr-4">{raw}</span>

  const { decimals, suffix, noThousandSeparator } = (params.colDef as any)?.cellRendererParams as NumberRendererParams ?? {}

  // 百分比列：值乘以 100 后显示
  const displayNum = suffix ? num * 100 : num

  let formatted: string

  if (noThousandSeparator) {
    formatted = decimals !== undefined ? displayNum.toFixed(decimals) : String(displayNum)
  } else {
    const fixed = decimals !== undefined ? displayNum.toFixed(decimals) : String(displayNum)
    const [intPart, decPart] = fixed.split('.')
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    formatted = decPart !== undefined ? `${withCommas}.${decPart}` : withCommas
  }

  if (suffix) {
    formatted = `${formatted}${suffix}`
  }

  return (
    <span className="tabular-nums text-right block pr-4 font-medium text-zinc-700">
      {formatted}
    </span>
  )
}
