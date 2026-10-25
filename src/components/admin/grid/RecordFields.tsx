'use client'
import React, { useId } from 'react'
import { Input } from '@/src/components/ui'
import { SearchableSelect } from '@/src/components/ui/SearchableSelect'
import type { DictBundle, TableConfig } from '../types'
import { displayRecordValue, type GridRecord } from './recordModel'

interface Props {
  config: TableConfig
  values: GridRecord
  onChange?: (next: GridRecord) => void
  dicts: DictBundle
  errors?: Record<string, string>
  disabled?: boolean
  adding?: boolean
  isDemo?: boolean
  dense?: boolean
}

/** Uses the same field metadata and raw values as desktop and CRUD. */
export function RecordFields({ config, values, onChange, dicts, errors = {}, disabled, adding, isDemo, dense }: Props) {
  const prefix = useId()
  return <div className={dense ? 'grid-record-fields-dense grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
    {config.cols.filter(col => !col.hidden && (!adding || !col.readOnly)).map(col => {
      const id = `${prefix}-${col.key}`
      const errorId = `${id}-error`
      const readonly = !onChange || col.readOnly || !!col.sourceKey
      const masked = isDemo && col.masked
      const value = values[col.key]
      const set = (next: any) => onChange?.({ ...values, [col.key]: next })
      const attributes = { id, disabled, 'aria-invalid': !!errors[col.key], 'aria-describedby': errors[col.key] ? errorId : undefined }
      return <div key={col.key} className={`min-w-0 ${!dense && ['textarea', 'jsonb'].includes(col.type) ? 'sm:col-span-2' : ''}`}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-[var(--cd-color-text-primary)]">{col.label}{col.required && !readonly && <span aria-hidden="true"> *</span>}{readonly && <span className="ml-2 text-xs font-normal text-[var(--cd-color-text-secondary)]">只读</span>}</label>
        {masked ? <p className="break-words py-2 text-sm">受保护字段</p> : readonly ? <p id={id} className="whitespace-pre-wrap break-words py-2 text-sm">{displayRecordValue(col, values, dicts)}</p> : col.foreignKey ? <div onKeyDown={event => {
          if (event.key === 'Escape' && (event.target as HTMLElement).getAttribute('aria-expanded') === 'true') event.preventDefault()
        }}><SearchableSelect aria-invalid={!!errors[col.key]} aria-describedby={errors[col.key] ? errorId : undefined} id={id} value={String(value ?? '')} onChange={set} disabled={disabled} options={Object.entries(dicts[col.foreignKey] ?? {}).map(([key, label]) => ({ value: key, label }))} placeholder={`选择${col.label}`} className="grid-record-select" /></div> : col.displayMap || col.type === 'boolean' ? <select {...attributes} value={value == null ? '' : String(value)} onChange={event => set(event.target.value === '' ? null : col.type === 'boolean' ? event.target.value === 'true' : event.target.value)} className="grid-record-input">
          <option value="">请选择</option>{Object.entries(col.displayMap ?? { true: '是', false: '否' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select> : col.type === 'textarea' || col.type === 'jsonb' ? <textarea {...attributes} rows={4} value={typeof value === 'object' && value != null ? JSON.stringify(value, null, 2) : value ?? ''} onChange={event => set(event.target.value)} className="grid-record-input h-auto py-2" /> : <Input {...attributes} type={col.type === 'number' ? 'number' : col.type === 'date' && !String(value ?? '').includes('T') ? 'date' : 'text'} step={col.type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={event => set(event.target.value)} className="grid-record-input" />}
        {col.suffix && !readonly && <p className="mt-1 text-xs text-[var(--cd-color-text-secondary)]">按原始比例填写；0.1 显示为 10{col.suffix}</p>}
        {errors[col.key] && <p id={errorId} className="mt-1 text-sm text-[var(--cd-color-danger)]">{errors[col.key]}</p>}
      </div>
    })}
  </div>
}
