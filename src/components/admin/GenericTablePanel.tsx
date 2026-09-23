'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/src/services/supabaseClient'
import { logAction } from '@/src/utils/audit'
import { getSession } from '@/src/services/Auth'
import { MaskedCell } from '@/src/components/demo'
import * as XLSX from 'xlsx'
import type { TableConfig, ColDef, DictBundle, SpecialAction } from './types'
import { DataDiagnosticModal } from './DataDiagnosticModal'
import { TagInput } from '@/src/components/admin-memo/TagInput'
import { UploadGuideModal } from './grid/modals/UploadGuideModal'
import { ImportErrorsModal } from './grid/modals/ImportErrorsModal'
import { parseUploadCellValue } from './uploadValueParser'
import { Button, Dialog, EmptyState, LoadingState } from '@/src/components/ui'

// ─── 可搜索下拉组件（Portal渲染）──────────────────────────────────────────────
function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '-- 选择 --',
  className = '',
}: {
  value: string
  onChange: (val: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
}) {
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0, width: 0 })
  const inputRef = React.useRef<HTMLInputElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const updatePos = React.useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width })
  }, [])

  const openDropdown = React.useCallback(() => {
    setQuery('')
    setOpen(true)
    updatePos()
  }, [updatePos])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (inputRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const reposition = () => updatePos()
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, updatePos])

  const dropdown =
    open && filtered.length > 0
      ? createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 99999,
            }}
            className="max-h-52 overflow-auto rounded border border-zinc-200 bg-white shadow-lg"
          >
            {filtered.map((o) => (
              <div
                key={o.value}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(o.value)
                  setOpen(false)
                }}
                className={`cursor-pointer px-2 py-1.5 text-xs hover:bg-blue-50 ${
                  o.value === value ? 'bg-blue-100 font-medium' : ''
                }`}
              >
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
          updatePos()
        }}
        onFocus={openDropdown}
        placeholder={placeholder}
        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs outline-none focus:border-[#003e7e]"
      />
      {dropdown}
    </div>
  )
}

// ─── 筛选下拉组合框 ──────────────────────────────────────────────────────────

