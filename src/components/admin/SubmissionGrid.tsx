'use client'
import React, { useMemo, useCallback, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import type { ColDef as AgColDef, GridApi } from 'ag-grid-community'

ModuleRegistry.registerModules([AllCommunityModule])

const submissionTheme = themeQuartz.withParams({
  backgroundColor: '#ffffff',
  foregroundColor: '#374151',
  headerBackgroundColor: '#f9fafb',
  headerTextColor: '#6b7280',
  borderColor: '#e5e7eb',
  rowHoverColor: '#f9fafb',
  fontSize: 13,
  rowHeight: 40,
  headerHeight: 44,
})

// 进度条渲染器
function ProgressRenderer(params: any) {
  const value = Number(params.value) || 0
  const color = value >= 100 ? '#10b981' : value > 0 ? '#f59e0b' : '#e5e7eb'
  return (
    <div className="flex items-center gap-2 h-full w-full pr-4">
      <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden max-w-[80px]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }} />
      </div>
      <span className={`text-xs font-semibold ${value >= 100 ? 'text-emerald-600' : value > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
        {value}%
      </span>
    </div>
  )
}

// 日期渲染器
function DateRenderer(params: any) {
  if (!params.value) return <span className="text-zinc-400">-</span>
  return <span className="text-zinc-600">{new Date(params.value).toLocaleString('zh-CN', { hour12: false })}</span>
}

// 状态标签渲染器
function BadgeRenderer(params: any) {
  const { value, colorMap } = params.colDef.cellRendererParams || {}
  if (!params.value) return <span className="text-zinc-400">-</span>
  const cls = colorMap?.[params.value] || 'bg-zinc-100 text-zinc-600'
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${cls}`}>{params.value}</span>
}

interface SubmissionGridProps {
  columns: AgColDef[]
  data: any[]
  loading?: boolean
  emptyMessage?: string
  className?: string
  enableSelection?: boolean
  onSelectionChanged?: (selected: any[]) => void
}

export function SubmissionGrid({
  columns,
  data,
  loading = false,
  emptyMessage = '暂无数据',
  className = '',
  enableSelection = false,
  onSelectionChanged,
}: SubmissionGridProps) {
  const gridRef = useRef<AgGridReact>(null)
  const [gridApi, setGridApi] = React.useState<GridApi | null>(null)

  const onGridReady = useCallback((params: any) => setGridApi(params.api), [])

  const defaultColDef = useMemo(() => ({
    resizable: true,
    sortable: true,
    filter: false,
    minWidth: 80,
  }), [])

  const rowSelection = useMemo(() => {
    if (!enableSelection) return undefined
    return { mode: 'multiRow' as const, enableClickSelection: false }
  }, [enableSelection])

  return (
    <div className={`w-full h-full min-h-[200px] ${className}`}>
      <AgGridReact
        ref={gridRef}
        theme={submissionTheme}
        rowData={data}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        animateRows={true}
        rowSelection={rowSelection}
        onSelectionChanged={onSelectionChanged ? () => {
          if (gridApi) onSelectionChanged(gridApi.getSelectedRows())
        } : undefined}
        getRowId={(params: any) => params.data?.id ?? `_${Math.random().toString(36).slice(2, 9)}`}
        overlayNoRowsTemplate={`<span style="color: #9ca3af; font-size: 14px;">${emptyMessage}</span>`}
      />
    </div>
  )
}

export { ProgressRenderer, DateRenderer, BadgeRenderer }
