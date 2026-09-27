'use client'

import * as React from 'react'
import { Plus, Search } from 'lucide-react'

import { Badge, Button, Dialog, EmptyState, ErrorState, Input, LoadingState } from '@/src/components/ui'
import { supabase } from '@/src/services/supabaseClient'
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders'
import { getUserRoleLabel } from '@/src/types/auth'

type UserRole = 'admin' | 'editor' | 'user'

type UserRow = {
  user_id: string
  role: string | null
  chinese_name: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  gender: string | null
  title: string | null
  internal_number: string | null
  created_at: string | null
  disabled: boolean
  banned_until: string | null
  last_sign_in_at: string | null
  stock_assignment_count: number
  future_assignment_count: number
}

type UserForm = {
  role: UserRole
  chinese_name: string
  full_name: string
  email: string
  phone: string
  gender: string
  title: string
  internal_number: string
}

type TransferPreview = {
  stockCount: number
  futureCount: number
  totalCount: number
}

type OneTimeCredential = {
  email: string
  phone: string
  password: string
}

const EMPTY_FORM: UserForm = {
  role: 'user',
  chinese_name: '',
  full_name: '',
  email: '',
  phone: '',
  gender: '',
  title: '',
  internal_number: '',
}

function displayName(row: UserRow) {
  return row.chinese_name || row.full_name || row.email || '未命名用户'
}

function toForm(row: UserRow): UserForm {
  return {
    role: ['admin', 'editor', 'user'].includes(row.role ?? '') ? row.role as UserRole : 'user',
    chinese_name: row.chinese_name ?? '',
    full_name: row.full_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    gender: row.gender ?? '',
    title: row.title ?? '',
    internal_number: row.internal_number ?? '',
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '从未登录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function generateTemporaryPassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%*-_'
  const pool = letters + digits + symbols
  const randomIndex = (length: number) => {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return value[0] % length
  }
  const characters = [
    letters[randomIndex(letters.length)],
    digits[randomIndex(digits.length)],
    ...Array.from({ length: 12 }, () => pool[randomIndex(pool.length)]),
  ]
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    ;[characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]]
  }
  return characters.join('')
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

async function createUser(form: UserForm, password: string) {
  return authFetch('/api/admin/create-user', {
    method: 'POST',
    body: JSON.stringify({ ...form, password }),
  })
}

async function resetUserPassword(userId: string, password: string) {
  return authFetch('/api/admin/reset-password', {
    method: 'POST',
    body: JSON.stringify({ userId, password }),
  })
}

function Field({
  label,
  field,
  form,
  setForm,
  required = false,
  type = 'text',
}: {
  label: string
  field: keyof UserForm
  form: UserForm
  setForm: React.Dispatch<React.SetStateAction<UserForm>>
  required?: boolean
  type?: string
}) {
  const isPhone = field === 'phone'
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <Input
        required={required}
        type={type}
        inputMode={isPhone ? 'numeric' : undefined}
        pattern={isPhone ? '\\d{11}' : undefined}
        maxLength={isPhone ? 11 : undefined}
        value={form[field]}
        onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
        className="mt-1.5"
      />
    </label>
  )
}

function RoleField({
  form,
  setForm,
}: {
  form: UserForm
  setForm: React.Dispatch<React.SetStateAction<UserForm>>
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      角色
      <select
        value={form.role}
        onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserRole }))}
        className="mt-1.5 h-9 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-[var(--cd-font-size-md)] outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
      >
        <option value="user">查看用户</option>
        <option value="editor">编辑用户</option>
        <option value="admin">管理员</option>
      </select>
    </label>
  )
}

