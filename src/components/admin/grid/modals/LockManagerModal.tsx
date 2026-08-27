'use client'
import React, { useState } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import { Button, Dialog, Input } from '@/src/components/ui'

interface LockManagerModalProps {
  onClose: () => void
  onSuccess: () => void
}

export function LockManagerModal({ onClose, onSuccess }: LockManagerModalProps) {
  const currentYear = new Date().getFullYear()
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3)

  const [year, setYear] = useState(currentYear)
  const [quarter, setQuarter] = useState(currentQuarter)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [unlockConfirm, setUnlockConfirm] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')

  async function handleLock() {
    setLoading(true)
    setResult(null)
    try {
      const { data, error } = await supabase.rpc('lock_quarter', {
        p_year: year,
        p_quarter: quarter,
      })
      if (error) throw error
      const count = data?.[0]?.locked_count ?? 0
      setResult({ ok: true, msg: `已锁定 ${year}Q${quarter}：${count} 条记录` })
      onSuccess()
    } catch (e: any) {
      setResult({ ok: false, msg: `锁定失败：${e.message}` })
    } finally {
      setLoading(false)
    }
  }

  async function handleUnlock() {
    if (!unlockReason.trim()) {
      setResult({ ok: false, msg: '请填写解锁原因' })
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const { data, error } = await supabase.rpc('unlock_quarter', {
        p_year: year,
        p_quarter: quarter,
        p_reason: unlockReason,
      })
      if (error) throw error
      const count = data?.[0]?.unlocked_count ?? 0
      setResult({ ok: true, msg: `已解锁 ${year}Q${quarter}：${count} 条记录` })
      setUnlockConfirm(false)
      setUnlockReason('')
      onSuccess()
    } catch (e: any) {
      setResult({ ok: false, msg: `解锁失败：${e.message}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }} title="季度数据锁定管理" size="sm">
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">年份</label>
              <select
                value={year}
                onChange={e => setYear(Number(e.target.value))}
                className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">季度</label>
              <select
                value={quarter}
                onChange={e => setQuarter(Number(e.target.value))}
                className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                {[1, 2, 3, 4].map(q => (
                  <option key={q} value={q}>Q{q}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={handleLock}
              disabled={loading}
              className="flex-1"
            >
              {loading ? '处理中...' : `锁定 ${year}Q${quarter}`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setUnlockConfirm(true)}
              disabled={loading}
              className="flex-1"
            >
              解锁 {year}Q{quarter}
            </Button>
          </div>

          {unlockConfirm && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="text-xs text-amber-800 font-medium">确认解锁？解锁后该季度数据可被修改。</p>
              <Input
                type="text"
                placeholder="请填写解锁原因（必填）"
                value={unlockReason}
                onChange={e => setUnlockReason(e.target.value)}
                invalid={!unlockReason.trim()}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleUnlock}
                  disabled={loading || !unlockReason.trim()}
                >
                  确认解锁
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => { setUnlockConfirm(false); setUnlockReason('') }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}

          {result && (
            <div className={`rounded-lg px-3 py-2 text-xs ${result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {result.msg}
            </div>
          )}
        </div>
    </Dialog>
  )
}
