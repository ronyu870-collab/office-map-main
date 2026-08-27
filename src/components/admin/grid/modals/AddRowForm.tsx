'use client'
import React, { useState, useRef, useEffect } from 'react'
import type { ColDef, DictBundle } from '../../types'
import { Button, Input } from '@/src/components/ui'

const fieldClassName = 'h-[var(--cd-control-height-md)] w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-sm outline-none transition-colors focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]'

interface AddRowFormProps {
  cols: ColDef[]
  newRow: Record<string, any>
  onChange: (row: Record<string, any>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  dicts: DictBundle
}

/** 可搜索下拉（用于 FK 列） */
function SearchableSelect({
  value, onChange, options, placeholder,
}: {
  value: string
  onChange: (val: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative">
      <Input
        type="text"
        value={open ? query : (selected?.label ?? '')}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { setQuery(''); setOpen(true) }}
        placeholder={placeholder ?? '搜索...'}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] shadow-[var(--cd-shadow-popover)]">
          {filtered.map(opt => (
            <div
              key={opt.value}
              className={`cursor-pointer px-3 py-2 text-sm transition-colors hover:bg-[var(--cd-color-brand-soft)] ${
                opt.value === value ? 'bg-[var(--cd-color-brand-soft)] font-medium text-[var(--cd-color-brand)]' : 'text-zinc-700'
              }`}
              onMouseDown={e => {
                e.preventDefault()
                onChange(opt.value)
                setOpen(false)
                setQuery('')
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AddRowForm({ cols, newRow, onChange, onSave, onCancel, saving, dicts }: AddRowFormProps) {
  const writable = cols.filter(c => !c.readOnly && !c.hidden)

  const setVal = (key: string, val: any) => {
    onChange({ ...newRow, [key]: val })
  }

  return (
    <div className="mb-4 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--cd-color-brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <h4 className="text-sm font-semibold text-[var(--cd-color-text-primary)]">新增记录</h4>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onSave}
            disabled={saving}
          >
            {saving ? (
              <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {saving ? '保存中' : '保存'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {writable.map(col => (
          <div key={col.key} className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-600">
              {col.label}
              {col.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {col.type === 'boolean' ? (
              <select
                value={String(newRow[col.key] ?? '')}
                onChange={e => setVal(col.key, e.target.value === 'true')}
                className={fieldClassName}
              >
                <option value="">-</option>
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            ) : col.foreignKey && dicts[col.foreignKey] ? (
              <SearchableSelect
                value={newRow[col.key] ?? ''}
                onChange={val => setVal(col.key, val)}
                options={Object.entries(dicts[col.foreignKey]).map(([id, name]) => ({ value: id, label: name }))}
                placeholder="搜索..."
              />
            ) : col.displayMap ? (
              <select
                value={newRow[col.key] ?? ''}
                onChange={e => setVal(col.key, e.target.value)}
                className={fieldClassName}
              >
                <option value="">-</option>
                {Object.entries(col.displayMap).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            ) : col.type === 'textarea' || col.type === 'jsonb' ? (
              <textarea
                value={newRow[col.key] ?? ''}
                onChange={e => setVal(col.key, e.target.value)}
                className={`${fieldClassName} h-auto resize-none py-2`}
                rows={2}
              />
            ) : (
              <Input
                type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                value={newRow[col.key] ?? ''}
                onChange={e => setVal(col.key, e.target.value)}
                placeholder={col.type === 'number' ? '输入数字' : col.type === 'date' ? '' : `输入${col.label}`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
