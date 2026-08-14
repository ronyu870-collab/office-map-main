'use client'
import React, { useState } from 'react'
import { supabase } from '@/src/services/supabaseClient'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

const BACKUP_TABLES = [
  { table: 'buildings', label: '楼宇基础信息' },
  { table: 'building_metrics', label: '季度指标数据' },
  { table: 'future_supplies', label: '新增供应' },
  { table: 'pending_existing', label: '待加入存量' },
  { table: 'quarterly_submissions', label: '季度填报提交' },
  { table: 'lease_transactions', label: '租赁成交' },
  { table: 'building_assignments', label: '楼宇人员分配' },
  { table: 'future_supply_assignments', label: '未来供应分配' },
  { table: 'future_supply_submissions', label: '未来供应提交' },
  { table: 'user_roles', label: '用户角色' },
  { table: 'audit_logs', label: '审计日志' },
  { table: 'update_drafts', label: '填报草稿' },
  { table: 'memos', label: '备忘录' },
  { table: 'building_name_history', label: '楼宇曾用名' },
  { table: 'building_metrics_history', label: '指标变更历史' },
  { table: 'building_display_overrides', label: '显示覆盖配置' },
  { table: 'private_equity_transactions', label: '私募融资' },
  { table: 'app_settings', label: '应用配置' },
  { table: 'notices', label: '公告' },
  { table: 'changelog', label: '更新日志' },
]

interface BackupModalProps {
  onClose: () => void
}

export function BackupModal({ onClose }: BackupModalProps) {
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<'password' | 'backing-up' | 'done' | 'error'>('password')
  const [progress, setProgress] = useState({ current: 0, total: 0, table: '' })
  const [errorMsg, setErrorMsg] = useState('')

  async function verifyPassword() {
    if (!password.trim()) return

    // 验证密码
    const { data: result, error: authErr } = await supabase.rpc('verify_backup_password', { p_password: password })
    if (authErr) {
      setErrorMsg('验证失败：' + authErr.message)
      setPhase('error')
      return
    }
    if (!result?.ok) {
      setErrorMsg(result?.message || '密码错误')
      setPhase('error')
      return
    }

    setPhase('backing-up')
    setProgress({ current: 0, total: BACKUP_TABLES.length, table: '开始备份...' })

    try {
      const zip = new JSZip()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

      for (let i = 0; i < BACKUP_TABLES.length; i++) {
        const { table, label } = BACKUP_TABLES[i]
        setProgress({ current: i + 1, total: BACKUP_TABLES.length, table: label })

        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(50000)

        if (error) {
          console.warn(`备份 ${table} 失败:`, error.message)
          zip.file(`${table}.csv`, `备份失败: ${error.message}\n`)
          continue
        }

        if (!data || data.length === 0) {
          zip.file(`${table}.csv`, '(空表)\n')
          continue
        }

        // 转 CSV
        const headers = Object.keys(data[0])
        const csvRows = [headers.join(',')]
        for (const row of data) {
          const values = headers.map(h => {
            const v = row[h]
            if (v === null || v === undefined) return ''
            const s = String(v)
            // CSV 转义
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
              return `"${s.replace(/"/g, '""')}"`
            }
            return s
          })
          csvRows.push(values.join(','))
        }
        zip.file(`${table}.csv`, '﻿' + csvRows.join('\n'))
      }

      // 添加备份信息文件
      const info = [
        `备份时间: ${new Date().toLocaleString('zh-CN')}`,
        `表数量: ${BACKUP_TABLES.length}`,
        `格式: CSV (UTF-8)`,
        ``,
        `文件列表:`,
        ...BACKUP_TABLES.map(t => `  ${t.table}.csv - ${t.label}`),
      ].join('\n')
      zip.file('备份说明.txt', info)

      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `colliers-backup-${timestamp}.zip`)
      setPhase('done')
    } catch (e: any) {
      setErrorMsg(e.message || '备份失败')
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-xl bg-white shadow-2xl border border-zinc-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h3 className="text-sm font-bold text-zinc-900">数据备份</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {phase === 'password' && (
            <>
              <p className="text-xs text-zinc-600">
                将导出 {BACKUP_TABLES.length} 张表的全部数据为 CSV 文件，打包为 ZIP 下载。
              </p>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">请输入管理员密码确认</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && verifyPassword()}
                  className="w-full rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-[#003e7e]"
                  placeholder="输入密码"
                  autoFocus
                />
              </div>
              <button
                onClick={verifyPassword}
                disabled={!password.trim()}
                className="w-full rounded bg-[#003e7e] px-3 py-2 text-sm font-medium text-white hover:bg-[#002d5e] disabled:opacity-40"
              >
                开始备份
              </button>
            </>
          )}

          {phase === 'backing-up' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
                <span className="text-xs text-zinc-600">正在备份...</span>
              </div>
              <div className="text-xs text-zinc-500">
                {progress.current} / {progress.total} - {progress.table}
              </div>
              <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#003e7e] rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="text-center space-y-3">
              <div className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                备份完成，ZIP 文件已下载。
              </div>
              <button
                onClick={onClose}
                className="rounded bg-zinc-100 px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-200"
              >
                关闭
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="text-center space-y-3">
              <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                备份失败：{errorMsg}
              </div>
              <button
                onClick={() => { setPhase('password'); setErrorMsg('') }}
                className="rounded bg-zinc-100 px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-200"
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
