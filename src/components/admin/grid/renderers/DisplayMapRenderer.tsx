'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

export function DisplayMapRenderer(params: CustomCellRendererProps) {
  const map = (params.colDef as any)?.cellRendererParams?.displayMap as Record<string, string> | undefined
  if (!map || params.value === null || params.value === undefined) {
    return <>{params.value ?? ''}</>
  }
  const label = map[String(params.value)]
  return <>{label ?? params.value}</>
}
