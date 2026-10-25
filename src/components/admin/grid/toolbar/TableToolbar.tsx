'use client'
import React from 'react'
import type { TableConfig } from '../../types'
import { Badge, Button, Input } from '@/src/components/ui'

interface TableToolbarProps {
  config: TableConfig
  search: string
  onSearchChange: (v: string) => void
  totalRows: number
  filteredRows: number
  showInactive: boolean
  onToggleInactive: () => void
  statsEnabled: boolean
  onToggleStats: () => void
  viewMode: string
  onViewModeChange: (key: string) => void
  onRefresh: () => void
  onExport: () => void
  onDownloadTemplate: () => void
  onTriggerUpload: () => void
  onAdd: () => void
  onOpenDiag: () => void
  onOpenUploadGuide: () => void
  uploading: boolean
  onLockManager?: () => void
}

export function TableToolbar({
  config, search, onSearchChange,
  totalRows, filteredRows,
  showInactive, onToggleInactive,
  statsEnabled, onToggleStats,
  viewMode, onViewModeChange,
  onRefresh, onExport, onDownloadTemplate, onTriggerUpload, onAdd,
  onOpenDiag, onOpenUploadGuide,
  uploading, onLockManager,
}: TableToolbarProps) {
  return (
    <div className="grid-table-toolbar flex items-center gap-3 flex-wrap py-3 px-1">
      {/* 搜索框 */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <Input
          type="text"
          placeholder="搜索"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="w-56 pl-9"
        />
      </div>

      {/* 记录计数 */}
      <Badge className="gap-1.5">
        <svg className="w-3.5 h-3.5 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-medium text-zinc-600">
          {filteredRows === totalRows ? `${totalRows} 条` : `${filteredRows} / ${totalRows} 条`}
        </span>
      </Badge>

      {/* 显示未启用楼宇 */}
      {config.showInactiveFilter && (
        <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={onToggleInactive}
            className="w-4 h-4 rounded border-zinc-300 accent-[#003e7e]"
          />
          显示未启用楼宇
        </label>
      )}

      {/* 统计模式 */}
      {config.statsMode && (
        <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={statsEnabled}
            onChange={onToggleStats}
            className="w-4 h-4 rounded border-zinc-300 accent-[#003e7e]"
          />
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          统计模式
        </label>
      )}

      {/* 视图模式切换 */}
      {config.viewMode?.enabled && (
        <div className="flex items-center gap-1 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)] p-0.5">
          {config.viewMode.views.map(v => (
            <button
              key={v.key}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                viewMode === v.key
                  ? 'border border-[var(--cd-color-border)] bg-white text-[var(--cd-color-brand)] font-medium'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
              onClick={() => onViewModeChange(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* 右侧按钮组 */}
      <div className="grid-table-actions ml-auto flex items-center gap-2">
        {/* 工具栏额外按钮 */}
        {config.toolbarExtra?.map(action => (
          <button
            key={action.key}
            className="grid-action-btn"
            onClick={action.handler}
          >
            {action.label}
          </button>
        ))}

        <button
          className="grid-action-btn"
          onClick={onExport}
          title="导出Excel"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          导出
        </button>

        <button
          className="grid-action-btn"
          onClick={onOpenDiag}
          title="数据库说明"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          说明
        </button>

        {config.uploadMatchKeys && (
          <button
            className="grid-action-btn"
            onClick={onOpenUploadGuide}
            title="上传说明"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            上传说明
          </button>
        )}

        <button
          className="grid-action-btn"
          onClick={onRefresh}
          title="刷新数据"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          刷新
        </button>

        {onLockManager && (
          <button
            className="grid-action-btn text-red-600 hover:bg-red-50"
            onClick={onLockManager}
            title="季度数据锁定管理"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            锁定管理
          </button>
        )}

        {!config.hideTemplate && (
          <button
            className="grid-action-btn"
            onClick={onDownloadTemplate}
            title="下载XLSX模板"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            模板
          </button>
        )}

        {!config.hideUpload && (
          <button
            className="grid-action-btn"
            onClick={onTriggerUpload}
            disabled={uploading}
            title="批量上传XLSX"
          >
            {uploading ? (
              <span className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-2 border-current border-t-transparent" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            )}
            {uploading ? '导入中' : '上传'}
          </button>
        )}

        <div className="w-px h-6 bg-zinc-200 mx-1" />

        {!config.hideAdd && (
          <Button
            size="sm"
            onClick={onAdd}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新增
          </Button>
        )}
      </div>
    </div>
  )
}