export function UserManager() {
  const [rows, setRows] = React.useState<UserRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [showCreate, setShowCreate] = React.useState(false)
  const [createForm, setCreateForm] = React.useState<UserForm>(EMPTY_FORM)
  const [createPassword, setCreatePassword] = React.useState('')
  const [showCreatePassword, setShowCreatePassword] = React.useState(false)
  const [oneTimeCredential, setOneTimeCredential] = React.useState<OneTimeCredential | null>(null)
  const [selected, setSelected] = React.useState<UserRow | null>(null)
  const [editForm, setEditForm] = React.useState<UserForm>(EMPTY_FORM)
  const [busy, setBusy] = React.useState('')
  const [notice, setNotice] = React.useState<{ text: string; success: boolean } | null>(null)
  const [transferTarget, setTransferTarget] = React.useState('')
  const [includeStock, setIncludeStock] = React.useState(true)
  const [includeFuture, setIncludeFuture] = React.useState(true)
  const [transferPreview, setTransferPreview] = React.useState<TransferPreview | null>(null)

  const showNotice = React.useCallback((text: string, success: boolean) => {
    setNotice({ text, success })
    window.setTimeout(() => setNotice(null), 5000)
  }, [])

  const fetchUsers = React.useCallback(async (): Promise<UserRow[]> => {
    setLoading(true)
    setError('')
    try {
      const data = await authFetch('/api/admin/users')
      const users = Array.isArray(data.users) ? data.users as UserRow[] : []
      setRows(users)
      return users
    } catch (fetchError) {
      setRows([])
      setError(fetchError instanceof Error ? fetchError.message : '用户列表加载失败')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    queueMicrotask(() => { void fetchUsers() })
  }, [fetchUsers])

  const visibleRows = React.useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter((row) => [
      row.chinese_name,
      row.full_name,
      row.email,
      row.phone,
      row.role,
      row.title,
      row.disabled ? '停用' : '正常',
    ].some((value) => value?.toLowerCase().includes(keyword)))
  }, [rows, search])

  const openManager = (row: UserRow) => {
    setSelected(row)
    setEditForm(toForm(row))
    setTransferTarget('')
    setIncludeStock(true)
    setIncludeFuture(true)
    setTransferPreview(null)
  }

  const openCreate = () => {
    setCreateForm(EMPTY_FORM)
    setCreatePassword(generateTemporaryPassword())
    setShowCreatePassword(false)
    setShowCreate(true)
  }

  const closeManager = () => {
    if (busy) return
    setSelected(null)
    setTransferPreview(null)
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    const phone = createForm.phone.trim()
    if (!/^\d{11}$/.test(phone)) {
      showNotice('请输入有效的 11 位手机号', false)
      return
    }
    setBusy('create')
    try {
      await createUser({ ...createForm, phone }, createPassword)
      setShowCreate(false)
      setOneTimeCredential({ email: createForm.email.trim(), phone, password: createPassword })
      setCreateForm(EMPTY_FORM)
      setCreatePassword('')
      await fetchUsers()
    } catch (createError) {
      showNotice(createError instanceof Error ? createError.message : '创建失败', false)
    } finally {
      setBusy('')
    }
  }

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    const phone = editForm.phone.trim()
    if (!/^\d{11}$/.test(phone)) {
      showNotice('请输入有效的 11 位手机号', false)
      return
    }
    const { role: requestedRole, ...profileFields } = editForm
    const currentRole = selected.role ?? 'user'
    if (requestedRole !== currentRole) {
      const currentRoleLabel = getUserRoleLabel(currentRole)
      const requestedRoleLabel = getUserRoleLabel(requestedRole)
      if (!window.confirm(`确认将「${displayName(selected)}」的角色从「${currentRoleLabel}」改为「${requestedRoleLabel}」？`)) return
    }
    setBusy('profile')
    try {
      await authFetch('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'update_profile',
          userId: selected.user_id,
          expectedRole: selected.role,
          ...profileFields,
          phone,
          role: requestedRole,
        }),
      })
      const refreshedUsers = await fetchUsers()
      const savedUser = refreshedUsers.find((row) => row.user_id === selected.user_id)
      if (!savedUser) {
        throw new Error('保存后无法重新读取该用户，请刷新用户列表后核对')
      }
      if (savedUser.role !== requestedRole) {
        const actualRole = getUserRoleLabel(savedUser.role)
        throw new Error(`保存未生效，当前角色仍为「${actualRole}」；请刷新后重试`)
      }
      showNotice('用户资料和角色已更新', true)
      setSelected(savedUser)
      setEditForm(toForm(savedUser))
    } catch (saveError) {
      showNotice(saveError instanceof Error ? saveError.message : '保存失败', false)
    } finally {
      setBusy('')
    }
  }

  const toggleStatus = async () => {
    if (!selected) return
    const nextDisabled = !selected.disabled
    const actionText = nextDisabled ? '停用' : '启用'
    if (!window.confirm(
      nextDisabled
        ? `确认停用「${displayName(selected)}」？\n\n该用户将无法再次登录，历史填报和任务记录不会删除。`
        : `确认重新启用「${displayName(selected)}」？`,
    )) return
    setBusy('status')
    try {
      const result = await authFetch('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'set_status', userId: selected.user_id, disabled: nextDisabled }),
      })
      showNotice(result.message, true)
      setSelected((current) => current ? { ...current, disabled: nextDisabled } : current)
      await fetchUsers()
    } catch (statusError) {
      showNotice(statusError instanceof Error ? statusError.message : `${actionText}失败`, false)
    } finally {
      setBusy('')
    }
  }

  const handleResetPassword = async () => {
    if (!selected) return
    if (!window.confirm(`确认重置「${displayName(selected)}」的密码吗？\n\n系统将生成临时密码，对方首次登录后必须修改。`)) return
    const temporaryPassword = generateTemporaryPassword()
    setBusy('password')
    try {
      await resetUserPassword(selected.user_id, temporaryPassword)
      setOneTimeCredential({
        email: selected.email ?? '',
        phone: selected.phone ?? '',
        password: temporaryPassword,
      })
    } catch (resetError) {
      showNotice(resetError instanceof Error ? resetError.message : '重置失败', false)
    } finally {
      setBusy('')
    }
  }

  const previewTransfer = async () => {
    if (!selected || !transferTarget) return
    setBusy('preview')
    try {
      const result = await authFetch('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'transfer_assignments',
          userId: selected.user_id,
          targetUserId: transferTarget,
          includeStock,
          includeFuture,
          dryRun: true,
        }),
      })
      setTransferPreview(result)
    } catch (previewError) {
      showNotice(previewError instanceof Error ? previewError.message : '任务统计失败', false)
    } finally {
      setBusy('')
    }
  }

  const executeTransfer = async () => {
    if (!selected || !transferTarget || !transferPreview) return
    const receiver = rows.find((row) => row.user_id === transferTarget)
    if (!receiver) return
    if (!window.confirm(
      `确认将 ${transferPreview.totalCount} 项当前及未来任务从「${displayName(selected)}」转给「${displayName(receiver)}」？\n\n历史季度填报不会修改。`,
    )) return
    setBusy('transfer')
    try {
      const result = await authFetch('/api/admin/users', {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'transfer_assignments',
          userId: selected.user_id,
          targetUserId: transferTarget,
          includeStock,
          includeFuture,
          dryRun: false,
        }),
      })
      showNotice(result.message, true)
      setTransferPreview(null)
      await fetchUsers()
      setSelected(null)
    } catch (transferError) {
      showNotice(transferError instanceof Error ? transferError.message : '任务转移失败', false)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="relative w-[320px] max-w-[72vw]">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cd-color-text-muted)]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索姓名、邮箱、电话或角色"
              className="pl-9"
            />
          </label>
          <Badge>{visibleRows.length} 名用户</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void fetchUsers()} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </Button>
          <Button type="button" onClick={openCreate}><Plus size={15} />新增用户</Button>
        </div>
      </div>

      {notice && (
        <div role="status" className={`rounded-[var(--cd-radius-md)] border px-3 py-2.5 text-[var(--cd-font-size-sm)] ${notice.success ? 'border-[color:rgb(22_133_91_/_0.15)] bg-[var(--cd-color-success-soft)] text-[var(--cd-color-success)]' : 'border-[color:rgb(201_54_43_/_0.15)] bg-[var(--cd-color-danger-soft)] text-[var(--cd-color-danger)]'}`}>
          {notice.text}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        {loading ? (
          <div className="p-6"><LoadingState label="正在加载用户列表" /></div>
        ) : error ? (
          <div className="p-4"><ErrorState title="用户列表加载失败" description={error} action={<Button variant="secondary" onClick={() => void fetchUsers()}>重试</Button>} /></div>
        ) : visibleRows.length === 0 ? (
          <div className="p-4"><EmptyState title="没有找到匹配的用户" /></div>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-5 py-3">姓名</th>
                <th className="border-b border-slate-200 px-4 py-3">状态</th>
                <th className="border-b border-slate-200 px-4 py-3">角色</th>
                <th className="border-b border-slate-200 px-4 py-3">邮箱</th>
                <th className="border-b border-slate-200 px-4 py-3">负责楼宇</th>
                <th className="border-b border-slate-200 px-4 py-3">最近登录</th>
                <th className="border-b border-slate-200 px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((row) => (
                <tr key={row.user_id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-slate-800">{displayName(row)}</div>
                    {row.full_name && row.chinese_name && <div className="mt-0.5 text-xs text-slate-400">{row.full_name}</div>}
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge tone={row.disabled ? 'neutral' : 'success'}>{row.disabled ? '已停用' : '正常'}</Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge tone="neutral">{getUserRoleLabel(row.role)}</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{row.email || '—'}</td>
                  <td className="px-4 py-3.5 text-slate-600">
                    <span>{row.stock_assignment_count} 个存量</span>
                    {row.future_assignment_count > 0 && <span className="ml-2 text-slate-400">· {row.future_assignment_count} 个未来</span>}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">{formatDateTime(row.last_sign_in_at)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <Button type="button" variant="secondary" size="sm" onClick={() => openManager(row)}>管理</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog
        open={showCreate}
        onOpenChange={(open) => { if (!busy) setShowCreate(open) }}
        title="新增用户"
        description="设置临时密码，用户首次登录后必须修改。"
        size="lg"
        dismissible={!busy}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={Boolean(busy)}>取消</Button>
            <Button type="submit" form="create-user-form" disabled={Boolean(busy)}>{busy === 'create' ? '创建中…' : '创建用户'}</Button>
          </>
        )}
      >
          <form id="create-user-form" onSubmit={(event) => void handleCreate(event)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="中文名" field="chinese_name" form={createForm} setForm={setCreateForm} />
              <Field label="英文名" field="full_name" form={createForm} setForm={setCreateForm} />
              <Field label="邮箱 *" field="email" form={createForm} setForm={setCreateForm} required type="email" />
              <Field label="手机号 *" field="phone" form={createForm} setForm={setCreateForm} required type="tel" />
              <Field label="性别" field="gender" form={createForm} setForm={setCreateForm} />
              <Field label="职位" field="title" form={createForm} setForm={setCreateForm} />
              <Field label="分机号" field="internal_number" form={createForm} setForm={setCreateForm} />
              <RoleField form={createForm} setForm={setCreateForm} />
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                初始密码 *
                <div className="mt-1.5 flex gap-2">
                  <Input
                    required
                    type={showCreatePassword ? 'text' : 'password'}
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    autoComplete="new-password"
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button type="button" variant="secondary" onClick={() => setShowCreatePassword((current) => !current)}>
                    {showCreatePassword ? '隐藏' : '显示'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setCreatePassword(generateTemporaryPassword())}>
                    重新生成
                  </Button>
                </div>
                <span className="mt-1.5 block text-xs font-normal text-slate-400">至少 10 位，并同时包含字母和数字。</span>
              </label>
          </form>
      </Dialog>

      {selected && (
        <Dialog
          open
          onOpenChange={(open) => { if (!open && !busy) closeManager() }}
          title={<span className="flex items-center gap-2">{displayName(selected)}<Badge tone={selected.disabled ? 'neutral' : 'success'}>{selected.disabled ? '已停用' : '正常'}</Badge></span>}
          description="编辑资料、账号状态和楼宇任务归属。"
          size="lg"
          dismissible={!busy}
        >
          <div className="-mx-5 -my-4">
            <form onSubmit={(event) => void saveProfile(event)} className="border-b border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-900">基本资料与角色</h3>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="中文名" field="chinese_name" form={editForm} setForm={setEditForm} />
                <Field label="英文名" field="full_name" form={editForm} setForm={setEditForm} />
                <Field label="邮箱 *" field="email" form={editForm} setForm={setEditForm} required type="email" />
                <Field label="手机号 *" field="phone" form={editForm} setForm={setEditForm} required type="tel" />
                <Field label="性别" field="gender" form={editForm} setForm={setEditForm} />
                <Field label="职位" field="title" form={editForm} setForm={setEditForm} />
                <Field label="分机号" field="internal_number" form={editForm} setForm={setEditForm} />
                <RoleField form={editForm} setForm={setEditForm} />
              </div>
              <div className="mt-5 flex justify-end">
                <Button type="submit" disabled={Boolean(busy)}>
                  {busy === 'profile'
                    ? '保存中…'
                    : selected.role !== editForm.role
                      ? `保存并设为${getUserRoleLabel(editForm.role)}`
                      : '保存资料'}
                </Button>
              </div>
            </form>

            <section className="border-b border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-900">账号安全</h3>
              <p className="mt-1 text-sm text-slate-500">停用不会删除历史填报、审计记录或楼宇任务。</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" variant="secondary" onClick={() => void handleResetPassword()} disabled={Boolean(busy)}>
                  {busy === 'password' ? '生成中…' : '生成临时密码'}
                </Button>
                <Button
                  type="button"
                  onClick={() => void toggleStatus()}
                  disabled={Boolean(busy)}
                  variant={selected.disabled ? 'secondary' : 'danger'}
                >
                  {busy === 'status' ? '处理中…' : selected.disabled ? '重新启用账号' : '停用账号'}
                </Button>
              </div>
            </section>

            <section className="p-6">
              <h3 className="text-sm font-semibold text-slate-900">转移当前及未来任务</h3>
              <p className="mt-1 text-sm text-slate-500">只调整任务负责人，不修改已经提交的历史季度数据。</p>
              <div className="mt-4 grid gap-4 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    接收人
                    <select
                      value={transferTarget}
                      onChange={(event) => {
                        setTransferTarget(event.target.value)
                        setTransferPreview(null)
                      }}
                      className="mt-1.5 h-[var(--cd-control-height-md)] w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 text-sm outline-none transition-colors focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
                    >
                      <option value="">请选择接收人</option>
                      {rows.filter((row) => row.user_id !== selected.user_id && !row.disabled).map((row) => (
                        <option key={row.user_id} value={row.user_id}>{displayName(row)} · {getUserRoleLabel(row.role)}</option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-5 text-sm text-slate-600">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={includeStock} onChange={(event) => { setIncludeStock(event.target.checked); setTransferPreview(null) }} />存量楼宇任务</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={includeFuture} onChange={(event) => { setIncludeFuture(event.target.checked); setTransferPreview(null) }} />当前及未来供应任务</label>
                  </div>
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="secondary" onClick={() => void previewTransfer()} disabled={!transferTarget || (!includeStock && !includeFuture) || Boolean(busy)}>
                    {busy === 'preview' ? '统计中…' : '核对任务'}
                  </Button>
                </div>
              </div>

              {transferPreview && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--cd-radius-lg)] border border-[color:rgb(0_62_126_/_0.15)] bg-[var(--cd-color-brand-soft)] px-4 py-3">
                  <div className="text-sm text-[var(--cd-color-text-primary)]">
                    将转移 <strong>{transferPreview.totalCount}</strong> 项任务
                    <span className="ml-2 text-blue-700">存量 {transferPreview.stockCount} · 未来供应 {transferPreview.futureCount}</span>
                  </div>
                  <Button type="button" onClick={() => void executeTransfer()} disabled={transferPreview.totalCount === 0 || Boolean(busy)}>
                    {busy === 'transfer' ? '转移中…' : '确认转移'}
                  </Button>
                </div>
              )}
            </section>
          </div>
        </Dialog>
      )}

      {oneTimeCredential && (
        <Dialog
          open
          onOpenChange={(open) => { if (!open) setOneTimeCredential(null) }}
          title="临时登录信息"
          description="密码仅在此处显示一次，请复制后安全地交给用户。"
          size="sm"
          footer={(
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(`邮箱：${oneTimeCredential.email}\n手机号：${oneTimeCredential.phone}\n临时密码：${oneTimeCredential.password}`)}
              >
                复制登录信息
              </Button>
              <Button type="button" onClick={() => setOneTimeCredential(null)}>我已保存</Button>
            </>
          )}
        >
            <div className="space-y-3 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-4">
              <div>
                <div className="text-xs text-slate-400">邮箱</div>
                <div className="mt-1 break-all text-sm text-slate-800">{oneTimeCredential.email || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">手机号</div>
                <div className="mt-1 text-sm text-slate-800">{oneTimeCredential.phone || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">临时密码</div>
                <div className="mt-1 break-all font-mono text-base font-semibold text-slate-900">{oneTimeCredential.password}</div>
              </div>
            </div>
        </Dialog>
      )}
    </div>
  )
}
