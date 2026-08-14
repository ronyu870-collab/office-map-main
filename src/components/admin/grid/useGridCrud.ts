'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { logAction } from '@/src/utils/audit'
import { getSession } from '@/src/services/Auth'
import type { TableConfig, DictBundle, ColDef } from '../types'

function emptyRow(cols: ColDef[]): Record<string, any> {
  const row: Record<string, any> = {}
  for (const c of cols) {
    if (!c.readOnly) row[c.key] = ''
  }
  return row
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

// 项目台账缓存键（与 tableConfigs.ts customFetch 中保持一致）
const LEDGER_CACHE_KEYS = ['__project_ledger_cache_v4']
// 台账依赖的数据源表：修改这些表时需要清除台账缓存
const LEDGER_SOURCE_TABLES = new Set(['buildings', 'building_metrics', 'building_current_data'])

function invalidateLedgerCache(table: string) {
  if (LEDGER_SOURCE_TABLES.has(table)) {
    for (const key of LEDGER_CACHE_KEYS) {
      try { sessionStorage.removeItem(key) } catch {}
    }
  }
}

const colLabels = (cols: ColDef[]) =>
  Object.fromEntries(cols.filter(c => !c.hidden).map(c => [c.key, c.label]))


/**
 * CRUD 操作 hook — 编辑、新增、删除 + 审计日志
 */
export function useGridCrud(
  config: TableConfig,
  dicts: DictBundle,
  rows: any[],
  fetchRows: () => Promise<void>,
  showToast: (msg: string, ok?: boolean) => void,
  onRefreshDicts?: () => Promise<void>,
) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuf, setEditBuf] = useState<Record<string, any>>({})
  const [adding, setAdding] = useState(false)
  const [newRow, setNewRow] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // 保存编辑前的原始行（用于 WHERE 条件和变更 diff）
  const editingOriginalRef = useRef<Record<string, any>>({})
  // 解决闭包过期：handleSaveEdit 中 rawSaveEdit 可能引用旧的 editBuf
  const editBufRef = useRef<Record<string, any>>({})
  useEffect(() => { editBufRef.current = editBuf }, [editBuf])

  // ─── 编辑 ───

  const startEdit = useCallback((row: any) => {
    const rowId = row.id ?? row.building_id
    setEditingId(rowId)
    setEditBuf({ ...row })
    editingOriginalRef.current = { ...row }
    setAdding(false)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditBuf({})
    editBufRef.current = {}
    editingOriginalRef.current = {}
  }, [])

  // 强制同步 editBufRef —— 从 AG Grid 直接拿最新行数据写入 ref，
  // 绕过 React useEffect 异步时序问题，确保 saveEdit 读到的是最新值
  const forceSyncBuf = useCallback((data: Record<string, any>) => {
    editBufRef.current = { ...data }
    setEditBuf({ ...data })
  }, [])

  const saveEdit = useCallback(async () => {
    setSaving(true)
    const buf = editBufRef.current
    let payload: Record<string, any> = {}
    for (const c of config.cols) {
      if (c.readOnly) continue
      if (c.type === 'number') {
        payload[c.key] = buf[c.key] === '' || buf[c.key] == null ? null : Number(buf[c.key])
      } else if (c.type === 'boolean') {
        payload[c.key] = buf[c.key] === true || buf[c.key] === 'true'
      } else if (c.type === 'jsonb') {
        try { payload[c.key] = buf[c.key] ? JSON.parse(buf[c.key]) : null }
        catch { showToast(`${c.label} JSON 格式错误`, false); setSaving(false); return }
      } else if (c.type === 'date') {
        payload[c.key] = buf[c.key] === '' ? null : buf[c.key]
      } else {
        payload[c.key] = buf[c.key]
      }
    }

    if (config.beforeSave) payload = config.beforeSave(payload, dicts)

    // 使用编辑前保存的原始行，避免 rows.find(r => r.id === editingId) 在无 id 列的表上失败
    const currentRow = editingOriginalRef.current
    const isVirtual = currentRow._virtual === true
    const labels = colLabels(config.cols)

    let error: any
    if (isVirtual) {
      delete payload.id
      // 虚拟行=INSERT：自动注入 filterField/filterValue
      if (config.filterField && config.filterValue != null && !(config.filterField in payload)) {
        payload[config.filterField] = config.filterValue
      }
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
          col_labels: labels,
        })
      }
    } else {
      // 用 uploadMatchKeys 构建 WHERE（兼容无 id 列的表如 building_current_data）
      let updateQuery = supabase.from(config.table).update(payload)
      if (config.uploadMatchKeys?.length) {
        for (const mk of config.uploadMatchKeys) {
          updateQuery = updateQuery.eq(mk, currentRow[mk])
        }
      } else {
        updateQuery = updateQuery.eq('id', editingId!)
      }
      const res = await updateQuery
      error = res.error
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
          changes, col_labels: labels,
        })
      }
    }

    if (error) { showToast(`保存失败: ${error.message}`, false) }
    else {
      showToast(isVirtual ? '新增成功' : '保存成功')
      invalidateLedgerCache(config.table)
      cancelEdit()
      await fetchRows()
      if (config.table === 'buildings') await onRefreshDicts?.()
    }
    setSaving(false)
  }, [editingId, config, dicts, fetchRows, showToast, onRefreshDicts])

  // ─── 新增 ───

  const startAdd = useCallback(() => {
    setAdding(true)
    setNewRow(emptyRow(config.cols))
    setEditingId(null)
  }, [config.cols])

  const cancelAdd = useCallback(() => {
    setAdding(false)
    setNewRow({})
  }, [])

  const saveAdd = useCallback(async () => {
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
      } else if (c.type === 'date') {
        payload[c.key] = newRow[c.key] === '' ? null : newRow[c.key]
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

    // 自动注入 filterField/filterValue（如 project_type=stock/future/entering）
    if (config.filterField && config.filterValue != null && !(config.filterField in payload)) {
      payload[config.filterField] = config.filterValue
    }

    if (config.beforeSave) payload = config.beforeSave(payload, dicts)
    const labels = colLabels(config.cols)

    // 自定义新增逻辑
    if (config.customSaveAdd) {
      const result = await config.customSaveAdd(payload, dicts)
      if (result.success) {
        showToast(result.message)
        invalidateLedgerCache(config.table)
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
          changes: insertChanges, col_labels: labels,
        })
        cancelAdd()
        await fetchRows()
        if (config.table === 'buildings') await onRefreshDicts?.()
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
      invalidateLedgerCache(config.table)
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
        changes: insertChanges, col_labels: labels,
      })
      cancelAdd()
      await fetchRows()
      if (config.table === 'buildings') await onRefreshDicts?.()
    }
    setSaving(false)
  }, [newRow, config, dicts, fetchRows, showToast, onRefreshDicts])

  // ─── 删除 ───

  const deleteRow = useCallback(async (id: string, name?: string, rowData?: any) => {
    const resolvedId = id ?? rowData?.id ?? rowData?.building_id
    const virtualRow = rows.find(r => r.id === resolvedId && r._virtual)
    if (virtualRow) { showToast('未分配的楼宇无需删除', false); return }
    if (!confirm(`确认删除「${name || resolvedId}」？此操作不可撤销。`)) return
    const originalRow = rows.find(r => r.id === resolvedId) ?? rowData

    // 删除前检查外键依赖（仅 buildings 表）
    if (config.table === 'buildings') {
      const depTables: { table: string; label: string }[] = [
        { table: 'building_metrics', label: '季度更新数据' },
        { table: 'building_current_data', label: '实时动态数据' },
      ]
      const depResults = await Promise.all(
        depTables.map(t => supabase.from(t.table).select('id', { count: 'exact', head: true }).eq('building_id', resolvedId))
      )
      const deps = depTables
        .map((t, i) => ({ ...t, count: depResults[i].count ?? 0 }))
        .filter(d => d.count > 0)
      if (deps.length > 0) {
        const detail = deps.map(d => `${d.label}（${d.count} 条）`).join('、')
        showToast(`无法删除：该项目在以下表中还有关联数据 → ${detail}，请先清空关联数据后再删除项目`, false)
        return
      }
    }

    // 使用 uploadMatchKeys 构建 WHERE 条件（兼容无 id 列的表如 building_current_data）
    let deleteQuery = supabase.from(config.table).delete()
    if (config.uploadMatchKeys?.length && (originalRow || rowData)) {
      const ref = originalRow ?? rowData
      for (const mk of config.uploadMatchKeys) {
        deleteQuery = deleteQuery.eq(mk, ref[mk])
      }
    } else {
      deleteQuery = deleteQuery.eq('id', resolvedId)
    }
    const { data, error } = await deleteQuery.select()
    if (error) { showToast(`删除失败: ${error.message}`, false) }
    else if (!data || data.length === 0) {
      showToast('删除失败：未找到匹配的记录或权限不足', false)
    } else {
      showToast('已删除')
      invalidateLedgerCache(config.table)
      if (config.table === 'buildings') await onRefreshDicts?.()
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
      const labels = colLabels(config.cols)
      logAction(userId, 'ADMIN_DATA_OPERATION', {
        operation: 'DELETE', table: config.table, table_label: config.label,
        target_id: resolvedId ?? 'unknown', context: buildRowContext(originalRow ?? { id: resolvedId }, config.cols, dicts),
        changes: deleteChanges, col_labels: labels,
      })
      await fetchRows()
    }
  }, [rows, config, dicts, fetchRows, showToast, onRefreshDicts])

  // ─── 特殊操作 ───

  const handleSpecialAction = useCallback(async (action: any, row: any) => {
    const key = `${action.key}-${row.id}`
    setActionLoading(key)
    try {
      await action.handler(row, { fetchRows, showToast, dicts })
    } catch (e: any) {
      showToast(`操作失败: ${e.message}`, false)
    }
    setActionLoading(null)
  }, [fetchRows, showToast, dicts])

  return {
    editingId, editBuf, setEditBuf,
    adding, newRow, setNewRow,
    saving, actionLoading,
    startEdit, cancelEdit, saveEdit,
    startAdd, cancelAdd, saveAdd,
    deleteRow, handleSpecialAction, forceSyncBuf,
  }
}
