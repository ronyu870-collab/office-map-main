'use client'
import React, { useMemo, useCallback, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import type { ColDef as AgColDef, GridApi } from 'ag-grid-community'

// AG Grid v35 要求显式注册模块
ModuleRegistry.registerModules([AllCommunityModule])

// 自定义主题
const adminTheme = themeQuartz.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#374151',
  headerBackgroundColor: '#f9fafb',
  headerForegroundColor: '#6b7280',
  borderColor: '#e5e7eb',
  rowHoverColor: '#f9fafb',
  selectedRowBackgroundColor: '#eff6ff',
  fontSize: 13,
  rowHeight: 40,
  headerHeight: 44,
})

// 操作按钮渲染器
function ActionCellRenderer(params: any) {
  const { actions, data, context } = params
  if (!actions || !data) return null

  return (
    <div className="flex items-center gap-1.5 h-full px-1">
      {actions.map((action: any, idx: number) => {
        if (action.condition && !action.condition(data)) return null
        return (
          <button
            key={idx}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
              action.variant === 'primary'
                ? 'bg-[#003e7e] text-white hover:bg-[#002d5e]'
                : action.variant === 'danger'
                ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
            }`}
            onClick={() => action.onClick?.(data)}
            disabled={action.disabled?.(data)}
          >
            {action.icon && <span className="w-3.5 h-3.5">{action.icon}</span>}
            {action.label}
          </button>
        )
      })}
    </div>
  )
}

// 进度条渲染器
function ProgressRenderer(params: any) {
  const { value, color = '#003e7e' } = params
  const num = Number(value) || 0
  const bgColor = num >= 100 ? '#10b981' : num > 0 ? '#f59e0b' : '#e5e7eb'

  return (
    <div className="flex items-center gap-2 h-full w-full pr-4">
      <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, num)}%`, backgroundColor: bgColor }}
        />
      </div>
      <span className="text-xs font-medium text-zinc-600 w-10 text-right">{num}%</span>
    </div>
  )
}

// 状态标签渲染器
function StatusBadgeRenderer(params: any) {
  const { value, colorMap } = params
  if (!value) return <span className="text-zinc-400">-</span>

  const color = colorMap?.[value] || '#6b7280'
  const bgColors: Record<string, string> = {
    '#10b981': 'bg-emerald-50 text-emerald-700',
    '#f59e0b': 'bg-amber-50 text-amber-700',
    '#ef4444': 'bg-red-50 text-red-700',
    '#003e7e': 'bg-blue-50 text-blue-700',
  }
  const cls = bgColors[color] || 'bg-zinc-50 text-zinc-700'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${cls}`}>
      {value}
    </span>
  )
}

// 日期格式化
function DateCellRenderer(params: any) {
  const { value } = params
  if (!value) return <span className="text-zinc-400">-</span>

  const date = new Date(value)
  return (
    <span className="text-zinc-600">
      {date.toLocaleString('zh-CN', { hour12: false })}
    </span>
  )
}

interface AdminGridProps {
  columns: AgColDef[]
  data: any[]
  actions?: Array<{
    label: string
    onClick?: (row: any) => void
    variant?: 'default' | 'primary' | 'danger'
    icon?: React.ReactNode
    condition?: (row: any) => boolean
    disabled?: (row: any) => boolean
  }>
  loading?: boolean
  emptyMessage?: string
  onRowClick?: (row: any) => void
  className?: string
  rowHeight?: number
  headerHeight?: number
  enableSelection?: boolean
  onSelectionChanged?: (selectedRows: any[]) => void
}

export function AdminGrid({
  columns,
  data,
  actions,
  loading = false,
  emptyMessage = '暂无数据',
  onRowClick,
  className = '',
  rowHeight = 40,
  headerHeight = 44,
  enableSelection = false,
  onSelectionChanged,
}: AdminGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const [gridApi, setGridApi] = React.useState<GridApi | null>(null)

  const onGridReady = useCallback((params: any) => {
    setGridApi(params.api)
  }, [])

  // 添加操作列
  const columnDefs = useMemo<AgColDef[]>(() => {
    const cols = [...columns]

    if (actions && actions.length > 0) {
      cols.push({
        headerName: '操作',
        field: '__actions',
        width: actions.length * 80 + 40,
        pinned: 'right',
        sortable: false,
        filter: false,
        editable: false,
        resizable: false,
        cellRenderer: (params: any) => (
          <ActionCellRenderer
            {...params}
            actions={actions}
            data={params.data}
          />
        ),
      })
    }

    return cols
  }, [columns, actions])

  // 默认列定义
  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: false,
    minWidth: 80,
    flex: 0,
  }), [])

  // 行选择
  const rowSelection = useMemo(() => {
    if (!enableSelection) return undefined
    return { mode: 'multiRow' as const, enableClickSelection: false }
  }, [enableSelection])

  const onSelectionChangedHandler = useCallback(() => {
    if (!gridApi || !onSelectionChanged) return
    const selected = gridApi.getSelectedRows()
    onSelectionChanged(selected)
  }, [gridApi, onSelectionChanged])

  return (
    <div className={`w-full h-full min-h-[200px] ${className}`}>
      <AgGridReact
        ref={gridRef}
        theme={adminTheme}
        rowData={data}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        animateRows={true}
        rowSelection={rowSelection}
        onSelectionChanged={onSelectionChangedHandler}
        getRowId={(params: any) => params.data?.id ?? params.data?.user_id ?? `_${Math.random().toString(36).slice(2, 9)}`}
        overlayLoadingTemplate='<span style="color: #6b7280; font-size: 14px;">加载中...</span>'
        overlayNoRowsTemplate={`<span style="color: #9ca3af; font-size: 14px;">${emptyMessage}</span>`}
        onRowClicked={onRowClick ? (params) => onRowClick(params.data) : undefined}
      />
    </div>
  )
}

// 导出渲染器供外部使用
export { ProgressRenderer, StatusBadgeRenderer, DateCellRenderer, ActionCellRenderer }
