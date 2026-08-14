'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

export function BooleanRenderer(params: CustomCellRendererProps) {
  const val = params.value
  if (val === null || val === undefined) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 text-zinc-300">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    )
  }
  return val ? (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100">
      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </span>
  ) : (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-zinc-100">
      <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  )
}
