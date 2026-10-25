'use client'
import React, { useState, useMemo, useCallback, useRef } from 'react'
import { Button, Dialog } from '@/src/components/ui'
import { useAdminEditProtection } from '../AdminEditProtection'
import { useGridRecovery } from './useGridRecovery'
import { copyRecord, gridRowKey, recordIsDirty } from './recordModel'
import { RecordFields } from './RecordFields'
import { MobileRecordList } from './MobileRecordList'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import type { ColDef as AgColDef, GridApi } from 'ag-grid-community'
import './theme/grid-theme.css'

// AG Grid v35 要求显式注册模块
ModuleRegistry.registerModules([AllCommunityModule])

// 自定义主题
const myTheme = themeQuartz.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#374151',
  headerBackgroundColor: '#f9fafb',
  headerTextColor: '#6b7280',
  borderColor: '#e5e7eb',
  rowHoverColor: '#f9fafb',
  selectedRowBackgroundColor: '#eff6ff',
  rangeSelectionBorderColor: '#003e7e',
  fontSize: 13,
  rowHeight: 36,
  headerHeight: 40,
})

// 中文 locale
const AG_GRID_LOCALE_ZH = {
  // 筛选条件
  filterOoo: '筛选...',
  empty: '请选择',
  equals: '等于',
  notEqual: '不等于',
  lessThan: '小于',
  greaterThan: '大于',
  lessThanOrEqual: '小于等于',
  greaterThanOrEqual: '大于等于',
  inRange: '范围内',
  contains: '包含',
  notContains: '不包含',
  startsWith: '开头是',
  endsWith: '结尾是',
  blank: '为空',
  notBlank: '不为空',
  noRowsToShow: '暂无数据',
  // 布尔值
  true: '是',
  false: '否',
  // 排序
  sortAscending: '升序',
  sortDescending: '降序',
  // 列菜单
  columns: '列',
  filters: '筛选',
  // 分页
  page: '页',
  to: '至',
  of: '/',
  nextPage: '下一页',
  lastPage: '最后一页',
  firstPage: '第一页',
  previousPage: '上一页',
  loadingOoo: '加载中...',
  selectAll: '全选',
  searchOoo: '搜索...',
  // 其他
  blanks: '空白',
  enabled: '启用',
  pinColumn: '固定列',
  pinLeft: '固定到左侧',
  pinRight: '固定到右侧',
  noPin: '不固定',
  autosizeThiscolumn: '自动调整此列',
  autosizeAllColumns: '自动调整所有列',
  groupBy: '分组',
  ungroupBy: '取消分组',
  resetColumns: '重置列',
  expandAll: '展开全部',
  collapseAll: '收起全部',
  copy: '复制',
  ctrlC: 'Ctrl+C',
  paste: '粘贴',
  ctrlV: 'Ctrl+V',
  export: '导出',
  csvExport: '导出 CSV',
  excelExport: '导出 Excel',
  sum: '求和',
  min: '最小值',
  max: '最大值',
  none: '无',
  count: '计数',
  average: '平均值',
  avg: '平均',
}

import type { TableConfig, DictBundle } from '../types'
import { buildAgColumnDefs } from './columnMapper'
import { useGridData } from './useGridData'
import { useGridCrud } from './useGridCrud'
import { useGridFilters } from './useGridFilters'
import { useGridStats } from './useGridStats'
import { useXlsxImport } from './useXlsxImport'
import { useExcelExport } from './useExcelExport'

// Renderers
import { BooleanRenderer } from './renderers/BooleanRenderer'
import { DisplayMapRenderer } from './renderers/DisplayMapRenderer'
import { MaskedRenderer } from './renderers/MaskedRenderer'
import { NumberRenderer } from './renderers/NumberRenderer'
import { JsonbRenderer } from './renderers/JsonbRenderer'
import { ForeignKeyRenderer } from './renderers/ForeignKeyRenderer'
import { ForeignKeyEditor } from './renderers/ForeignKeyEditor'
import { ActionCellRenderer } from './renderers/ActionCellRenderer'

// Modals
import { HistoryModal } from './modals/HistoryModal'
import { UploadGuideModal } from './modals/UploadGuideModal'
import { ImportErrorsModal } from './modals/ImportErrorsModal'
import { LockManagerModal } from './modals/LockManagerModal'
import { UnlockConfirmModal } from './modals/UnlockConfirmModal'
import { AddRowForm } from './modals/AddRowForm'
import { DataDiagnosticModal } from '../DataDiagnosticModal'

