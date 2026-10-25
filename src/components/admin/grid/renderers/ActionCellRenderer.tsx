'use client'
import React from 'react'
import type { CustomCellRendererProps } from 'ag-grid-react'

/**
 * 操作列渲染器 — 编辑/删除/历史/特殊操作按钮
 * 通过 params.context 获取回调函数和配置
 */
export function ActionCellRenderer(params: CustomCellRendererProps) {
  const ctx = params.context
  if (!ctx) return null

  const { startEdit, deleteRow, handleSpecialAction, config, actionLoading, fetchHistory, editingId } = ctx
  const row = params.data
  if (!row) return null

  const isEditing = editingId != null && (editingId === ctx.rowKey?.(row) || (!ctx.rowKey && (editingId === row.id || editingId === row.building_id)))
  const isLoading = (key: string) => actionLoading === `${key}-${row.id}`

  // 所有列都是只读 → 不允许编辑
  const isAllReadOnly = config.cols?.every((c: any) => c.readOnly) ?? false

  // 编辑中：显示保存/取消
  if (isEditing) {
    return (
      <div className="flex items-center gap-1.5 px-1">
        <button
          className="grid-action-btn grid-action-btn-primary"
          onClick={() => ctx.saveEdit()}
          disabled={ctx.saving}
        >
          {ctx.saving ? (
            <span className="inline-block animate-spin rounded-full h-3 w-3 border-2 border-current border-t-transparent" />
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {ctx.saving ? '' : '保存'}
        </button>
        <button
          className="grid-action-btn"
          disabled={ctx.saving}
          onClick={() => ctx.cancelEdit()}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          取消
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 px-1">
      {/* 历史按钮 */}
      {config.supportsHistory && row.building_id && row.record_year && row.record_quarter && (
        <button
          className="grid-action-btn"
          onClick={() => fetchHistory(row)}
          title="查看历史"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          历史
        </button>
      )}

      {/* 编辑按钮：全只读表不显示 */}
      {!isAllReadOnly && (
        <button
          className={`grid-action-btn grid-action-btn-primary ${row.is_locked ? 'opacity-60' : ''}`}
          onClick={() => {
            if (row.is_locked && ctx.requestUnlock) {
              ctx.requestUnlock(row)
            } else {
              startEdit(row)
            }
          }}
          title={row.is_locked ? '此行已锁定，需先解锁才能编辑' : '编辑此行'}
        >
          {row.is_locked ? (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          )}
          编辑
        </button>
      )}

      {/* 特殊操作按钮 */}
      {config.specialActions?.map((action: any) => {
        if (action.condition && !action.condition(row)) return null
        return (
          <button
            key={action.key}
            className={`grid-action-btn ${action.style === 'danger' ? 'grid-action-btn-danger' : action.style === 'warning' ? 'grid-action-btn-primary' : ''}`}
            onClick={() => handleSpecialAction(action, row)}
            disabled={isLoading(action.key)}
            title={action.label}
          >
            {isLoading(action.key) ? (
              <span className="inline-block animate-spin rounded-full h-3 w-3 border-2 border-current border-t-transparent" />
            ) : null}
            {isLoading(action.key) ? '' : action.label}
          </button>
        )
      })}

      {/* 删除按钮（物化视图不显示） */}
      {config.table !== 'project_ledger' && (
        <button
          className="grid-action-btn grid-action-btn-danger"
          onClick={() => {
            const nameCol = config.cols?.find((c: any) =>
              ['name', 'title', 'label', 'company', 'chinese_name', 'full_name', 'email', 'building_id'].includes(c.key)
            )
            let name: string | undefined
            if (nameCol) {
              const raw = row[nameCol.key]
              if (nameCol.foreignKey && ctx.dicts?.[nameCol.foreignKey]) {
                name = ctx.dicts[nameCol.foreignKey][raw] || raw
              } else {
                name = raw
              }
            }
            deleteRow(row.id, name, row)
          }}
          title="删除此行"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          删除
        </button>
      )}
    </div>
  )
}
