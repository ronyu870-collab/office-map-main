'use client'

import * as React from 'react'

import { Badge, Button } from '@/src/components/ui'
import { supabase } from '@/src/services/supabaseClient'
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders'

type LeaseTeamAccess = {
  enabled: boolean
  updatedAt: string | null
}

async function authFetch(path: string, options: RequestInit = {}) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.access_token) throw new Error('登录状态已失效，请重新登录后重试')

  const response = await fetch(path, {
    ...options,
    headers: withImpersonationHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers ?? {}),
    }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? '操作失败')
  return data
}

export function LeaseTeamAccessControl() {
  const [access, setAccess] = React.useState<LeaseTeamAccess | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await authFetch('/api/admin/lease-team-access')
      setAccess({ enabled: result.enabled === true, updatedAt: result.updatedAt ?? null })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取权限设置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const toggle = async () => {
    if (!access || saving) return
    const nextEnabled = !access.enabled
    const confirmation = nextEnabled
      ? '确认向全部编辑用户开放团队成交汇总吗？管理员始终可见。'
      : '确认关闭全部编辑用户的团队成交汇总吗？关闭后，编辑用户只能查看自己的成交记录。'
    if (!window.confirm(confirmation)) return

    setSaving(true)
    setError('')
    try {
      const result = await authFetch('/api/admin/lease-team-access', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      setAccess({ enabled: result.enabled === true, updatedAt: new Date().toISOString() })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '更新权限设置失败')
    } finally {
      setSaving(false)
    }
  }

  const enabled = access?.enabled === true
  return (
    <section className="rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">租赁成交数据权限</h2>
            {loading ? (
              <Badge tone="neutral">读取中</Badge>
            ) : error ? (
              <Badge tone="neutral">状态读取失败</Badge>
            ) : (
              <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? '编辑者可见' : '编辑者已隐藏'}</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            控制全部编辑用户是否可查看“团队成交汇总”。管理员始终保留完整查看、管理和导出权限。
          </p>
          {error && <p role="alert" className="mt-2 text-sm text-[var(--cd-color-danger)]">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading || saving}>
              重新读取
            </Button>
          )}
          <Button type="button" variant={enabled ? 'danger' : 'secondary'} onClick={() => void toggle()} disabled={loading || saving || !access}>
            {saving ? '保存中…' : enabled ? '关闭编辑者查看权限' : '向编辑者开放'}
          </Button>
        </div>
      </div>
    </section>
  )
}
