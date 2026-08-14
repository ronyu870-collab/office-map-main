'use client'
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { CustomCellEditorProps } from 'ag-grid-react'
import { useGridCellEditor } from 'ag-grid-react'

/**
 * 外键可搜索下拉编辑器 — AG Grid React v35 API
 * 使用 onValueChange 回调同步值，useGridCellEditor 注册生命周期
 */
export function ForeignKeyEditor(props: CustomCellEditorProps) {
  const { value, onValueChange, stopEditing } = props
  const fk = (props.colDef as any)?.cellEditorParams?.foreignKey as string
  const optionsMap = (props.colDef as any)?.cellEditorParams?.options as Record<string, string> ?? {}

  const options = useMemo(
    () => Object.entries(optionsMap).map(([val, label]) => ({ value: val, label })),
    [optionsMap],
  )

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  // 注册 AG Grid 编辑器生命周期
  useGridCellEditor({})

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const select = useCallback((val: string) => {
    onValueChange(val)
    setOpen(false)
    stopEditing()
  }, [onValueChange, stopEditing])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      stopEditing(true) // cancel
    } else if (e.key === 'Enter' && filtered.length === 1) {
      select(filtered[0].value)
    }
  }, [stopEditing, filtered, select])

  const displayLabel = optionsMap[String(value ?? '')] ?? ''

  return (
    <div
      className="relative"
      style={{ width: '100%', height: '100%' }}
      onKeyDown={handleKeyDown}
    >
      <input
        ref={inputRef}
        type="text"
        value={open ? query : displayLabel}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setQuery('')
          setOpen(true)
        }}
        placeholder="搜索..."
        className="w-full h-full px-2 text-sm border-none outline-none bg-white"
        style={{ fontSize: 13 }}
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute z-50 bg-white border border-zinc-200 rounded-md shadow-lg max-h-60 overflow-y-auto"
          style={{ top: '100%', left: 0, right: 0, minWidth: 200 }}
        >
          {filtered.map(opt => (
            <div
              key={opt.value}
              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-50 ${
                opt.value === value ? 'bg-blue-50 text-[#003e7e] font-medium' : 'text-zinc-700'
              }`}
              onMouseDown={e => {
                e.preventDefault()
                select(opt.value)
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
