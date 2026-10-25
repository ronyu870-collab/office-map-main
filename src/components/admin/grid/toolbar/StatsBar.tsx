'use client'
import React from 'react'

interface StatsBarProps {
  stats: { label: string; value: string }[]
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onClear: () => void
}

export function StatsBar({ stats, selectedCount, totalCount, onSelectAll, onClear }: StatsBarProps) {
  if (!stats) return null

  return (
    <div className="grid-stats-bar flex flex-wrap items-center gap-4 rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--cd-color-brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="text-sm font-semibold text-[var(--cd-color-brand)]">已选 {selectedCount} 项</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-[var(--cd-radius-sm)] px-2 py-1 text-xs font-medium text-[var(--cd-color-brand)] hover:bg-white/70"
            onClick={onSelectAll}
          >
            全选 ({totalCount})
          </button>
          <button
            className="rounded-[var(--cd-radius-sm)] px-2 py-1 text-xs font-medium text-[var(--cd-color-brand)] hover:bg-white/70"
            onClick={onClear}
          >
            清除
          </button>
        </div>
      </div>
      <div className="h-5 w-px bg-[color:rgb(0_62_126_/_0.18)]" />
      <div className="flex items-center gap-4 flex-wrap">
        {stats.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-[var(--cd-color-text-secondary)]">{s.label}:</span>
            <span className="text-sm font-semibold tabular-nums text-[var(--cd-color-text-primary)]">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
