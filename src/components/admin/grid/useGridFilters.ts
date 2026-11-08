'use client'
import { useState, useMemo, useCallback } from 'react'
import type { TableConfig, DictBundle, ColDef } from '../types'

function getLookupValue(col: ColDef, row: Record<string, any>): any {
  return row[col.sourceKey ?? col.key]
}

/**
 * 搜索筛选 hook — 全局搜索 + 列筛选 + showInactive
 */
export function useGridFilters(
  rows: any[],
  config: TableConfig,
  dicts: DictBundle,
) {
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [showInactive, setShowInactive] = useState(false)

  const setColumnFilter = useCallback((colKey: string, value: string) => {
    setColumnFilters(prev => ({ ...prev, [colKey]: value }))
  }, [])

  const clearColumnFilter = useCallback((colKey: string) => {
    setColumnFilters(prev => {
      const next = { ...prev }
      delete next[colKey]
      return next
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setSearch('')
    setColumnFilters({})
  }, [])

  const filtered = useMemo(() => {
    let result = rows

    // 启用楼宇筛选
    if (config.showInactiveFilter && !showInactive && dicts.active_building_ids) {
      const buildingCol = config.cols.find(c => c.foreignKey === 'buildings')
      if (buildingCol) {
        result = result.filter(r => {
          const bid = r[buildingCol.sourceKey ?? buildingCol.key]
          return bid && dicts.active_building_ids![bid]
        })
      }
    }

    // 全局搜索
    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      result = result.filter(r =>
        config.cols.some(c => {
          const lookupVal = getLookupValue(c, r)
          const raw = String(lookupVal ?? '').toLowerCase()
          if (c.displayMap) {
            const label = (c.displayMap[String(lookupVal)] ?? '').toLowerCase()
            return raw.includes(kw) || label.includes(kw)
          }
          if (c.foreignKey && dicts[c.foreignKey]) {
            const name = (dicts[c.foreignKey][lookupVal] ?? '').toLowerCase()
            return raw.includes(kw) || name.includes(kw)
          }
          return raw.includes(kw)
        })
      )
    }

    // 列筛选
    for (const [colKey, filterValue] of Object.entries(columnFilters)) {
      if (!filterValue.trim()) continue
      const kw = filterValue.trim().toLowerCase()
      const col = config.cols.find(c => c.key === colKey)
      const exact = col?.exactFilter
      result = result.filter(r => {
        const lookupVal = col ? getLookupValue(col, r) : r[colKey]
        if (col?.displayMap) {
          const label = (col.displayMap[String(lookupVal)] ?? '').toLowerCase()
          return exact
            ? label === kw || String(lookupVal ?? '').toLowerCase() === kw
            : label.includes(kw) || String(lookupVal ?? '').toLowerCase().includes(kw)
        }
        if (col?.foreignKey && dicts[col.foreignKey]) {
          const name = (dicts[col.foreignKey][lookupVal] ?? '').toLowerCase()
          return exact ? name === kw : name.includes(kw)
        }
        return exact
          ? String(lookupVal ?? '').toLowerCase() === kw
          : String(lookupVal ?? '').toLowerCase().includes(kw)
      })
    }

    return result
  }, [rows, search, columnFilters, config.cols, config.showInactiveFilter, showInactive, dicts])


  return {
    search, setSearch,
    columnFilters, setColumnFilter, clearColumnFilter, clearAllFilters,
    showInactive, setShowInactive,
    filtered,
  }
}
