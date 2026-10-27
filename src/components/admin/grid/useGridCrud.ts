'use client'
import { useState, useCallback, useRef } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { logAction } from '@/src/utils/audit'
import { getSession } from '@/src/services/Auth'
import { clearMapReadCache } from '@/src/services/mapReadCache'
import type { TableConfig, DictBundle, ColDef } from '../types'
import { copyRecord, gridRowKey, recordIsDirty, recordPayload } from './recordModel'

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
  if (table === 'buildings' || table === 'future_supplies') clearMapReadCache()
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
  fetchRows: () => Promise<void | boolean>,
  showToast: (msg: string, ok?: boolean) => void,
  onRefreshDicts?: () => Promise<void>,
) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuf, rawSetEditBuf] = useState<Record<string, any>>({})
  const [adding, setAdding] = useState(false)
  const [newRow, rawSetNewRow] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const editingOriginalRef = useRef<Record<string, any>>({})
  const editBufRef = useRef<Record<string, any>>({})
  const newRowRef = useRef<Record<string, any>>({})
  const addingRef = useRef(false)
  const savingRef = useRef(false)
  const setEditBuf = useCallback((next: React.SetStateAction<Record<string, any>>) => {
    editBufRef.current = typeof next === 'function' ? next(editBufRef.current) : next
    rawSetEditBuf(editBufRef.current)
  }, [])
  const setNewRow = useCallback((next: React.SetStateAction<Record<string, any>>) => {
    newRowRef.current = typeof next === 'function' ? next(newRowRef.current) : next
    rawSetNewRow(newRowRef.current)
  }, [])
  const clearErrors = useCallback(() => { setSaveError(''); setFieldErrors({}) }, [])
  const startEdit = useCallback((row: any) => {
    if (savingRef.current) return
    const snapshot = copyRecord(row)
    editingOriginalRef.current = snapshot
    setEditingId(gridRowKey(config, row))
    setEditBuf(copyRecord(snapshot))
    setAdding(false); addingRef.current = false
    clearErrors()
  }, [config, setEditBuf, clearErrors])
  const cancelEdit = useCallback(() => {
    if (savingRef.current) return
    setEditingId(null); setEditBuf({}); editingOriginalRef.current = {}; clearErrors()
  }, [setEditBuf, clearErrors])
  const forceSyncBuf = setEditBuf
  const startAdd = useCallback(() => {
    if (savingRef.current) return
    setAdding(true); addingRef.current = true; setNewRow(emptyRow(config.cols)); setEditingId(null); clearErrors()
  }, [config.cols, setNewRow, clearErrors])
  const cancelAdd = useCallback(() => {
    if (savingRef.current) return
    setAdding(false); addingRef.current = false; setNewRow({}); clearErrors()
  }, [setNewRow, clearErrors])
  const isDirty = useCallback(() => recordIsDirty(config, addingRef.current ? emptyRow(config.cols) : editingOriginalRef.current, addingRef.current ? newRowRef.current : editBufRef.current), [config])

  const refreshAfterWrite = useCallback(async () => {
    try {
      const loaded = await fetchRows()
      if (loaded === false) throw new Error('列表刷新失败')
      if (config.table === 'buildings') await onRefreshDicts?.()
      setRefreshFailed(false)
    } catch {
      setRefreshFailed(true)
      showToast('已保存，列表刷新失败，请重试刷新', false)
    }
  }, [fetchRows, onRefreshDicts, config.table, showToast])

  const persist = useCallback(async (kind: 'edit' | 'add'): Promise<boolean> => {
    if (savingRef.current) return false
    savingRef.current = true; setSaving(true); clearErrors()
    let committed = false
    try {
      const values = copyRecord(kind === 'edit' ? editBufRef.current : newRowRef.current)
      const checked = recordPayload(config, values)
      if (Object.keys(checked.errors).length) {
        setFieldErrors(checked.errors)
        throw new Error(Object.values(checked.errors)[0])
      }
      let payload = checked.payload
      const original = copyRecord(editingOriginalRef.current)
      const insert = kind === 'add' || original._virtual === true
      if (insert && config.filterField && config.filterValue != null && !(config.filterField in payload)) payload[config.filterField] = config.filterValue
      if (config.beforeSave) payload = config.beforeSave(payload, dicts)
      if (!insert && config.table === 'buildings') {
        const aliasColumn = config.cols.find(col => col.key === 'former_names')
        if (aliasColumn && !recordIsDirty({ ...config, cols: [aliasColumn] }, original, values)) delete payload.former_names
      }
      let targetId = kind === 'edit' ? gridRowKey(config, original) : 'unknown'
      let resultRow = { ...values, ...payload }
      const identityCols = config.cols.filter(col => col.key === 'name' || col.key === 'former_names')
      const otherCols = config.cols.filter(col => col.key !== 'name' && col.key !== 'former_names')
      const buildingEdit = !insert && config.table === 'buildings'
      const otherFieldsChanged = buildingEdit && recordIsDirty({ ...config, cols: otherCols }, original, values)
      const identityChanged = buildingEdit && recordIsDirty({ ...config, cols: identityCols }, original, values)
      if (identityChanged && otherFieldsChanged) throw new Error('更名请单独保存名称和曾用名；其他修改仍保留在编辑框中，请分开操作')
      if (buildingEdit && !otherFieldsChanged) {
        if (!original.id || !original.name) throw new Error('缺少楼宇身份信息，请刷新后重试')
        const { data, error } = await supabase.rpc('admin_rename_building', {
          p_id: original.id,
          p_expected_name: original.name,
          p_expected_former_names: original.former_names ?? null,
          p_new_name: values.name,
          p_former_names: payload.former_names ?? null,
        })
        if (error) throw error
        if (!data?.length) throw new Error('未保存：未找到楼宇或当前无更名权限，请核对后重试')
        resultRow = data[0]; targetId = gridRowKey(config, resultRow); committed = true
      } else if (kind === 'add' && config.customSaveAdd) {
        const result = await config.customSaveAdd(payload, dicts)
        if (!result.success) throw new Error(result.message)
        targetId = result.targetId ?? targetId
        committed = true
      } else {
        let query
        if (insert) {
          delete payload.id
          query = supabase.from(config.table).insert(payload)
        } else {
          query = supabase.from(config.table).update(payload)
          // Names are import lookup keys, not stable identities for an edit.
          const keys = config.table === 'buildings' && original.id != null ? ['id'] : config.uploadMatchKeys?.length ? config.uploadMatchKeys : original.id != null ? ['id'] : original.user_id != null ? ['user_id'] : ['building_id']
          for (const key of keys) {
            if (original[key] == null || original[key] === '') throw new Error('缺少记录定位信息，请刷新后重试')
            query = query.eq(key, original[key])
          }
          if (config.table === 'buildings') {
            if (original.name != null) query = query.eq('name', original.name)
            if (original.former_names === null) query = query.is('former_names', null)
            else if (original.former_names !== undefined) query = query.eq('former_names', JSON.stringify(original.former_names))
          }
          // Use an existing version column only; no schema or permission changes.
          if (original.updated_at != null) query = query.eq('updated_at', original.updated_at)
        }
        const { data, error } = await query.select()
        if (error) throw error
        if (!data?.length) throw new Error('未保存：记录已变更或当前无写入权限，请核对后重试')
        committed = true
        resultRow = data[0]
        targetId = gridRowKey(config, resultRow)
      }
      invalidateLedgerCache(config.table)
      // A confirmed write is never retried because audit/readback failed.
      try {
        const session = await getSession()
        const changes: Record<string, { from: any; to: any }> = {}
        for (const [key, value] of Object.entries(payload)) {
          if (insert || JSON.stringify(original[key] ?? null) !== JSON.stringify(value ?? null)) changes[key] = { from: insert ? null : original[key] ?? null, to: value }
        }
        logAction(session?.user?.email ?? session?.user?.id ?? 'admin', 'ADMIN_DATA_OPERATION', {
          operation: insert ? 'INSERT' : 'UPDATE', table: config.table, table_label: config.label,
          target_id: targetId, context: buildRowContext(resultRow, config.cols, dicts), changes, col_labels: colLabels(config.cols),
        })
      } catch { showToast('已保存，操作记录同步失败，请联系管理员核对', false) }
      setEditingId(null); setAdding(false); addingRef.current = false
      setEditBuf({}); setNewRow({}); editingOriginalRef.current = {}
      showToast(insert ? '新增成功' : '保存成功')
      await refreshAfterWrite()
      return true
    } catch (error) {
      if (committed) return true
      const message = error instanceof Error ? error.message : String((error as any)?.message ?? '请求失败，请重试')
      setSaveError(message); showToast(`保存失败：${message}`, false)
      return false
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }, [config, dicts, clearErrors, setEditBuf, setNewRow, showToast, refreshAfterWrite])
  const saveEdit = useCallback(() => persist('edit'), [persist])
  const saveAdd = useCallback(() => persist('add'), [persist])

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
    saving, savingRef, actionLoading, saveError, fieldErrors, refreshFailed, isDirty, editingOriginalRef,
    startEdit, cancelEdit, saveEdit,
    startAdd, cancelAdd, saveAdd,
    deleteRow, handleSpecialAction, forceSyncBuf,
    getDraft: () => (addingRef.current || Object.keys(editingOriginalRef.current).length) ? {
      dirty: isDirty(),
      kind: addingRef.current ? 'add' as const : 'edit' as const,
      original: copyRecord(editingOriginalRef.current), values: copyRecord(addingRef.current ? newRowRef.current : editBufRef.current),
    } : null,
  }
}
