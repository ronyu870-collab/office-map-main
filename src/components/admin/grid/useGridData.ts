'use client'
import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { getGridReadPlan } from './gridReadPlan'
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [viewMode, setViewMode] = useState<string>(
    config.viewMode?.views[0]?.key ?? ''
  )
  const generationRef = useRef(0)

  const [loadError, setLoadError] = useState('')
  const fetchRows = useCallback(async (forceRefresh = false): Promise<boolean> => {
    const gen = ++generationRef.current
    const previousCompleteRows = rowsRef.current
    let firstBatchDisplayed = false
    setLoading(true)
    setLoadingMore(false)
    setLoadError('')
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
      const readPlan = tableName === config.table ? getGridReadPlan(tableName) : null
      const selectFields = readPlan?.columns ?? '*'
      // Show the first page immediately. Subsequent batches hydrate the same
      // table incrementally without waiting for the last network round trip.
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
        if (readPlan?.tieBreaker && !sortFields.includes(readPlan.tieBreaker)) {
          query.order(readPlan.tieBreaker, { ascending: true })
        }
        const { data, error } = await query
        if (gen !== generationRef.current) return false
        if (error) throw error
        const page = data ?? []
        if (!firstBatchDisplayed) {
          setRows(page)
          firstBatchDisplayed = true
          setLoading(false)
        } else if (page.length > 0) {
          // Keep any edits made to previously delivered rows rather than
          // replacing the full grid when the next read completes.
          setRows(current => [...current, ...page])
        }
        if (page.length < PAGE) break
        setLoadingMore(true)
      }
      if (tableName === 'building_metrics' || tableName === 'building_current_data') {
        try { sessionStorage.removeItem('__project_ledger_cache_v4') } catch {}
      }
      return true
    } catch (error) {
      if (gen === generationRef.current) {
        // Never publish an incomplete refresh as the final authoritative table.
        if (firstBatchDisplayed) setRows(previousCompleteRows)
        const message = String((error as any)?.message ?? '请求失败')
        setLoadError(message)
        showToast(`读取失败: ${message}`, false)
      }
      return false
    } finally {
      if (gen === generationRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [config, viewMode, dicts, showToast, setRows])

  useEffect(() => { void fetchRows(); return () => { generationRef.current++ } }, [fetchRows])

  return { rows, setRows, getLatestRows, loading, loadingMore, loadError, fetchRows, viewMode, setViewMode }
}
