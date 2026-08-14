'use client'
import React, { useState, useMemo, useCallback, useRef } from 'react'
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
  headerForegroundColor: '#6b7280',
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
  noRowsToShow: '暂无数据',
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
}

export function GridPanel({ config, dicts = {}, onRefreshDicts }: GridPanelProps) {
  const gridRef = useRef<AgGridReact>(null)
  const gridApiRef = useRef<GridApi | null>(null)
  const [gridApi, setGridApi] = useState<GridApi | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [diagOpen, setDiagOpen] = useState(false)
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false)
  const [historyModal, setHistoryModal] = useState<{ buildingId: string; year: number; quarter: number } | null>(null)
  const [lockModalOpen, setLockModalOpen] = useState(false)
  const [unlockTarget, setUnlockTarget] = useState<any>(null)
  const [originalRow, setOriginalRow] = useState<any>(null)
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

  const { rows, setRows, loading, fetchRows, viewMode, setViewMode } = useGridData(config, dicts, showToast)

  const {
    search, setSearch,
    columnFilters, setColumnFilter, clearColumnFilter, clearAllFilters,
    showInactive, setShowInactive,
    filtered, filterOptions,
  } = useGridFilters(rows, config, dicts)

  const {
    editingId, editBuf, setEditBuf,
    adding, newRow, setNewRow,
    saving, actionLoading,
    startEdit, cancelEdit: rawCancelEdit, saveEdit: rawSaveEdit,
    startAdd, cancelAdd, saveAdd,
    deleteRow, handleSpecialAction, forceSyncBuf,
  } = useGridCrud(config, dicts, rows, fetchRows, showToast, onRefreshDicts)

  const {
    statsEnabled, toggleStats,
    selectedIds, setSelectedIds,
    selectAll, clearSelection, toggleRow,
    stats,
  } = useGridStats(config, filtered)

  const {
    uploading, importErrors, setImportErrors,
    fileInputRef,
    downloadTemplate, triggerUpload, handleFileSelect,
  } = useXlsxImport(config, dicts, fetchRows, showToast, onRefreshDicts)

  const { exportToExcel } = useExcelExport(config, dicts, filtered, viewMode, showToast)

  // ─── AG Grid 列定义 ───

  const columnDefs = useMemo<AgColDef[]>(() => {
    return buildAgColumnDefs(config.cols, config, dicts, statsEnabled)
  }, [config.cols, config, dicts, statsEnabled])

  // ─── 编辑流程（AG Grid fullRow editing）───

  // 强制取消编辑（不恢复原始数据，用于筛选/刷新/切表场景）
  const forceCancelEdit = useCallback(() => {
    gridApiRef.current?.stopEditing(true)
    rawCancelEdit()
    setOriginalRow(null)
  }, [rawCancelEdit])

  // 切换表时清空所有筛选/统计/编辑状态
  React.useEffect(() => {
    setSearch('')
    clearAllFilters()
    setShowInactive(false)
    if (toggleStats && statsEnabled) toggleStats()
    cancelAdd()
    forceCancelEdit()
  }, [config.table])

  // 筛选结果变化时取消编辑（行可能被筛选掉导致编辑状态悬空）
  const prevFilteredRef = useRef(filtered)
  React.useEffect(() => {
    if (editingId && prevFilteredRef.current !== filtered) {
      const stillExists = filtered.some(r => (r.id || r.building_id) === editingId)
      if (!stillExists) {
        forceCancelEdit()
      }
      prevFilteredRef.current = filtered
    }
  }, [filtered, editingId, forceCancelEdit])

  const handleStartEdit = useCallback((row: any) => {
    // 如果正在新增，确认是否放弃
    if (adding) {
      if (!confirm('当前有未保存的新增记录，是否放弃？')) return
      cancelAdd()
    }
    // 如果正在编辑其他行，先取消
    if (editingId) {
      forceCancelEdit()
    }
    setOriginalRow({ ...row })
    startEdit(row)
    // 启动 AG Grid 行编辑（用 ref 避免闭包过期）
    setTimeout(() => {
      const api = gridApiRef.current
      if (!api) return
      const rowId = row.id || row.building_id
      const rowNode = api.getRowNode(rowId)
      if (rowNode && rowNode.rowIndex != null) {
        api.startEditingCell({ rowIndex: rowNode.rowIndex, colKey: columnDefs[0]?.field ?? '' })
      }
    }, 50)
  }, [startEdit, columnDefs, editingId, forceCancelEdit])

  const handleCancelEdit = useCallback(() => {
    // 先停止 AG Grid 编辑，再恢复数据
    gridApiRef.current?.stopEditing(true)
    if (originalRow && gridApiRef.current) {
      const rowId = originalRow.id || originalRow.building_id
      const rowNode = gridApiRef.current.getRowNode(rowId)
      if (rowNode) {
        rowNode.setData({ ...originalRow })
        gridApiRef.current.refreshCells({ rowNodes: [rowNode], force: true })
      }
    }
    rawCancelEdit()
    setOriginalRow(null)
  }, [originalRow, rawCancelEdit])

  const handleSaveEdit = useCallback(async () => {
    // 停止 AG Grid 编辑，将当前单元格的值提交到行数据
    gridApiRef.current?.stopEditing(false)
    // 直接从 AG Grid 读取编辑后的行数据，同步写入 editBufRef（绕过 React 异步时序）
    if (editingId && gridApiRef.current) {
      const rowNode = gridApiRef.current.getRowNode(editingId)
      if (rowNode?.data) {
        forceSyncBuf(rowNode.data)
      }
    }
    await rawSaveEdit()
    setOriginalRow(null)
  }, [rawSaveEdit, editingId, forceSyncBuf])

  // ─── AG Grid context ───

  const gridContext = useMemo(() => ({
    dicts,
    config,
    isDemo,
    startEdit: handleStartEdit,
    deleteRow: (id: string, name?: string, rowData?: any) => {
      if (editingId === id) forceCancelEdit()
      return deleteRow(id, name, rowData)
    },
    handleSpecialAction,
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
    requestUnlock: (row: any) => {
      const buildingName = dicts.buildings?.[row.building_id]
      setUnlockTarget({ ...row, _displayName: buildingName })
    },
  }), [dicts, config, isDemo, handleStartEdit, deleteRow, handleSpecialAction, editingId, saving, actionLoading, handleSaveEdit, handleCancelEdit])

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
      setSelectedIds(new Set(selected.map((r: any) => r.id)))
    } catch (e) {
      // 忽略组件卸载后的调用
    }
  }, [gridApi, statsEnabled, setSelectedIds])

  // 单元格值变更 → 同步到 editBuf
  const onCellValueChanged = useCallback((params: any) => {
    if (!mountedRef.current) return
    if (editingId && params.data) {
      const rowId = params.data.id || params.data.building_id
      if (rowId === editingId) {
        setEditBuf((prev: any) => ({ ...prev, [params.colDef.field]: params.newValue }))
      }
    }
  }, [editingId, setEditBuf])

  // ─── 统计模式 ───

  React.useEffect(() => {
    if (!mountedRef.current || !gridApi) return
    try {
      if (statsEnabled) {
        gridApi.setGridOption('rowSelection', 'multiple')
      } else {
        gridApi.setGridOption('rowSelection', undefined)
        gridApi.deselectAll()
      }
    } catch (e) {
      // 忽略组件卸载后的调用
    }
  }, [gridApi, statsEnabled])

  React.useEffect(() => {
    if (!mountedRef.current || !gridApi || !statsEnabled) return
    try {
      gridApi.forEachNode((node: any) => {
        if (node.data) node.setSelected(selectedIds.has(node.data.id))
      })
    } catch (e) {
      // 忽略组件卸载后的调用
    }
  }, [gridApi, selectedIds, statsEnabled])

  // ─── 渲染 ───

  return (
    <div className="flex flex-col h-full w-full relative">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-2 rounded-md text-sm font-medium shadow-lg ${
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
        onSearchChange={setSearch}
        totalRows={rows.length}
        filteredRows={filtered.length}
        showInactive={showInactive}
        onToggleInactive={() => setShowInactive(!showInactive)}
        statsEnabled={statsEnabled}
        onToggleStats={toggleStats}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={() => { forceCancelEdit(); fetchRows(true) }}
        onExport={exportToExcel}
        onDownloadTemplate={downloadTemplate}
        onTriggerUpload={triggerUpload}
        onAdd={startAdd}
        onOpenDiag={() => setDiagOpen(true)}
        onOpenUploadGuide={() => setUploadGuideOpen(true)}
        uploading={uploading}
        onLockManager={config.table === 'building_metrics' ? () => setLockModalOpen(true) : undefined}
      />


      {/* 统计结果栏 */}
      {statsEnabled && stats && (
        <StatsBar
          stats={stats}
          selectedCount={selectedIds.size}
          totalCount={filtered.length}
          onSelectAll={selectAll}
          onClear={clearSelection}
        />
      )}

      {/* 新增行表单 */}
      {adding && (
        <AddRowForm
          cols={config.cols}
          newRow={newRow}
          onChange={setNewRow}
          onSave={saveAdd}
          onCancel={cancelAdd}
          saving={saving}
          dicts={dicts}
        />
      )}

      {/* AG Grid */}
      <div className="flex-1 min-h-0 grid-panel-container">
        <div className="w-full h-full">
          <AgGridReact
            ref={gridRef}
            // Theming API 不会替 AgGridReact 根节点继承 flex 高度；显式约束避免出现“数据已加载但网格白屏”。
            style={{ width: '100%', height: '100%' }}
            theme={myTheme}
            localeText={AG_GRID_LOCALE_ZH}
            rowData={filtered}
            columnDefs={columnDefs}
            components={FRAMEWORK_COMPONENTS}
            context={gridContext}
            onGridReady={onGridReady}
            onSelectionChanged={onSelectionChanged}
            onCellValueChanged={onCellValueChanged}
            rowSelection={statsEnabled ? { mode: 'multiRow', enableClickSelection: false, checkboxes: false } : undefined}
            animateRows={true}
            editType="fullRow"
            singleClickEdit={false}
            stopEditingWhenCellsLoseFocus={true}
            // user_roles 以 user_id 为主键；必须使用稳定行 ID，不能在渲染时生成随机值。
            // 否则 AG Grid 无法维护用户管理表的行状态，可能导致页面空白或卡死。
            getRowId={(params: any) => params.data?.id || params.data?.building_id || params.data?.user_id || `_${Math.random().toString(36).slice(2, 9)}`}
            overlayLoadingTemplate='<span class="ag-overlay-loading-center">加载中...</span>'
            overlayNoRowsTemplate='<span class="ag-overlay-no-rows-center">暂无数据</span>'
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

      {/* 单行解锁确认弹窗 */}
      {unlockTarget && (
        <UnlockConfirmModal
          row={unlockTarget}
          onConfirm={() => {
            const row = unlockTarget
            setUnlockTarget(null)
            // 刷新数据以更新 is_locked 状态，然后进入编辑
            fetchRows().then(() => {
              handleStartEdit({ ...row, is_locked: false })
            })
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
