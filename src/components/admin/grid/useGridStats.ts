'use client'
import { useState, useMemo, useCallback } from 'react'
import type { TableConfig } from '../types'

/**
 * 统计模式 hook — 选中行的求和/加权平均/派生指标
 */
export function useGridStats(config: TableConfig, filtered: any[]) {
  const [statsEnabled, setStatsEnabled] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleStats = useCallback(() => {
    setStatsEnabled(prev => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map(r => r.id)))
  }, [filtered])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const stats = useMemo(() => {
    if (!statsEnabled || !config.statsMode || selectedIds.size === 0) return null
    const selected = filtered.filter(r => selectedIds.has(r.id))
    if (selected.length === 0) return null

    const result: { label: string; value: string }[] = []
    const sums: Record<string, number> = {}

    // 求和列
    for (const colKey of config.statsMode.sumCols) {
      const col = config.cols.find(c => c.key === colKey)
      if (!col) continue
      const sum = selected.reduce((acc, r) => {
        const v = Number(r[colKey])
        return acc + (isNaN(v) ? 0 : v)
      }, 0)
      sums[colKey] = sum
      result.push({
        label: col.label,
        value: col.decimals != null ? sum.toFixed(col.decimals) : sum.toLocaleString(),
      })
    }

    // 加权平均列
    for (const { valueCol, weightCol, label } of config.statsMode.weightedAvgCols) {
      let totalWeight = 0
      let weightedSum = 0
      for (const r of selected) {
        const val = Number(r[valueCol])
        const weight = Number(r[weightCol])
        if (!isNaN(val) && !isNaN(weight) && weight > 0) {
          weightedSum += val * weight
          totalWeight += weight
        }
      }
      const avg = totalWeight > 0 ? weightedSum / totalWeight : 0
      result.push({ label, value: avg.toFixed(1) })
    }

    // 派生指标
    if (config.statsMode.derivedCols) {
      for (const d of config.statsMode.derivedCols) {
        const val = d.formula(sums)
        const formatted = d.decimals != null ? val.toFixed(d.decimals) : val.toLocaleString()
        result.push({ label: d.label, value: d.suffix ? formatted + d.suffix : formatted })
      }
    }

    return result
  }, [statsEnabled, config.statsMode, selectedIds, filtered, config.cols])

  return {
    statsEnabled, toggleStats,
    selectedIds, setSelectedIds,
    selectAll, clearSelection, toggleRow,
    stats,
  }
}
