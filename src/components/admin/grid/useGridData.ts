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
  const [rows, rawSetRows] = useState<any[]>([])
  const rowsRef = useRef<any[]>([])
  const setRows = useCallback((next: React.SetStateAction<any[]>) => {
    rowsRef.current = typeof next === 'function' ? next(rowsRef.current) : next
    rawSetRows(rowsRef.current)
  }, [])
  const getLatestRows = useCallback(() => rowsRef.current, [])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<string>(
    config.viewMode?.views[0]?.key ?? ''
  )
  const generationRef = useRef(0)

  const [loadError, setLoadError] = useState('')
  const fetchRows = useCallback(async (forceRefresh = false): Promise<boolean> => {
    const gen = ++generationRef.current
    setLoading(true); setLoadError('')
    try {
      if (config.customFetch) {
        if (forceRefresh) {
          try { sessionStorage.removeItem('__project_ledger_cache_v4') } catch {}
        }
        const data = await config.customFetch(dicts)
        if (gen !== generationRef.current) return false
        setRows(data)
        return true
      }
      const tableName = config.viewMode?.views.find(v => v.key === viewMode)?.table ?? config.table
      const PAGE = 1000
      let allData: any[] = []
      const selectFields = tableName === config.table ? config.readColumns ?? '*' : '*'
      for (let offset = 0; ; offset += PAGE) {
        if (gen !== generationRef.current) return false
        const query = supabase.from(tableName).select(selectFields).range(offset, offset + PAGE - 1)
        if (tableName === 'buildings') query.is('merged_into_id', null)
        if (config.filterField && config.filterValue != null) query.eq(config.filterField, config.filterValue)
        if (Array.isArray(config.orderBy)) {
          for (const order of config.orderBy) query.order(order.col, { ascending: order.asc ?? false })
        } else if (config.orderBy) query.order(config.orderBy, { ascending: false })
        const sortFields = Array.isArray(config.orderBy)
          ? config.orderBy.map(order => order.col)
          : config.orderBy ? [config.orderBy] : []
        if (tableName === config.table && config.readOrderTieBreaker &&
          !sortFields.includes(config.readOrderTieBreaker)) {
          query.order(config.readOrderTieBreaker, { ascending: true })
        }
        const { data, error } = await query
        if (gen !== generationRef.current) return false
        if (error) throw error
        allData = allData.concat(data ?? [])
        if ((data ?? []).length < PAGE) break
      }
      setRows(allData)
      if (tableName === 'building_metrics' || tableName === 'building_current_data') {
        try { sessionStorage.removeItem('__project_ledger_cache_v4') } catch {}
      }
      return true
    } catch (error) {
      if (gen === generationRef.current) {
        const message = String((error as any)?.message ?? '请求失败')
        setLoadError(message); showToast(`读取失败: ${message}`, false)
      }
      return false
    } finally {
      if (gen === generationRef.current) setLoading(false)
    }
  }, [config, viewMode, dicts, showToast, setRows])

  useEffect(() => { void fetchRows(); return () => { generationRef.current++ } }, [fetchRows])

  return { rows, setRows, getLatestRows, loading, loadError, fetchRows, viewMode, setViewMode }
}
