'use client'
import React, { useState } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { Button, Dialog, Input } from '@/src/components/ui'

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
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }} title="解锁编辑确认" size="sm">
        <div className="space-y-3">
          <p className="text-xs text-zinc-600">
            即将解锁 <span className="font-semibold text-zinc-900">{name}</span> 的 {row.record_year}Q{row.record_quarter} 数据。
          </p>
          <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
            请在下方输入"我确认修改数据"以继续。
          </p>
          <Input
            type="text"
            placeholder="输入：我确认修改数据"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleConfirm}
              disabled={confirmText !== '我确认修改数据' || loading}
              className="flex-1"
            >
              {loading ? '处理中...' : '确认解锁并编辑'}
            </Button>
            <Button
              variant="secondary"
              onClick={onCancel}
            >
              取消
            </Button>
          </div>
        </div>
    </Dialog>
  )
}
