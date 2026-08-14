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
    <div className="flex items-center gap-4 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="text-sm font-semibold text-blue-700">已选 {selectedCount} 项</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded transition-colors"
            onClick={onSelectAll}
          >
            全选 ({totalCount})
          </button>
          <button
            className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded transition-colors"
            onClick={onClear}
          >
            清除
          </button>
        </div>
      </div>
      <div className="h-5 w-px bg-blue-200" />
      <div className="flex items-center gap-4 flex-wrap">
        {stats.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-blue-600">{s.label}:</span>
            <span className="text-sm font-bold text-blue-900 tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
