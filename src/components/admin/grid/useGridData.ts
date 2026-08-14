'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import type { TableConfig, DictBundle } from '../types'

/**
 * 数据获取 hook — 从 Supabase 分页加载数据
 * 使用 generation counter 防止快速切换表时的竞态条件
 */
export function useGridData(
  config: TableConfig,
  dicts: DictBundle,
  showToast: (msg: string, ok?: boolean) => void,
) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<string>(
    config.viewMode?.views[0]?.key ?? ''
  )
  const generationRef = useRef(0)

  const fetchRows = useCallback(async (forceRefresh = false) => {
    const gen = ++generationRef.current
    setLoading(true)

    // 自定义数据获取
    if (config.customFetch) {
      try {
        // 强制刷新：清除缓存后再拉取
        if (forceRefresh) {
          try { sessionStorage.removeItem('__project_ledger_cache_v3') } catch {}
        }
        const data = await config.customFetch(dicts)
        if (gen !== generationRef.current) return // 已过期
        setRows(data)
      } catch (e: any) {
        if (gen !== generationRef.current) return
        showToast(`读取失败: ${e.message}`, false)
      }
      if (gen === generationRef.current) setLoading(false)
      return
    }

    // 视图模式
    const activeView = config.viewMode?.views.find(v => v.key === viewMode)
    const tableName = activeView?.table ?? config.table

    // PostgREST 分页查询
    const PAGE = 1000
    let allData: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      if (gen !== generationRef.current) return // 已过期，停止加载
      const q = supabase.from(tableName).select('*').range(offset, offset + PAGE - 1)
      if (config.filterField && config.filterValue != null) {
        q.eq(config.filterField, config.filterValue)
      }
      if (config.orderBy) {
        if (Array.isArray(config.orderBy)) {
          for (const o of config.orderBy) q.order(o.col, { ascending: o.asc ?? false })
        } else {
          q.order(config.orderBy, { ascending: false })
        }
      }
      const { data, error } = await q
      if (gen !== generationRef.current) return // 已过期
      if (error) {
        showToast(`读取失败: ${error.message}`, false)
        hasMore = false
      } else {
        allData = allData.concat(data || [])
        if ((data || []).length < PAGE) hasMore = false
        else offset += PAGE
      }
    }

    if (gen === generationRef.current) {
      setRows(allData)
      setLoading(false)
      // 修改建筑数据后清除项目台账缓存（确保切换标签看到最新数据）
      if (tableName === 'building_metrics' || tableName === 'building_current_data') {
        try { sessionStorage.removeItem('__project_ledger_cache_v3') } catch {}
      }
    }
  }, [config.table, config.orderBy, viewMode, config.viewMode, config.customFetch, config.filterField, config.filterValue, dicts, showToast])

  useEffect(() => { fetchRows() }, [fetchRows])

  return { rows, setRows, loading, fetchRows, viewMode, setViewMode }
}
