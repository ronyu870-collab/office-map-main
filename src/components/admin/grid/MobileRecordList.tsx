'use client'
import React, { useEffect, useState } from 'react'
import { Button } from '@/src/components/ui'
import type { TableConfig, DictBundle } from '../types'
import { ActionCellRenderer } from './renderers/ActionCellRenderer'
import { displayRecordValue, gridRowKey, type GridRecord } from './recordModel'

export function MobileRecordList({ rows, config, dicts, context, onOpen, selected, onToggle, statsEnabled, loading, loadError }: {
  rows: GridRecord[]; config: TableConfig; dicts: DictBundle; context: any; onOpen: (row: GridRecord) => void;
  selected: Set<string>; onToggle: (id: string) => void; statsEnabled: boolean; loading: boolean; loadError?: string
}) {
  const [limit, setLimit] = useState(30)
  useEffect(() => setLimit(30), [rows])
  const visible = config.cols.filter(col => !col.hidden)
  const keyCol = visible.find(col => col.pinned === 'left') ?? visible.find(col => ['name', 'company', 'building_id', 'title'].includes(col.key)) ?? visible[0]
  const summary = visible.filter(col => col !== keyCol).slice(0, 3)
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-busy={loading}>
    {!rows.length && <p className="p-4 text-sm text-[var(--cd-color-text-secondary)]">{loading ? '正在加载记录…' : loadError ? '记录未能加载，请重试' : '当前范围没有记录'}</p>}
    <ul className="divide-y divide-[var(--cd-color-border)]">
      {rows.slice(0, limit).map(row => {
        const key = gridRowKey(config, row)
        const text = (col: typeof keyCol) => !col ? '记录' : context.isDemo && col.masked ? '受保护字段' : displayRecordValue(col, row, dicts)
        return <li key={key} className="px-3 py-4">
          <div className="flex items-start gap-2">
            {statsEnabled && <label className="flex min-h-11 min-w-11 items-center justify-center"><input aria-label={`选择${text(keyCol)}`} type="checkbox" checked={selected.has(key)} onChange={() => onToggle(key)} className="h-5 w-5" /></label>}
            <button className="min-h-11 min-w-0 flex-1 break-words text-left text-sm font-semibold text-[var(--cd-color-brand)]" onClick={() => onOpen(row)}>{text(keyCol)}</button>
          </div>
          <dl className="mt-1 grid gap-1 text-sm">{summary.map(col => <div key={col.key} className="flex gap-3"><dt className="shrink-0 text-[var(--cd-color-text-secondary)]">{col.label}</dt><dd className="min-w-0 break-words">{text(col)}</dd></div>)}</dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => onOpen(row)} className="min-h-11">完整详情</Button>
            {config.cols.some(col => !col.readOnly && !col.sourceKey) && <ActionCellRenderer {...{ data: row, context } as any} />}
          </div>
        </li>
      })}
    </ul>
    {rows.length > limit && <div className="p-3"><Button variant="secondary" className="min-h-11 w-full" onClick={() => setLimit(value => value + 30)}>继续显示记录（{Math.min(limit, rows.length)} / {rows.length}）</Button></div>}
  </div>
}