function FilterCombo({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (val: string) => void
  options: string[]
}) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState({ top: 0, left: 0, width: 0 })
  const btnRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)

  const filtered = value
    ? options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
    : options

  const updatePos = React.useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 160) })
  }, [])

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const reposition = () => updatePos()
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, updatePos])

  const dropdown =
    open && filtered.length > 0
      ? createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999 }}
            className="max-h-52 overflow-auto rounded border border-zinc-200 bg-white shadow-lg"
          >
            {filtered.map(o => (
              <div
                key={o}
                onMouseDown={e => {
                  e.preventDefault()
                  onChange(o)
                  setOpen(false)
                }}
                className={`cursor-pointer px-2 py-1.5 text-xs hover:bg-blue-50 ${o === value ? 'bg-blue-100 font-medium' : ''}`}
              >
                {o}
              </div>
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={btnRef} className="relative">
      <input
        type="text"
        placeholder="筛选"
        value={value}
        onChange={e => { onChange(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); updatePos() }}
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-[#003e7e] focus:ring-1 focus:ring-[#003e7e]/20"
      />
      {value && (
        <button
          onClick={() => { onChange(''); setOpen(false) }}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
          title="清除"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      )}
      {dropdown}
    </div>
  )
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function emptyRow(cols: ColDef[]): Record<string, any> {
  const row: Record<string, any> = {}
  for (const c of cols) {
    if (!c.readOnly) row[c.key] = ''
  }
  return row
}

function resolveDictValue(key: string, value: any, dicts: DictBundle, col: ColDef): string {
  if (col.displayMap) {
    return col.displayMap[String(value)] ?? String(value ?? '-')
  }
  if (col.foreignKey && dicts[col.foreignKey]) {
    return dicts[col.foreignKey][value] ?? String(value ?? '-')
  }
  return String(value ?? '-')
}

/** 获取列的字典查找值：优先 sourceKey（虚拟列），否则用 key */
function getLookupValue(col: ColDef, row: Record<string, any>): any {
  return row[col.sourceKey ?? col.key]
}

function buildRowContext(row: Record<string, any>, cols: ColDef[], dicts: DictBundle): Record<string, any> {
  const ctx: Record<string, any> = {}
  for (const col of cols) {
    if (col.hidden || col.sourceKey || !row[col.key]) continue
    if (col.foreignKey && dicts[col.foreignKey]) {
      ctx[col.key] = row[col.key]
      ctx[`${col.key}_name`] = dicts[col.foreignKey][row[col.key]] ?? '(未知)'
    } else if (row[col.key] != null && row[col.key] !== '') {
      ctx[col.key] = row[col.key]
    }
  }
  return ctx
}

// ─── 组件 ────────────────────────────────────────────────────────────────────

interface GenericTablePanelProps {
  config: TableConfig
  dicts?: DictBundle
}

export function GenericTablePanel({ config, dicts = {} }: GenericTablePanelProps) {
  const [rows, setRows] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editBuf, setEditBuf] = React.useState<Record<string, any>>({})
  const [adding, setAdding] = React.useState(false)
  const [newRow, setNewRow] = React.useState<Record<string, any>>({})
  const [saving, setSaving] = React.useState(false)
  const [toast, setToast] = React.useState<{ msg: string; ok: boolean } | null>(null)
  const [search, setSearch] = React.useState('')
  const [columnFilters, setColumnFilters] = React.useState<Record<string, string>>({})
  const [page, setPage] = React.useState(0)
  const [showInactive, setShowInactive] = React.useState(false)
  const [statsEnabled, setStatsEnabled] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())

  // 切换表时清空筛选条件，避免跨表筛选污染
  React.useEffect(() => {
    setSearch('')
    setColumnFilters({})
    setPage(0)
    setShowInactive(false)
    setStatsEnabled(false)
    setSelectedIds(new Set())
  }, [config.table])
  const PAGE_SIZE = 50
  const [uploading, setUploading] = React.useState(false)
  const [importErrors, setImportErrors] = React.useState<string[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // 视图模式
  const [viewMode, setViewMode] = React.useState<string>(
    config.viewMode?.views[0]?.key ?? 'default'
  )

  // 历史弹窗
  const [historyModalOpen, setHistoryModalOpen] = React.useState(false)
  const [historyData, setHistoryData] = React.useState<any[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [selectedRowForHistory, setSelectedRowForHistory] = React.useState<any>(null)

  // 特殊操作加载状态
  const [actionLoading, setActionLoading] = React.useState<string | null>(null)

  // 数据库说明弹窗
  const [diagOpen, setDiagOpen] = React.useState(false)
  // 上传说明弹窗
  const [uploadGuideOpen, setUploadGuideOpen] = React.useState(false)

  // 滚动同步
  const topScrollRef = React.useRef<HTMLDivElement>(null)
  const tableScrollRef = React.useRef<HTMLDivElement>(null)
  const [tableScrollWidth, setTableScrollWidth] = React.useState(0)
  const [isScrollable, setIsScrollable] = React.useState(false)
  const syncingRef = React.useRef(false)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ─── 数据获取 ──────────────────────────────────────────────────────────────

  const fetchRows = React.useCallback(async () => {
    setLoading(true)

    // 自定义数据获取（如合并多表）
    if (config.customFetch) {
      try {
        const data = await config.customFetch(dicts)
        setRows(data)
      } catch (e: any) {
        showToast(`读取失败: ${e.message}`, false)
      }
      setLoading(false)
      return
    }

    // 视图模式：使用配置中指定的表名
    const activeView = config.viewMode?.views.find(v => v.key === viewMode)
    const tableName = activeView?.table ?? config.table

    // PostgREST 默认最多返回 1000 条，需要分页查询
    const PAGE = 1000
    let allData: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
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
      if (error) {
        showToast(`读取失败: ${error.message}`, false)
        hasMore = false
      } else {
        allData = allData.concat(data || [])
        if ((data || []).length < PAGE) hasMore = false
        else offset += PAGE
      }
    }

    setRows(allData)
    setLoading(false)
  }, [config.table, config.orderBy, viewMode, config.viewMode, config.customFetch, config.filterField, config.filterValue, dicts])

  React.useEffect(() => { fetchRows() }, [fetchRows])

  // ─── 历史查询 ──────────────────────────────────────────────────────────────

  const fetchHistory = async (buildingId: string, year: number, quarter: number) => {
    setHistoryLoading(true)
    setHistoryModalOpen(true)
    const { data, error } = await supabase
      .from('quarterly_submissions')
      .select('*')
      .eq('building_id', buildingId)
      .eq('record_year', year)
      .eq('record_quarter', quarter)
      .order('created_at', { ascending: false })

    if (error) {
      showToast(`查询历史失败: ${error.message}`, false)
      setHistoryData([])
    } else {
      setHistoryData(data || [])
    }
    setHistoryLoading(false)
  }

  const closeHistoryModal = () => {
    setHistoryModalOpen(false)
    setHistoryData([])
    setSelectedRowForHistory(null)
  }

  // ─── 搜索过滤 ──────────────────────────────────────────────────────────────

  const filtered = React.useMemo(() => {
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

  // 为每列计算筛选下拉选项（从全量 rows 中提取唯一显示值）
  const filterOptions = React.useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const col of config.cols) {
      if (col.hidden) continue
      const vals = new Set<string>()
      for (const r of rows) {
        const lookupVal = getLookupValue(col, r)
        let display: string
        if (col.displayMap) {
          display = col.displayMap[String(lookupVal)] ?? String(lookupVal ?? '')
        } else if (col.foreignKey && dicts[col.foreignKey]) {
          const resolved = dicts[col.foreignKey][lookupVal]
          if (!resolved) continue // 字典无映射则跳过，避免显示原始 UUID
          display = resolved
        } else if (col.type === 'number' && lookupVal != null) {
          const num = Number(lookupVal)
          if (col.suffix) {
            display = (num * 100).toLocaleString('zh-CN', {
              minimumFractionDigits: col.decimals ?? 0,
              maximumFractionDigits: col.decimals ?? 0,
            }) + col.suffix
          } else if (col.decimals != null) {
            display = num.toLocaleString('zh-CN', { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals })
          } else {
            display = Number.isInteger(num) ? num.toLocaleString('zh-CN') : num.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
          }
        } else {
          display = String(lookupVal ?? '')
        }
        if (display) vals.add(display)
      }
      map[col.key] = [...vals].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    }
    return map
  }, [rows, config.cols, dicts])

  // ─── 统计模式 ──────────────────────────────────────────────────────────────

  const stats = React.useMemo(() => {
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
      result.push({ label: col.label, value: col.decimals != null ? sum.toFixed(col.decimals) : sum.toLocaleString() })
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

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  React.useEffect(() => {
    if (page > 0 && page >= totalPages) {
      setPage(Math.max(0, totalPages - 1))
    }
  }, [totalPages, page])

  // ─── 滚动同步 ──────────────────────────────────────────────────────────────

  const handleTopScroll = () => {
    if (syncingRef.current || !tableScrollRef.current || !topScrollRef.current) return
    syncingRef.current = true
    tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft
    requestAnimationFrame(() => { syncingRef.current = false })
  }

  const handleTableScroll = () => {
    if (syncingRef.current || !tableScrollRef.current || !topScrollRef.current) return
    syncingRef.current = true
    topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft
    requestAnimationFrame(() => { syncingRef.current = false })
  }

  React.useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const update = () => {
      setTableScrollWidth(el.scrollWidth)
      setIsScrollable(el.scrollWidth > el.clientWidth)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [rows])

  // ─── 审计日志辅助 ──────────────────────────────────────────────────────────

  const colLabels = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of config.cols) map[c.key] = c.label
    return map
  }, [config.cols])

  // ─── 编辑 ──────────────────────────────────────────────────────────────────

  const startEdit = (row: any) => {
    setEditingId(row.id)
    setEditBuf({ ...row })
    setAdding(false)
  }

  const cancelEdit = () => { setEditingId(null); setEditBuf({}) }

  const saveEdit = async () => {
    setSaving(true)
    let payload: Record<string, any> = {}
    for (const c of config.cols) {
      if (c.readOnly) continue
      if (c.type === 'number') {
        payload[c.key] = editBuf[c.key] === '' || editBuf[c.key] == null ? null : Number(editBuf[c.key])
      } else if (c.type === 'boolean') {
        payload[c.key] = editBuf[c.key] === true || editBuf[c.key] === 'true'
      } else if (c.type === 'jsonb') {
        try { payload[c.key] = editBuf[c.key] ? JSON.parse(editBuf[c.key]) : null }
        catch { showToast(`${c.label} JSON 格式错误`, false); setSaving(false); return }
      } else {
        payload[c.key] = editBuf[c.key]
      }
    }

    if (config.beforeSave) payload = config.beforeSave(payload, dicts)

    const currentRow = rows.find(r => r.id === editingId) ?? {}
    const isVirtual = currentRow._virtual === true

    let error: any
    if (isVirtual) {
      // 虚拟行（如未分配楼宇）→ INSERT
      delete payload.id
      const res = await supabase.from(config.table).insert(payload).select()
      error = res.error
      if (!error) {
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'INSERT', table: config.table, table_label: config.label,
          target_id: res.data?.[0]?.id ?? 'unknown',
          context: buildRowContext({ ...currentRow, ...payload }, config.cols, dicts),
          changes: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, { from: null, to: v }])),
          col_labels: colLabels,
        })
      }
    } else {
      const res = await supabase.from(config.table).update(payload).eq('id', editingId!).select()
      error = res.error
      if (!error && (!res.data || res.data.length === 0)) {
        error = { message: '未匹配到任何行（可能被 RLS 策略拒绝，或记录不存在）' }
      }
      if (!error) {
        const changes: Record<string, { from: any; to: any }> = {}
        for (const key of Object.keys(payload)) {
          if (String(currentRow[key] ?? '') !== String(payload[key] ?? '')) {
            changes[key] = { from: currentRow[key] ?? null, to: payload[key] ?? null }
          }
        }
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'UPDATE', table: config.table, table_label: config.label,
          target_id: editingId, context: buildRowContext({ ...currentRow, ...payload }, config.cols, dicts),
          changes, col_labels: colLabels,
        })
      }
    }

    if (error) { showToast(`保存失败: ${error.message}`, false) }
    else {
      showToast(isVirtual ? '新增成功' : '保存成功')
      cancelEdit()
      await fetchRows()
    }
    setSaving(false)
  }

  // ─── 新增 ──────────────────────────────────────────────────────────────────

  const startAdd = () => { setAdding(true); setNewRow(emptyRow(config.cols)); setEditingId(null) }
  const cancelAdd = () => { setAdding(false); setNewRow({}) }

  const saveAdd = async () => {
    setSaving(true)
    let payload: Record<string, any> = {}
    for (const c of config.cols) {
      if (c.readOnly) continue
      if (c.type === 'number') {
        payload[c.key] = newRow[c.key] === '' || newRow[c.key] == null ? null : Number(newRow[c.key])
      } else if (c.type === 'boolean') {
        payload[c.key] = newRow[c.key] === true || newRow[c.key] === 'true'
      } else if (c.type === 'jsonb') {
        try { payload[c.key] = newRow[c.key] ? JSON.parse(newRow[c.key]) : null }
        catch { showToast(`${c.label} JSON 格式错误`, false); setSaving(false); return }
      } else {
        payload[c.key] = newRow[c.key]
      }
    }

    // 必填校验
    for (const c of config.cols) {
      if (c.required && !c.readOnly && (payload[c.key] === undefined || payload[c.key] === null || payload[c.key] === '')) {
        showToast(`${c.label} 为必填项`, false)
        setSaving(false)
        return
      }
    }

    if (config.beforeSave) payload = config.beforeSave(payload, dicts)

    // 自定义新增逻辑（如创建 Auth 账号）
    if (config.customSaveAdd) {
      const result = await config.customSaveAdd(payload, dicts)
      if (result.success) {
        showToast(result.message)
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        const insertChanges: Record<string, { from: any; to: any }> = {}
        for (const [key, val] of Object.entries(payload)) {
          if (val !== null && val !== undefined && val !== '') {
            insertChanges[key] = { from: null, to: val }
          }
        }
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'INSERT', table: config.table, table_label: config.label,
          target_id: result.targetId ?? 'unknown',
          context: buildRowContext(payload, config.cols, dicts),
          changes: insertChanges, col_labels: colLabels,
        })
        cancelAdd()
        await fetchRows()
      } else {
        showToast(result.message, false)
      }
      setSaving(false)
      return
    }

    const { data, error } = await supabase.from(config.table).insert(payload).select()
    if (error) { showToast(`新增失败: ${error.message}`, false) }
    else {
      showToast('新增成功')
      const session = await getSession()
      const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
      const insertChanges: Record<string, { from: any; to: any }> = {}
      for (const [key, val] of Object.entries(payload)) {
        if (val !== null && val !== undefined && val !== '') {
          insertChanges[key] = { from: null, to: val }
        }
      }
      logAction(userId, 'ADMIN_DATA_OPERATION', {
        operation: 'INSERT', table: config.table, table_label: config.label,
        target_id: data?.[0]?.id ?? 'unknown',
        context: buildRowContext(data?.[0] ?? payload, config.cols, dicts),
        changes: insertChanges, col_labels: colLabels,
      })
      cancelAdd()
      await fetchRows()
    }
    setSaving(false)
  }

  // ─── 删除 ──────────────────────────────────────────────────────────────────

  const deleteRow = async (id: string, name?: string) => {
    const virtualRow = rows.find(r => r.id === id && r._virtual)
    if (virtualRow) { showToast('未分配的楼宇无需删除', false); return }
    if (!confirm(`确认删除「${name || id}」？此操作不可撤销。`)) return
    const originalRow = rows.find(r => r.id === id)
    const { data, error } = await supabase.from(config.table).delete().eq('id', id).select()
    if (error) { showToast(`删除失败: ${error.message}`, false) }
    else if (!data || data.length === 0) {
      showToast('删除失败：未找到匹配的记录或权限不足', false)
    } else {
      showToast('已删除')
      const session = await getSession()
      const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
      const deleteChanges: Record<string, { from: any; to: any }> = {}
      if (originalRow) {
        for (const [key, val] of Object.entries(originalRow)) {
          if (val !== null && val !== undefined && val !== '' && key !== 'id') {
            deleteChanges[key] = { from: val, to: null }
          }
        }
      }
      logAction(userId, 'ADMIN_DATA_OPERATION', {
        operation: 'DELETE', table: config.table, table_label: config.label,
        target_id: id, context: buildRowContext(originalRow ?? { id }, config.cols, dicts),
        changes: deleteChanges, col_labels: colLabels,
      })
      await fetchRows()
    }
  }

  // ─── 特殊操作处理 ──────────────────────────────────────────────────────────

  const handleSpecialAction = async (action: SpecialAction, row: any) => {
    const actionKey = `${action.key}-${row.id}`
    setActionLoading(actionKey)
    try {
      await action.handler(row, { fetchRows, showToast, dicts })
    } catch (e: any) {
      showToast(`操作失败: ${e.message}`, false)
    }
    setActionLoading(null)
  }

  // ─── XLSX 导入 ──────────────────────────────────────────────────────────────

  const writableCols = config.cols.filter(c => !c.readOnly)

  const downloadTemplate = () => {
    const visibleWritable = writableCols.filter(c => !c.hidden)
    const header = visibleWritable.map(c => c.label)

    const instructions = visibleWritable.map(col => {
      const parts: string[] = []
      if (config.uploadMatchKeys?.includes(col.key)) {
        parts.push('匹配键，必填')
      } else if (col.required) {
        parts.push('必填')
      }
      if (col.foreignKey && dicts[col.foreignKey]) {
        parts.push('填写名称，系统自动匹配')
      } else if (col.displayMap) {
        parts.push(`填写：${Object.values(col.displayMap).join('/')}`)
      } else if (col.type === 'boolean') {
        parts.push('填写：是 或 否；更新时留空保留原值')
      } else if (col.type === 'number') {
        parts.push('填写数字；更新时留空保留原值')
      } else if (col.type === 'date') {
        parts.push('格式：YYYY-MM-DD；更新时留空保留原值')
      } else if (col.type === 'jsonb') {
        parts.push('填写JSON格式')
      } else if (col.type === 'textarea') {
        parts.push('文本；更新时留空保留原值')
      } else {
        parts.push('文本；更新时留空保留原值')
      }
      return parts.join('；')
    })

    const ws = XLSX.utils.aoa_to_sheet([header, instructions])
    ws['!cols'] = visibleWritable.map(() => ({ wch: 22 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '上传数据')
    const filename = `${config.label}_上传模板.xlsx`
    XLSX.writeFile(wb, filename)
    logAction(undefined, 'EXPORT_DATA', {
      export_type: 'upload_template',
      table: config.table,
      table_label: config.label,
      file_name: filename,
      target_name: filename,
    })
  }

  const triggerUpload = () => { setImportErrors([]); fileInputRef.current?.click() }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as unknown[][]
        processWorkbook(rows)
      } catch (err: any) {
        showToast(`XLSX 文件解析失败：${err.message}`, false)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function cellToString(cell: unknown): string {
    if (cell === null || cell === undefined) return ''
    if (typeof cell === 'number') return String(cell)
    if (typeof cell === 'boolean') return cell ? '是' : '否'
    if (cell instanceof Date) return cell.toISOString().slice(0, 10)
    return String(cell).trim()
  }

  const processWorkbook = async (rows: unknown[][]) => {
    const nonEmptyRows = rows.filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''))
    if (nonEmptyRows.length < 2) { showToast('XLSX 文件为空或只有表头', false); return }

    const visibleWritable = writableCols.filter(c => !c.hidden)
    const headerRow = nonEmptyRows[0].map(c => cellToString(c))
    const expectedLabels = visibleWritable.map(c => c.label)

    if (headerRow.length !== expectedLabels.length || !headerRow.every((h, i) => h === expectedLabels[i])) {
      showToast('表头不匹配，请先点击「模板」下载标准模板', false); return
    }

    // 跳过说明行
    let dataStartIdx = 1
    if (nonEmptyRows.length > 1) {
      const secondRow = nonEmptyRows[1].map(c => String(c ?? '')).join('')
      if (secondRow.includes('匹配键') || secondRow.includes('必填') || secondRow.includes('填写') || secondRow.includes('系统自动')) {
        dataStartIdx = 2
      }
    }

    // 构建外键反向字典
    const reverseDicts: Record<string, Record<string, string>> = {}
    const allColsForDict = [...writableCols]
    if (config.uploadMatchKeys) {
      for (const mk of config.uploadMatchKeys) {
        if (!writableCols.some(c => c.key === mk)) {
          const col = config.cols.find(c => c.key === mk)
          if (col) allColsForDict.push(col)
        }
      }
    }
    for (const col of allColsForDict) {
      if (col.foreignKey && dicts[col.foreignKey] && !reverseDicts[col.key]) {
        reverseDicts[col.key] = {}
        for (const [id, name] of Object.entries(dicts[col.foreignKey])) {
          reverseDicts[col.key][name] = id
        }
      }
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const errors: string[] = []
    const parsed: Record<string, any>[] = []

    for (let i = dataStartIdx; i < nonEmptyRows.length; i++) {
      const cells = nonEmptyRows[i]
      const rowNum = i + 1
      const rowData: Record<string, any> = {}

      visibleWritable.forEach((col, idx) => {
        const raw = cellToString(cells[idx])
        const parsedCell = parseUploadCellValue(col, raw)

        if (parsedCell.kind === 'skip') {
          return
        }
        if (parsedCell.kind === 'error') {
          errors.push(`第 ${rowNum} 行 - ${col.label}：${parsedCell.message}`)
          return
        }

        if (col.foreignKey && reverseDicts[col.key]) {
          const foreignValue = String(parsedCell.value)
          if (uuidRegex.test(foreignValue)) {
            rowData[col.key] = foreignValue
          } else {
            const resolvedId = reverseDicts[col.key][foreignValue]
            if (!resolvedId) {
              errors.push(`第 ${rowNum} 行 - ${col.label}：找不到名为 "${foreignValue}" 的记录`)
            } else {
              rowData[col.key] = resolvedId
            }
          }
        } else {
          rowData[col.key] = parsedCell.value
        }
      })

      if (errors.length === 0) parsed.push(rowData)
    }

    if (errors.length > 0) { setImportErrors(errors); return }

    const hasMatchKeys = config.uploadMatchKeys && config.uploadMatchKeys.length > 0

    if (hasMatchKeys) {
      for (let i = 0; i < parsed.length; i++) {
        for (const mk of config.uploadMatchKeys!) {
          const val = parsed[i][mk]
          if (val === undefined || val === null || val === '') {
            const col = config.cols.find(c => c.key === mk)
            errors.push(`第 ${i + 2} 行 - ${col?.label ?? mk}：匹配字段不能为空`)
          }
        }
      }
      if (errors.length > 0) { setImportErrors(errors); return }
    }

    setUploading(true)

    if (hasMatchKeys) {
      let insertedCount = 0
      let updatedCount = 0
      const matchErrors: string[] = []

      const { data: existingRows } = await supabase.from(config.table).select('*').limit(10000)
      const existing = existingRows || []

      for (let i = 0; i < parsed.length; i++) {
        const row = parsed[i]
        const rowNum = i + 2

        let matched = existing.find(ex => {
          return config.uploadMatchKeys!.every(mk => {
            const col = config.cols.find(c => c.key === mk)
            const csvVal = row[mk]
            const exVal = ex[mk]
            if (col?.foreignKey) return String(csvVal) === String(exVal)
            return String(csvVal ?? '').trim() === String(exVal ?? '').trim()
          })
        })

        if (!matched && config.matchFormerNames) {
          const nameCol = config.uploadMatchKeys?.[0]
          const csvName = nameCol ? String(row[nameCol] ?? '').trim() : ''
          if (csvName) {
            matched = existing.find(ex => {
              const arr = ex[config.matchFormerNames!]
              return Array.isArray(arr) && arr.some((n: string) => String(n).trim() === csvName)
            })
          }
        }

        if (matched) {
          const { error } = await supabase.from(config.table).update(row).eq('id', matched.id)
          if (error) matchErrors.push(`第 ${rowNum} 行更新失败: ${error.message}`)
          else updatedCount++
        } else {
          const { error } = await supabase.from(config.table).insert(row)
          if (error) matchErrors.push(`第 ${rowNum} 行新增失败: ${error.message}`)
          else insertedCount++
        }
      }

      setUploading(false)
      if (matchErrors.length > 0) setImportErrors(matchErrors)
      const parts: string[] = []
      if (insertedCount > 0) parts.push(`新增 ${insertedCount} 条`)
      if (updatedCount > 0) parts.push(`更新 ${updatedCount} 条`)
      if (parts.length > 0) {
        showToast(parts.join('，'))
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'BULK_UPSERT', table: config.table, table_label: config.label,
          count: parsed.length, inserted: insertedCount, updated: updatedCount,
        })
        await fetchRows()
      } else if (matchErrors.length === 0) {
        showToast('无数据变更', false)
      }
    } else {
      const { error } = await supabase.from(config.table).insert(parsed)
      setUploading(false)
      if (error) {
        showToast(`导入失败: ${error.message}`, false)
      } else {
        showToast(`成功导入 ${parsed.length} 条数据`)
        const session = await getSession()
        const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
        logAction(userId, 'ADMIN_DATA_OPERATION', {
          operation: 'BULK_INSERT', table: config.table, table_label: config.label, count: parsed.length,
        })
        await fetchRows()
      }
    }
  }

  // ─── Excel 导出 ────────────────────────────────────────────────────────────

  const exportToExcel = () => {
    if (filtered.length === 0) { showToast('没有数据可导出', false); return }

    const activeView = config.viewMode?.views.find(v => v.key === viewMode)
    let filenamePrefix = config.label
    if (config.viewMode?.enabled && activeView) {
      filenamePrefix = activeView.label === '最新数据' ? '季度填报数据汇总_各项目最新结果' : '季度填报数据汇总_全量审计历史明细'
    }

    const exportData = filtered.map(row => {
      const exportRow: Record<string, any> = {}
      config.cols.filter(c => !c.hidden).forEach(col => {
        let value = getLookupValue(col, row)
        if (col.displayMap && col.displayMap[String(value)]) {
          value = col.displayMap[String(value)]
        } else if (col.foreignKey && dicts[col.foreignKey]?.[value]) {
          value = dicts[col.foreignKey][value]
        }
        if (col.key === 'created_at' && value) {
          value = new Date(value).toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          })
        }
        exportRow[col.label] = value ?? ''
      })
      return exportRow
    })

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, config.label)
    const now = new Date()
    const ts = now.toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `${filenamePrefix}_${ts}.xlsx`
    XLSX.writeFile(wb, filename)
    showToast(`已导出 ${filtered.length} 条数据`)

    getSession().then(session => {
      const userId = session?.user?.email ?? session?.user?.id ?? 'admin'
      logAction(userId, 'EXPORT_DATA', {
        export_type: 'admin_table',
        table: config.table,
        table_label: config.label,
        record_count: filtered.length,
        file_name: filename,
        view_mode: viewMode,
        target_name: filename,
      })
    })
  }

  // ─── 名称键（用于删除确认）────────────────────────────────────────────────

  const nameKeyCol = config.cols.find(c =>
    c.key === 'name' || c.key === 'project_name' || c.key === 'company_name' || c.key === 'building_id'
  )
  const nameKey = nameKeyCol?.key
  const getDisplayName = (row: any): string | undefined => {
    if (!nameKeyCol || !nameKey) return undefined
    const raw = row[nameKey]
    if (nameKeyCol.foreignKey && dicts[nameKeyCol.foreignKey]) {
      return dicts[nameKeyCol.foreignKey][raw] || raw
    }
    return raw
  }

  // ─── 外键列集合（用于搜索和显示）─────────────────────────────────────────

  const foreignKeyCols = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of config.cols) if (c.foreignKey) set.add(c.key)
    return set
  }, [config.cols])

  // ─── 渲染：单元格内容 ──────────────────────────────────────────────────────

  const renderCellContent = (col: ColDef, row: any, isEditing: boolean, buf: Record<string, any>, setBuf: (fn: (p: any) => any) => void) => {
    if (isEditing && !col.readOnly) {
      // 编辑模式
      if (col.type === 'textarea' || col.type === 'jsonb') {
        return (
          <textarea rows={2} value={buf[col.key] ?? ''} onChange={e => setBuf(p => ({ ...p, [col.key]: e.target.value }))}
            className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:border-[#003e7e] resize-none" />
        )
      }
      if (col.type === 'boolean') {
        return (
          <input type="checkbox" checked={!!buf[col.key]} onChange={e => setBuf(p => ({ ...p, [col.key]: e.target.checked }))}
            className="h-4 w-4 rounded border-zinc-300" />
        )
      }
      if (col.type === 'tags') {
        const currentTags: string[] = Array.isArray(buf[col.key]) ? buf[col.key] : []
        return (
          <TagInput
            tags={currentTags}
            onChange={tags => setBuf(p => ({ ...p, [col.key]: tags }))}
          />
        )
      }
      if (col.foreignKey && dicts[col.foreignKey]) {
        return (
          <SearchableSelect
            value={buf[col.key] ?? ''}
            onChange={val => setBuf(p => ({ ...p, [col.key]: val }))}
            options={Object.entries(dicts[col.foreignKey]).map(([id, label]) => ({ value: id, label }))}
            placeholder="-- 选择 --"
            className="w-full"
          />
        )
      }
      return (
        <input type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
          value={buf[col.key] ?? ''} onChange={e => setBuf(p => ({ ...p, [col.key]: e.target.value }))}
          className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-sm outline-none focus:border-[#003e7e]" />
      )
    }

    // 显示模式
    let displayValue: string
    const lookupVal = getLookupValue(col, row)
    if (col.displayMap) {
      displayValue = col.displayMap[String(lookupVal)] ?? String(lookupVal ?? '-')
    } else if (col.foreignKey && dicts[col.foreignKey]) {
      displayValue = dicts[col.foreignKey][lookupVal] ?? '-'
    } else if (col.type === 'boolean') {
      displayValue = row[col.key] ? '是' : '否'
    } else if (col.type === 'jsonb') {
      displayValue = row[col.key] ? JSON.stringify(row[col.key]).substring(0, 50) + (JSON.stringify(row[col.key]).length > 50 ? '...' : '') : '-'
    } else if (col.type === 'tags') {
      const arr = Array.isArray(row[col.key]) ? row[col.key] : []
      displayValue = arr.length > 0 ? arr.join('、') : '-'
    } else if (col.type === 'uuid') {
      const val = String(row[col.key] ?? '-')
      displayValue = val.length > 12 ? val.substring(0, 8) + '...' : val
    } else if (col.type === 'number' && row[col.key] != null) {
      const num = Number(row[col.key])
      if (col.suffix) {
        // 百分比：值乘100，保留指定小数位，加千分位，拼接后缀
        const pct = num * 100
        displayValue = pct.toLocaleString('zh-CN', {
          minimumFractionDigits: col.decimals ?? 0,
          maximumFractionDigits: col.decimals ?? 0,
        }) + col.suffix
      } else if (col.decimals != null) {
        displayValue = num.toLocaleString('zh-CN', {
          minimumFractionDigits: col.decimals,
          maximumFractionDigits: col.decimals,
        })
      } else if (col.noThousandSeparator) {
        displayValue = String(num)
      } else {
        // 整数或无特殊格式：加千分位
        displayValue = Number.isInteger(num) ? num.toLocaleString('zh-CN') : num.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
      }
    } else {
      displayValue = String(row[col.key] ?? '-')
    }

    return (
      <MaskedCell masked={!!col.masked}>
        <span className="text-sm text-zinc-700" title={String(row[col.key] ?? '')}>
          {displayValue}
        </span>
      </MaskedCell>
    )
  }

  // ─── 渲染 ──────────────────────────────────────────────────────────────────

  const visibleCols = config.cols.filter(c => !c.hidden)

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-all ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* 导入错误提示 */}
      {importErrors.length > 0 && (
        <ImportErrorsModal errors={importErrors} onClose={() => setImportErrors([])} />
      )}

      {/* 工具栏 */}
      <div className="shrink-0 mb-3 flex items-center gap-3 flex-wrap">
        <input type="text" placeholder="搜索..." value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
          className="h-8 rounded border border-zinc-300 px-3 text-sm outline-none focus:border-[#003e7e] w-56" />
        <span className="text-xs text-zinc-400">{filtered.length} 条记录</span>

        {config.showInactiveFilter && (
          <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={e => { setShowInactive(e.target.checked); setPage(0) }}
              className="h-3.5 w-3.5 rounded border-zinc-300" />
            <span className="text-xs text-zinc-500">显示未启用楼宇</span>
          </label>
        )}

        {config.statsMode && (
          <label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
            <input type="checkbox" checked={statsEnabled} onChange={e => { setStatsEnabled(e.target.checked); setSelectedIds(new Set()); setPage(0) }}
              className="h-3.5 w-3.5 rounded border-zinc-300" />
            <span className="text-xs text-zinc-500">统计模式</span>
          </label>
        )}

        {/* 视图模式切换 */}
        {config.viewMode?.enabled && (
          <div className="flex items-center gap-2 ml-4">
            <span className="text-xs text-zinc-500">视图：</span>
            {config.viewMode.views.map(v => (
              <button key={v.key} onClick={() => { setViewMode(v.key); setPage(0) }}
                className={`h-8 rounded px-3 text-xs transition ${viewMode === v.key ? 'bg-[#003e7e] text-white' : 'border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50'}`}>
                {v.label}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex gap-2">
          {/* 工具栏额外按钮 */}
          {config.toolbarExtra?.map(action => (
            <button key={action.key} onClick={action.handler}
              className="h-8 rounded border border-[#003e7e] bg-[#e8f0fb] px-3 text-xs text-[#003e7e] hover:bg-[#d0e2f7]">
              {action.icon} {action.label}
            </button>
          ))}

          <button onClick={exportToExcel} className="h-8 rounded border border-emerald-300 bg-emerald-50 px-3 text-xs text-emerald-700 hover:bg-emerald-100">
            导出 Excel
          </button>
          <button onClick={() => setDiagOpen(true)} className="h-8 rounded border border-violet-300 bg-violet-50 px-3 text-xs text-violet-700 hover:bg-violet-100">
            数据库说明
          </button>
          {config.uploadMatchKeys && (
            <button onClick={() => setUploadGuideOpen(true)} className="h-8 rounded border border-amber-300 bg-amber-50 px-3 text-xs text-amber-700 hover:bg-amber-100">
              上传说明
            </button>
          )}
          <button onClick={fetchRows} className="h-8 rounded border border-zinc-300 bg-white px-3 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">
            刷新
          </button>
          {!config.hideTemplate && (
            <button onClick={downloadTemplate} className="h-8 rounded border border-zinc-300 bg-white px-3 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">
              模板
            </button>
          )}
          {!config.hideUpload && (
            <>
              <button onClick={triggerUpload} disabled={uploading} className="h-8 rounded border border-zinc-300 bg-white px-3 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50">
                {uploading ? '上传中...' : '上传'}
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileSelect} className="hidden" />
            </>
          )}
          {!config.hideAdd && (
            <button onClick={startAdd} className="h-8 rounded bg-blue-600 px-3 text-xs text-white transition-all duration-150 hover:bg-blue-700 active:scale-[0.98]">
              + 新增
            </button>
          )}
        </div>
      </div>

      {/* 统计结果栏 */}
      {statsEnabled && stats && (
        <div className="shrink-0 mb-3 flex items-center gap-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-xs font-semibold text-blue-700">已选 {selectedIds.size} 项统计</span>
          {stats.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-xs text-blue-600">{s.label}：</span>
              <span className="text-sm font-bold text-blue-800">{s.value}</span>
            </div>
          ))}
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-blue-500 hover:text-blue-700 underline">清除选择</button>
        </div>
      )}

      {/* 新增行表单 */}
      {adding && (
        <div className="shrink-0 mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="mb-3 text-xs font-semibold text-emerald-800">新增一行</p>
          <div className="flex flex-wrap gap-3">
            {writableCols.filter(c => !c.hidden).map(c => (
              <div key={c.key} className="flex flex-col gap-1">
                <label className="text-[10px] text-zinc-500">{c.label}{c.required && <span className="text-red-500 ml-0.5">*</span>}</label>
                {renderCellContent(c, newRow, true, newRow, setNewRow)}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={saveAdd} disabled={saving} className="rounded bg-emerald-600 px-4 py-1.5 text-xs text-white transition-all duration-150 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50">
              {saving ? '保存中...' : '确认新增'}
            </button>
            <button onClick={cancelAdd} className="rounded border border-zinc-300 bg-white px-4 py-1.5 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 顶部吸顶滚动条 */}
      {isScrollable && (
        <div ref={topScrollRef} onScroll={handleTopScroll}
          className="shrink-0 overflow-x-auto table-persistent-scroll mb-2 bg-white border-b border-zinc-200"
          style={{ height: '16px', position: 'sticky', top: 0, zIndex: 30 }}>
          <div style={{ width: `${tableScrollWidth}px`, height: '1px' }} />
        </div>
      )}

      {/* 数据表格 */}
      <div ref={tableScrollRef} onScroll={handleTableScroll}
        className="flex-1 min-h-0 overflow-auto rounded-lg border border-zinc-200 table-persistent-scroll">
        <table className="w-full text-left text-sm whitespace-nowrap" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 20 }} className="bg-zinc-50">
            <tr className="border-b border-zinc-200">
              {statsEnabled && (
                <th className="px-2 py-2.5 bg-zinc-50 border-b border-r border-zinc-200 w-10">
                  <input type="checkbox" checked={paged.length > 0 && paged.every(r => selectedIds.has(r.id))}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedIds(prev => new Set([...prev, ...paged.map(r => r.id)]))
                      } else {
                        setSelectedIds(prev => { const next = new Set(prev); paged.forEach(r => next.delete(r.id)); return next })
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-zinc-300" />
                </th>
              )}
              {visibleCols.map((c, idx) => (
                <th key={c.key} className={`px-3 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-50 border-b border-r border-zinc-200 ${c.width ?? ''}`}
                  style={idx === 0 ? { position: 'sticky', left: 0, zIndex: 10 } : undefined}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-sm font-medium text-zinc-700 bg-zinc-50 border-b border-zinc-200 w-24">操作</th>
            </tr>
            <tr className="border-b border-zinc-200 bg-zinc-50/80">
              {statsEnabled && (
                <th className="px-2 py-1.5 bg-zinc-50 border-b border-r border-zinc-200 sticky top-[41px] z-10"></th>
              )}
              {visibleCols.map((c, idx) => (
                <th key={c.key} className="px-2 py-1.5 bg-zinc-50 border-b border-r border-zinc-200"
                  style={{ position: 'sticky', top: '41px', zIndex: idx === 0 ? 20 : 10, ...(idx === 0 ? { left: 0 } : {}) }}>
                  <FilterCombo
                    value={columnFilters[c.key] ?? ''}
                    onChange={val => { setColumnFilters(prev => ({ ...prev, [c.key]: val })); setPage(0) }}
                    options={filterOptions[c.key] ?? []}
                  />
                </th>
              ))}
              <th className="px-2 py-1.5 bg-zinc-50 border-b border-zinc-200 sticky top-[41px] z-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr><td colSpan={visibleCols.length + 1 + (statsEnabled ? 1 : 0)} className="px-4 py-8 text-center text-zinc-400">
                <div className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-primary"></div>
                  <span>加载中...</span>
                </div>
              </td></tr>
            ) : paged.length === 0 ? (
              <tr><td colSpan={visibleCols.length + 1 + (statsEnabled ? 1 : 0)} className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-3">
                    <span className="text-sm font-medium tracking-wide text-zinc-400">暂无数据</span>
                  </div>
                </div>
              </td></tr>
            ) : paged.map(row => {
              const isEditing = editingId === row.id
              return (
                <tr key={row.id} className={`transition-colors duration-150 hover:bg-zinc-50/80 ${isEditing ? 'bg-blue-50' : ''}`}>
                  {statsEnabled && (
                    <td className="px-2 py-2 align-middle border-r border-zinc-200 bg-white">
                      <input type="checkbox" checked={selectedIds.has(row.id)}
                        onChange={e => {
                          setSelectedIds(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(row.id)
                            else next.delete(row.id)
                            return next
                          })
                        }}
                        className="h-3.5 w-3.5 rounded border-zinc-300" />
                    </td>
                  )}
                  {visibleCols.map((c, idx) => (
                    <td key={c.key} className={`px-3 py-2 align-middle border-r border-zinc-200 ${idx === 0 ? (isEditing ? 'bg-blue-50' : 'bg-white') : ''}`}
                      style={idx === 0 ? { position: 'sticky', left: 0, zIndex: 10 } : undefined}>
                      {isEditing && !c.readOnly
                        ? renderCellContent(c, row, true, editBuf, setEditBuf)
                        : renderCellContent(c, row, false, editBuf, setEditBuf)
                      }
                    </td>
                  ))}
                  <td className="px-3 py-2 align-middle">
                    {isEditing ? (
                      <div className="flex gap-1.5">
                        <button onClick={saveEdit} disabled={saving} className="rounded bg-blue-600 px-2 py-1 text-xs text-white transition-all duration-150 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50">
                          {saving ? '...' : '保存'}
                        </button>
                        <button onClick={cancelEdit} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        {/* 历史按钮 */}
                        {config.supportsHistory && row.building_id && row.record_year && row.record_quarter && (
                          <button onClick={() => { setSelectedRowForHistory(row); fetchHistory(row.building_id, row.record_year, row.record_quarter) }}
                            title="查看历史" className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">
                            历史
                          </button>
                        )}
                        <button onClick={() => startEdit(row)} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs transition-all duration-150 hover:bg-zinc-50 active:scale-[0.98]">
                          编辑
                        </button>
                        {/* 特殊操作按钮 */}
                        {config.specialActions?.filter(a => a.condition(row)).map(action => (
                          <button key={action.key}
                            onClick={() => handleSpecialAction(action, row)}
                            disabled={actionLoading === `${action.key}-${row.id}`}
                            className={`rounded border px-2 py-1 text-xs transition-all duration-150 disabled:opacity-50 ${
                              action.style === 'danger' ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' :
                              action.style === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' :
                              'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                            }`}>
                            {actionLoading === `${action.key}-${row.id}` ? '...' : action.label}
                          </button>
                        ))}
                        <button onClick={() => deleteRow(row.id, getDisplayName(row))}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 transition-all duration-150 hover:bg-red-100 active:scale-[0.98]">
                          删除
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="shrink-0 mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>第 {page + 1} / {totalPages} 页，共 {filtered.length} 条</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="rounded border border-zinc-300 px-2 py-1 transition-all duration-150 disabled:opacity-40 hover:bg-zinc-50 active:scale-[0.98]">上一页</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="rounded border border-zinc-300 px-2 py-1 transition-all duration-150 disabled:opacity-40 hover:bg-zinc-50 active:scale-[0.98]">下一页</button>
          </div>
        </div>
      )}

      {/* 历史记录弹窗 */}
      <Dialog
        open={historyModalOpen}
        onOpenChange={(open) => { if (!open) closeHistoryModal(); }}
        title="提交历史记录"
        description={selectedRowForHistory ? `项目：${dicts.buildings?.[selectedRowForHistory.building_id] || selectedRowForHistory.building_id} · 时间：${selectedRowForHistory.record_year} Q${selectedRowForHistory.record_quarter}` : undefined}
        size="xl"
        footer={<Button variant="secondary" onClick={closeHistoryModal}>关闭</Button>}
      >
              {historyLoading ? (
                <LoadingState label="正在加载提交历史" />
              ) : historyData.length === 0 ? (
                <EmptyState title="暂无历史记录" />
              ) : (
                <div className="space-y-4">
                  {historyData.map((record, index) => (
                    <div key={record.id} className={`border rounded-lg p-4 ${index === 0 ? 'border-emerald-300 bg-emerald-50/30' : 'border-zinc-200 bg-white'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {index === 0 && <span className="px-2 py-0.5 text-[10px] font-medium text-emerald-700 bg-emerald-100 rounded">最新版本</span>}
                          <span className="text-xs text-zinc-500">版本 #{historyData.length - index}</span>
                        </div>
                        <div className="text-xs text-zinc-400">
                          提交时间：{new Date(record.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                        <div><span className="text-zinc-500">提交人：</span><MaskedCell masked><span className="font-medium">{record.user_name}</span></MaskedCell></div>
                        <div><span className="text-zinc-500">报价租金：</span><span className="font-medium">{record.asking_rent ?? '-'}</span></div>
                        <div><span className="text-zinc-500">物业费：</span><span className="font-medium">{record.management_fee ?? '-'}</span></div>
                        <div><span className="text-zinc-500">净有效租金：</span><span className="font-medium text-emerald-600">{record.net_effective_rent ?? '-'}</span></div>
                        <div><span className="text-zinc-500">空置率：</span><span className="font-medium text-blue-600">{record.vacancy_rate ? `${record.vacancy_rate}%` : '-'}</span></div>
                        <div><span className="text-zinc-500">总面积：</span><span className="font-medium">{record.total_area ?? '-'}</span></div>
                        {record.notes && <div className="col-span-2 md:col-span-3 lg:col-span-4"><span className="text-zinc-500">备注：</span><span className="font-medium">{record.notes}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
      </Dialog>

      {/* 数据库说明弹窗 */}
      {diagOpen && <DataDiagnosticModal config={config} rows={rows} onClose={() => setDiagOpen(false)} />}

      {/* 上传说明弹窗 */}
      {uploadGuideOpen && config.uploadMatchKeys && (
        <UploadGuideModal config={config} onClose={() => setUploadGuideOpen(false)} />
      )}
    </div>
  )
}
