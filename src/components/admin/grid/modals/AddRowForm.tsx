'use client'
import React, { useState, useRef, useEffect } from 'react'
import type { ColDef, DictBundle } from '../../types'

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
      <input
        type="text"
        value={open ? query : (selected?.label ?? '')}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { setQuery(''); setOpen(true) }}
        placeholder={placeholder ?? '搜索...'}
        className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-48 overflow-y-auto w-full mt-1">
          {filtered.map(opt => (
            <div
              key={opt.value}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 transition-colors ${
                opt.value === value ? 'bg-blue-50 text-[#003e7e] font-medium' : 'text-zinc-700'
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
    <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-xl p-5 mb-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <h4 className="text-sm font-semibold text-emerald-800">新增记录</h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-all active:scale-[0.97] disabled:opacity-50"
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
          </button>
          <button
            className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 hover:bg-white/50 rounded-lg transition-colors"
            onClick={onCancel}
          >
            取消
          </button>
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
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all bg-white"
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
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all bg-white"
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
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all resize-none"
                rows={2}
              />
            ) : (
              <input
                type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                value={newRow[col.key] ?? ''}
                onChange={e => setVal(col.key, e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg outline-none focus:border-[#003e7e] focus:ring-2 focus:ring-[#003e7e]/10 transition-all"
                placeholder={col.type === 'number' ? '输入数字' : col.type === 'date' ? '' : `输入${col.label}`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