// Toolbar
import { TableToolbar } from './toolbar/TableToolbar'
import { StatsBar } from './toolbar/StatsBar'

// AG Grid 组件注册
const FRAMEWORK_COMPONENTS = {
  BooleanRenderer,
  DisplayMapRenderer,
  MaskedRenderer,
  NumberRenderer,
  JsonbRenderer,
  ForeignKeyRenderer,
  ForeignKeyEditor,
  ActionCellRenderer,
}

interface GridPanelProps {
  config: TableConfig
  dicts?: DictBundle
  onRefreshDicts?: () => Promise<void>
  active?: boolean
  onDraftChange?: (dirty: boolean) => void
}

export function GridPanel({ config, dicts = {}, onRefreshDicts, active = true, onDraftChange }: GridPanelProps) {
  const gridRef = useRef<AgGridReact>(null)
  const gridApiRef = useRef<GridApi | null>(null)
  const [gridApi, setGridApi] = useState<GridApi | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [uploadReady, setUploadReady] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false)
  const [historyModal, setHistoryModal] = useState<{ buildingId: string; year: number; quarter: number } | null>(null)
  const [lockModalOpen, setLockModalOpen] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState<any>(null)
  const mountedRef = useRef(true)

  // 组件卸载时清理
  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      gridApiRef.current = null
    }
  }, [])

  // Demo 模式检测
  const [isDemo, setIsDemo] = useState(false)
  React.useEffect(() => {
    try {
      if (sessionStorage.getItem('__impersonation_state')) setIsDemo(true)
    } catch {}
  }, [])

  // Toast 工具
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ─── Hooks ───

  const { rows, setRows, getLatestRows, loading, loadError, fetchRows, viewMode, setViewMode } = useGridData(config, dicts, showToast)

  const {
    search, setSearch,
    columnFilters, setColumnFilter, clearColumnFilter, clearAllFilters,
    showInactive, setShowInactive,
    filtered, filterOptions,
  } = useGridFilters(rows, config, dicts)

  const [modelKeys, setModelKeys] = useState<string[] | null>(null)
  const resultRows = useMemo(() => {
    if (!modelKeys) return filtered
    const byKey = new Map(filtered.map(row => [gridRowKey(config, row), row]))
    return modelKeys.map(key => byKey.get(key)).filter(Boolean)
  }, [filtered, modelKeys, config])

  const {
    editingId, editBuf, setEditBuf,
    adding, newRow, setNewRow,
    saving, savingRef, actionLoading, saveError, fieldErrors, refreshFailed, isDirty, editingOriginalRef,
    startEdit, cancelEdit: rawCancelEdit, saveEdit: rawSaveEdit,
    startAdd, cancelAdd, saveAdd,
    deleteRow, handleSpecialAction, forceSyncBuf, getDraft,
  } = useGridCrud(config, dicts, rows, fetchRows, showToast, onRefreshDicts)

  const {
    statsEnabled, toggleStats,
    selectedIds, setSelectedIds,
    selectAll, clearSelection, toggleRow,
    stats,
  } = useGridStats(config, resultRows)

  const {
    uploading, importErrors, setImportErrors,
    fileInputRef,
    downloadTemplate, triggerUpload, handleFileSelect,
  } = useXlsxImport(config, dicts, fetchRows, showToast, onRefreshDicts)

  const { exportToExcel } = useExcelExport(config, dicts, resultRows, viewMode, showToast)

  // ─── AG Grid 列定义 ───

  const columnDefs = useMemo<AgColDef[]>(() => {
    return buildAgColumnDefs(config.cols, config, dicts, statsEnabled).map(col => col.editable ? {
      ...col, editable: (params: any) => !saving && editingId === gridRowKey(config, params.data),
    } : col)
  }, [config, dicts, statsEnabled, saving, editingId])

  const recoveryScope = JSON.stringify([config.table, config.filterField, config.filterValue, viewMode])
  const { recovery, clear: clearRecovery, flush: flushRecovery, storageError } = useGridRecovery(recoveryScope, getDraft)
  React.useEffect(() => { flushRecovery() }, [editBuf, newRow, flushRecovery])
  // ─── Shared editing session; presentation may change without unmounting its values. ───
  const captureOnResize = useRef<() => void>(() => {})
  const [touch, setTouch] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [detail, setDetail] = useState<any>(null)
  const [pending, setPending] = useState<{ label: string; action: () => void } | null>(null)
  const pendingRef = useRef<typeof pending>(null)
  const { register } = useAdminEditProtection()
  const guardKey = useRef(Symbol('grid-edit'))
  React.useEffect(() => {
    const pointer = window.matchMedia('(pointer: coarse)')
    const updatePointer = () => setTouch(pointer.matches)
    updatePointer(); pointer.addEventListener('change', updatePointer)
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => { captureOnResize.current(); setMobile(media.matches) }
    update(); media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update); pointer.removeEventListener('change', updatePointer) }
  }, [])
  const rowKey = useCallback((row: any) => gridRowKey(config, row), [config])
  const captureInput = useCallback(() => {
    if (!editingId || mobile) return
    const api = gridApiRef.current
    api?.stopEditing(false)
    const row = api?.getRowNode(editingId)?.data
    if (row) forceSyncBuf(copyRecord(row))
  }, [editingId, mobile, forceSyncBuf])
  React.useLayoutEffect(() => { captureOnResize.current = captureInput }, [captureInput])
  const restoreRow = useCallback(() => {
    if (!editingId) return
    const snapshot = copyRecord(editingOriginalRef.current)
    gridApiRef.current?.stopEditing(true)
    gridApiRef.current?.getRowNode(editingId)?.setData(copyRecord(snapshot))
    setRows(previous => previous.map(row => rowKey(row) === editingId ? copyRecord(snapshot) : row))
  }, [editingId, editingOriginalRef, rowKey, setRows])
  const discard = useCallback(() => {
    if (savingRef.current) return
    if (editingId || adding) clearRecovery()
    restoreRow(); rawCancelEdit(); cancelAdd(); setDetail(null)
  }, [restoreRow, rawCancelEdit, cancelAdd, savingRef, editingId, adding, clearRecovery])
  const requestAction = useCallback((label: string, action: () => void) => {
    if (savingRef.current || pendingRef.current) return
    captureInput()
    if ((editingId || adding) && isDirty()) {
      const next = { label, action }
      pendingRef.current = next; setPending(next)
    } else { discard(); action() }
  }, [captureInput, editingId, adding, isDirty, discard, savingRef])
  const closeConfirmation = useCallback(() => { pendingRef.current = null; setPending(null) }, [])
  const handleStartEdit = useCallback((row: any) => {
    if (editingId === rowKey(row)) return
    requestAction('切换编辑记录', () => { startEdit(row); setDetail(null) })
  }, [editingId, rowKey, requestAction, startEdit])
  React.useEffect(() => {
    if (!editingId || mobile || !active || saving) return
    const frame = window.requestAnimationFrame(() => {
      const node = gridApiRef.current?.getRowNode(editingId)
      const editable = config.cols.find(col => !col.hidden && !col.readOnly && !col.sourceKey && col.type !== 'jsonb')
      if (node?.rowIndex != null && editable) gridApiRef.current?.startEditingCell({ rowIndex: node.rowIndex, colKey: editable.key })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editingId, mobile, active, config.cols, saving])
  const handleCancelEdit = useCallback(() => requestAction('关闭编辑', () => {}), [requestAction])
  const handleSaveEdit = useCallback(async () => {
    captureInput()
    const saved = adding ? await saveAdd() : await rawSaveEdit()
    if (saved) { clearRecovery(); setDetail(null) }
    return saved
  }, [captureInput, adding, saveAdd, rawSaveEdit, clearRecovery])
  const navigationCancelRef = useRef<(() => void) | null>(null)
  const navigationRef = useRef<() => Promise<boolean>>(async () => true)
  React.useLayoutEffect(() => { navigationRef.current = () => new Promise(resolve => {
    if (savingRef.current || pendingRef.current) { resolve(false); return }
    captureInput()
    if (!(editingId || adding) || !isDirty()) { discard(); resolve(true); return }
    const next = { label: '离开当前工作区', action: () => resolve(true) }
    // Cancel must resolve the navigation promise as well as dismiss the child dialog.
    const cancel = () => resolve(false)
    navigationCancelRef.current = cancel
    pendingRef.current = next; setPending(next)
  }) }, [captureInput, editingId, adding, isDirty, discard, savingRef])
  React.useEffect(() => register(guardKey.current, () => navigationRef.current()), [register])
  React.useEffect(() => () => { navigationCancelRef.current?.() }, [])
  React.useEffect(() => {
    onDraftChange?.(Boolean((editingId || adding) && isDirty()))
  }, [editBuf, newRow, editingId, adding, isDirty, onDraftChange])
  const unloadRef = useRef<() => boolean>(() => false)
  React.useLayoutEffect(() => { unloadRef.current = () => {
    captureInput()
    return savingRef.current || Boolean((editingId || adding) && isDirty())
  } }, [captureInput, savingRef, editingId, adding, isDirty])
  React.useLayoutEffect(() => () => { captureOnResize.current(); flushRecovery() }, [flushRecovery])
  React.useEffect(() => {
    const stash = () => { captureOnResize.current(); flushRecovery() }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unloadRef.current()) { flushRecovery(); event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', stash)
    return () => { stash(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', stash) }
  }, [flushRecovery])
  React.useEffect(() => {
    if (!saveError) return
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  }, [saveError, fieldErrors])

  // ─── AG Grid context ───

  const gridContext = useMemo(() => ({
    dicts,
    config,
    isDemo,
    startEdit: handleStartEdit,
    deleteRow: (id: string, name?: string, rowData?: any) => {
      requestAction('删除记录', () => { void deleteRow(id, name, rowData) })
    },
    handleSpecialAction: (action: any, row: any) => requestAction(action.label, () => { void handleSpecialAction(action, row) }),
    rowKey,
    fetchHistory: (row: any) => {
      if (row.building_id && row.record_year && row.record_quarter) {
        setHistoryModal({
          buildingId: row.building_id,
          year: row.record_year,
          quarter: row.record_quarter,
        })
      }
    },
    editingId,
    saving,
    actionLoading,
    saveEdit: handleSaveEdit,
    cancelEdit: handleCancelEdit,
    requestUnlock: (row: any) => requestAction('解锁编辑', () => {
      const buildingName = dicts.buildings?.[row.building_id]
      setUnlockTarget({ ...row, _displayName: buildingName })
    }),
  }), [dicts, config, isDemo, handleStartEdit, deleteRow, handleSpecialAction, editingId, saving, actionLoading, handleSaveEdit, handleCancelEdit, rowKey, requestAction])

  // ─── AG Grid 事件 ───

  const onGridReady = useCallback((params: any) => {
    if (!mountedRef.current) return
    gridApiRef.current = params.api
    setGridApi(params.api)
  }, [])

  const onSelectionChanged = useCallback(() => {
    if (!mountedRef.current || !gridApi || !statsEnabled) return
    try {
      const selected = gridApi.getSelectedRows()
      setSelectedIds(new Set<string>(selected.map((r: any) => rowKey(r))))
    } catch (e) {
      // 忽略组件卸载后的调用
    }
  }, [gridApi, statsEnabled, setSelectedIds, rowKey])

  // 单元格值变更 → 同步到 editBuf
  const onCellValueChanged = useCallback((params: any) => {
    if (!mountedRef.current) return
    if (editingId && params.data) {
      const rowId = rowKey(params.data)
      if (rowId === editingId) {
        setEditBuf((prev: any) => ({ ...prev, [params.colDef.field]: params.newValue }))
      }
    }
  }, [editingId, setEditBuf, rowKey])

  // ─── 统计模式 ───

  React.useEffect(() => {
    if (!mountedRef.current || !gridApi || !statsEnabled) return
    try {
      gridApi.forEachNode((node: any) => {
        if (node.data) node.setSelected(selectedIds.has(rowKey(node.data)))
      })
    } catch (e) {
      // 忽略组件卸载后的调用
    }
  }, [gridApi, selectedIds, statsEnabled, rowKey])

  const gridRows = useMemo(() => filtered.map(row => editingId === rowKey(row) ? { ...row, ...editBuf } : row), [filtered, editingId, rowKey, editBuf])
  const syncModelRows = useCallback(() => {
    const next: string[] = []
    gridApiRef.current?.forEachNodeAfterFilterAndSort(node => { if (node.id) next.push(node.id) })
    if (mountedRef.current) setModelKeys(previous => previous?.length === next.length && previous.every((key, index) => key === next[index]) ? previous : next)
  }, [])
  React.useEffect(() => { gridApiRef.current?.refreshCells({ force: true }) }, [editingId, saving])

  // ─── 渲染 ───

  return (
    <div className="admin-grid-workspace flex h-full min-h-0 w-full flex-col relative">
      <div className="flex min-h-0 flex-1 flex-col" inert={pending || (mobile && (adding || editingId || detail)) ? true : undefined}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[70] px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
          toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* 导入错误弹窗 */}
      {importErrors.length > 0 && (
        <ImportErrorsModal errors={importErrors} onClose={() => setImportErrors([])} />
      )}

      {/* 工具栏 */}
      <TableToolbar
        config={config}
        search={search}
        onSearchChange={value => requestAction('应用搜索条件', () => setSearch(value))}
        totalRows={rows.length}
        filteredRows={resultRows.length}
        showInactive={showInactive}
        onToggleInactive={() => requestAction('切换项目范围', () => setShowInactive(!showInactive))}
        statsEnabled={statsEnabled}
        onToggleStats={toggleStats}
        viewMode={viewMode}
        onViewModeChange={value => requestAction('切换数据视图', () => setViewMode(value))}
        onRefresh={() => requestAction('刷新记录', () => { void fetchRows(true) })}
        onExport={exportToExcel}
        onDownloadTemplate={downloadTemplate}
        onTriggerUpload={() => {
          captureInput()
          if ((editingId || adding) && isDirty()) requestAction('导入记录', () => setUploadReady(true))
          else requestAction('导入记录', () => { setUploadReady(false); triggerUpload() })
        }}
        onAdd={() => requestAction('新增记录', startAdd)}
        onOpenDiag={() => setDiagOpen(true)}
        onOpenUploadGuide={() => setUploadGuideOpen(true)}
        uploading={uploading}
        onLockManager={config.table === 'building_metrics' ? () => requestAction('管理锁定', () => setLockModalOpen(true)) : undefined}
      />


      {uploadReady && <p role="status" className="mb-2 p-2 text-sm">编辑内容已处理，请点击“上传”选择文件。</p>}
      {recovery && !editingId && !adding && <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-[var(--cd-color-border)] p-3 text-sm"><span>此数据表有未保存的暂存内容。</span><Button variant="secondary" className="min-h-11" disabled={loading} onClick={() => {
        if (recovery.kind === 'add') { startAdd(); setNewRow(recovery.values); return }
        const current = rows.find(row => rowKey(row) === rowKey(recovery.original))
        if (!current || recordIsDirty(config, recovery.original, current)) { setDetail(recovery.values); showToast('原记录已变化，暂存内容保留供核对，请按最新记录重新编辑', false); return }
        startEdit(current); setEditBuf(recovery.values)
      }}>恢复暂存</Button><Button variant="secondary" className="min-h-11" onClick={clearRecovery}>放弃暂存</Button></div>}
      {storageError && (editingId || adding) && <p role="alert" className="p-2 text-sm text-[var(--cd-color-danger)]">暂存不可用，请保存后再离开当前页面。</p>}
      {(loadError || refreshFailed) && <div role="alert" className="mb-2 rounded border border-[var(--cd-color-border)] p-3 text-sm">{refreshFailed ? '已保存，列表刷新失败。' : `读取失败：${loadError}。保留上次已读取的记录。`}<Button variant="secondary" onClick={() => requestAction('刷新记录', () => { void fetchRows(true) })} className="ml-2 min-h-11">重试刷新</Button></div>}
      {saveError && !mobile && <p role="alert" className="p-2 text-sm text-[var(--cd-color-danger)]">{saveError}</p>}
      <details className="mb-2 sm:hidden"><summary className="flex min-h-11 cursor-pointer items-center text-sm text-[var(--cd-color-brand)]">字段筛选</summary><div className="grid gap-3 pb-3">{config.cols.filter(col => !col.hidden).map(col => <label key={col.key} className="text-sm">{col.label}{col.displayMap || col.type === 'boolean' ? <select aria-label={`筛选${col.label}`} className="grid-record-input mt-1" value={columnFilters[col.key] ?? ''} onChange={event => { const value = event.target.value; requestAction('应用字段筛选', () => setColumnFilter(col.key, value)) }}><option value="">全部</option>{Object.entries(col.displayMap ?? { true: '是', false: '否' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <input aria-label={`筛选${col.label}`} className="grid-record-input mt-1" inputMode={col.type === 'number' ? 'decimal' : undefined} value={columnFilters[col.key] ?? ''} onChange={event => { const value = event.target.value; requestAction('应用字段筛选', () => setColumnFilter(col.key, value)) }} />}</label>)}<Button variant="secondary" onClick={() => requestAction('清除筛选', clearAllFilters)}>清除筛选</Button></div></details>
      {mobile && <label className="mb-2 flex items-center gap-2 text-sm">排序<select className="grid-record-input min-w-0 flex-1" defaultValue="" onChange={event => { const [colId, sort] = event.target.value.split(':'); gridApiRef.current?.applyColumnState({ defaultState: { sort: null }, state: colId ? [{ colId, sort: sort as 'asc' | 'desc' }] : [] }) }}><option value="">原始顺序</option>{config.cols.filter(col => !col.hidden && !['textarea', 'jsonb'].includes(col.type)).flatMap(col => [<option key={`${col.key}:asc`} value={`${col.key}:asc`}>{col.label} 升序</option>, <option key={`${col.key}:desc`} value={`${col.key}:desc`}>{col.label} 降序</option>])}</select></label>}
      {/* 统计结果栏 */}
      {statsEnabled && config.statsMode && (
        <StatsBar
          stats={stats ?? []}
          selectedCount={selectedIds.size}
          totalCount={resultRows.length}
          onSelectAll={selectAll}
          onClear={clearSelection}
        />
      )}

      {/* 新增行表单 */}
      {adding && !mobile && (
        <AddRowForm
          config={config}
          errors={fieldErrors}
          newRow={newRow}
          onChange={setNewRow}
          onSave={() => { void handleSaveEdit() }}
          onCancel={handleCancelEdit}
          saving={saving}
          dicts={dicts}
        />
      )}

      {mobile && <MobileRecordList rows={resultRows} config={config} dicts={dicts} context={gridContext} onOpen={row => requestAction('查看记录', () => setDetail(row))} selected={selectedIds} onToggle={toggleRow} statsEnabled={statsEnabled} loading={loading} loadError={loadError} />}
      {/* Keep a single grid alive across presentation changes, preserving desktop sort/filter state. */}
      <div style={{ display: mobile ? 'none' : undefined }} className="flex-1 min-h-0 grid-panel-container">
        <div className="w-full h-full">
          <AgGridReact
            ref={gridRef}
            theme={myTheme}
            loading={loading}
            rowHeight={touch ? 48 : undefined}
            headerHeight={touch ? 48 : undefined}
            localeText={AG_GRID_LOCALE_ZH}
            rowData={gridRows}
            columnDefs={columnDefs}
            components={FRAMEWORK_COMPONENTS}
            context={gridContext}
            onGridReady={onGridReady}
            onSelectionChanged={onSelectionChanged}
            onCellValueChanged={onCellValueChanged}
            onModelUpdated={syncModelRows}
            onCellEditingStarted={() => onDraftChange?.(true)}
            onCellDoubleClicked={(params: any) => { if (params.colDef.editable && !params.data?.is_locked) handleStartEdit(params.data) }}
            onFilterOpened={() => { if (editingId) requestAction('使用列筛选', () => {}) }}
            rowSelection={statsEnabled ? { mode: 'multiRow', enableClickSelection: false } : undefined}
            selectionColumnDef={{ pinned: 'left', width: 50, minWidth: 50, maxWidth: 50 }}
            animateRows={true}
            editType="fullRow"
            singleClickEdit={false}
            stopEditingWhenCellsLoseFocus={true}
            // user_roles 以 user_id 为主键；必须使用稳定行 ID，不能在渲染时生成随机值。
            // 否则 AG Grid 无法维护用户管理表的行状态，可能导致页面空白或卡死。
            getRowId={(params: any) => rowKey(params.data)}
            overlayLoadingTemplate='<span class="ag-overlay-loading-center">加载中...</span>'
            overlayNoRowsTemplate={loadError ? '<span class="ag-overlay-no-rows-center">读取失败，请重试</span>' : '<span class="ag-overlay-no-rows-center">暂无数据</span>'}
            defaultColDef={{
              resizable: true,
              sortable: true,
              filter: true,
              floatingFilter: false,
              minWidth: 100,
              flex: 0,
            }}
            suppressCellFocus={false}
            enableCellTextSelection={true}
            ensureDomOrder={true}
            tooltipShowDelay={300}
            tooltipHideDelay={100}
            suppressColumnVirtualisation={false}
            suppressRowVirtualisation={false}
            rowBuffer={10}
            debounceVerticalScrollbar={false}
            alwaysShowVerticalScroll={false}
            suppressHorizontalScroll={false}
          />
        </div>
      </div>

      {/* 隐藏的文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileSelect}
        className="hidden"
      />

      </div>
      <Dialog open={Boolean(active && mobile && (adding || editingId || detail))} onOpenChange={open => { if (!open) requestAction('关闭编辑', () => setDetail(null)) }} title={adding ? '新增记录' : editingId ? '编辑记录' : '完整详情'} presentation="fullscreen" inactive={Boolean(pending)} dismissible={!saving}
        footer={<><Button variant="secondary" onClick={() => requestAction('关闭编辑', () => setDetail(null))} disabled={saving} className="min-h-11">{detail ? '关闭' : '取消'}</Button>{!detail && <Button onClick={() => { void handleSaveEdit() }} disabled={saving} className="min-h-11">{saving ? '保存中…' : '保存'}</Button>}</>}>
        <p className="mb-4 text-sm font-medium">{config.label}</p>
        {saveError && <p role="alert" className="mb-3 text-sm text-[var(--cd-color-danger)]">{saveError}</p>}
        <fieldset disabled={saving} className="min-w-0"><RecordFields config={config} values={detail ?? (adding ? newRow : editBuf)} onChange={detail ? undefined : adding ? setNewRow : setEditBuf} adding={adding} dicts={dicts} errors={fieldErrors} disabled={saving} isDemo={isDemo} /></fieldset>
      </Dialog>
      <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open) { navigationCancelRef.current?.(); navigationCancelRef.current = null; closeConfirmation() } }} title="未保存的修改" layer="child" dismissible={!saving} footer={<>
        <Button variant="secondary" disabled={saving} className="min-h-11" onClick={() => { navigationCancelRef.current?.(); navigationCancelRef.current = null; closeConfirmation() }}>继续编辑</Button>
        <Button variant="danger" disabled={saving} className="min-h-11" onClick={() => { const action = pendingRef.current?.action; navigationCancelRef.current = null; closeConfirmation(); discard(); action?.() }}>放弃修改并继续</Button>
        <Button disabled={saving} className="min-h-11" onClick={async () => { if (await handleSaveEdit()) { const action = pendingRef.current?.action; navigationCancelRef.current = null; closeConfirmation(); action?.() } }}>保存并继续</Button>
      </>}><p className="text-sm">{config.label}有未保存内容。{pending?.label}前，请选择如何处理。</p>{saveError && <p role="alert" className="mt-3 text-sm text-[var(--cd-color-danger)]">{saveError}</p>}</Dialog>
      {/* 单行解锁确认弹窗 */}
      {unlockTarget && (
        <UnlockConfirmModal
          row={unlockTarget}
          onConfirm={async () => {
            const targetKey = rowKey(unlockTarget)
            setUnlockTarget(null)
            if (await fetchRows()) {
              const current = getLatestRows().find(row => rowKey(row) === targetKey)
              if (current && !current.is_locked) handleStartEdit(current)
              else showToast('已解锁，请刷新后重新定位记录', false)
            }
          }}
          onCancel={() => setUnlockTarget(null)}
        />
      )}

      {/* 锁定管理弹窗 */}
      {lockModalOpen && (
        <LockManagerModal
          onClose={() => setLockModalOpen(false)}
          onSuccess={() => fetchRows()}
        />
      )}

      {/* 历史记录弹窗 */}
      {historyModal && (
        <HistoryModal
          buildingId={historyModal.buildingId}
          year={historyModal.year}
          quarter={historyModal.quarter}
          dicts={dicts}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {/* 数据库说明弹窗 */}
      {diagOpen && (
        <DataDiagnosticModal config={config} rows={rows} onClose={() => setDiagOpen(false)} />
      )}

      {/* 上传说明弹窗 */}
      {uploadGuideOpen && config.uploadMatchKeys && (
        <UploadGuideModal config={config} onClose={() => setUploadGuideOpen(false)} />
      )}
    </div>
  )
}
