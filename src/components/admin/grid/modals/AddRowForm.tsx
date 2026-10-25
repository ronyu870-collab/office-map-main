'use client'
import React from 'react'
import type { TableConfig, DictBundle } from '../../types'
import { Button } from '@/src/components/ui'
import { RecordFields } from '../RecordFields'

export function AddRowForm({ config, newRow, onChange, onSave, onCancel, saving, dicts, errors }: {
  config: TableConfig; newRow: Record<string, any>; onChange: (row: Record<string, any>) => void;
  onSave: () => void; onCancel: () => void; saving: boolean; dicts: DictBundle; errors: Record<string, string>
}) {
  return <div className="mb-4 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-4">
    <div className="mb-4 flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">新增记录</h4>
      <div className="flex gap-2"><Button onClick={onSave} disabled={saving}>{saving ? '保存中…' : '保存'}</Button><Button variant="secondary" onClick={onCancel} disabled={saving}>取消</Button></div>
    </div>
    <fieldset disabled={saving} className="min-w-0"><RecordFields config={config} values={newRow} onChange={onChange} dicts={dicts} adding errors={errors} disabled={saving} dense /></fieldset>
  </div>
}
