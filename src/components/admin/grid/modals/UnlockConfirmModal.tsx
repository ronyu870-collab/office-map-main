'use client'
import React, { useState } from 'react'
import { supabase } from '@/src/services/supabaseClient'

interface UnlockConfirmModalProps {
  row: any
  onConfirm: () => void
  onCancel: () => void
}

export function UnlockConfirmModal({ row, onConfirm, onCancel }: UnlockConfirmModalProps) {
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)

  const name = row._displayName || row.name || row.id

  async function handleConfirm() {
    if (confirmText !== '我确认修改数据') return
    setLoading(true)
    const { error } = await supabase.rpc('unlock_row', { p_id: row.id })
    if (error) {
      setLoading(false)
      alert(`解锁失败：${error.message}`)
      return
    }
    onConfirm()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="w-96 rounded-xl bg-white shadow-2xl border border-zinc-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h3 className="text-sm font-bold text-zinc-900">解锁编辑确认</h3>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-zinc-600">
            即将解锁 <span className="font-semibold text-zinc-900">{name}</span> 的 {row.record_year}Q{row.record_quarter} 数据。
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
            请在下方输入"我确认修改数据"以继续。
          </p>
          <input
            type="text"
            placeholder="输入：我确认修改数据"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-[#003e7e]"
            autoFocus
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConfirm}
              disabled={confirmText !== '我确认修改数据' || loading}
              className="flex-1 rounded bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {loading ? '处理中...' : '确认解锁并编辑'}
            </button>
            <button
              onClick={onCancel}
              className="rounded border border-zinc-300 px-3 py-2 text-xs text-zinc-600 hover:bg-zinc-50"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
