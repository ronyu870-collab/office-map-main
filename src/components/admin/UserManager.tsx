'use client'

import * as React from 'react'
import { supabase } from '@/src/services/supabaseClient'

type UserRole = 'admin' | 'editor' | 'viewer'

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
  password: string
}

type CreateUserResult = {
  success: boolean
  message: string
  userId: string
}

const EMPTY_FORM: UserForm = {
  role: 'viewer',
  chinese_name: '',
  full_name: '',
  email: '',
  phone: '',
  gender: '',
  title: '',
  internal_number: '',
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '普通用户',
}

function displayName(row: UserRow) {
  return row.chinese_name || row.full_name || row.email || '未命名用户'
}

function toForm(row: UserRow): UserForm {
  return {
    role: ['admin', 'editor', 'viewer'].includes(row.role ?? '') ? row.role as UserRole : 'viewer',
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers ?? {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? '操作失败')
  return data
}

async function createUser(form: UserForm, password: string): Promise<CreateUserResult> {
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
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        required={required}
        type={type}
        value={form[field]}
        onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
        className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
        className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <option value="viewer">普通用户</option>
        <option value="editor">编辑者</option>
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
    setBusy('create')
    try {
      const result = await createUser(createForm, createPassword)
      const credential = { email: createForm.email.trim(), password: createPassword }
      setShowCreate(false)
      setOneTimeCredential(credential)
      setCreateForm(EMPTY_FORM)
      setCreatePassword('')

      const refreshedUsers = await fetchUsers()
      const createdUser = refreshedUsers.find((row) => row.user_id === result.userId)
      if (!createdUser) {
        showNotice('用户已创建，但列表刷新失败，请点击刷新后核对', false)
      } else {
        showNotice('用户创建成功', true)
      }
    } catch (createError) {
      showNotice(createError instanceof Error ? createError.message : '创建失败', false)
    } finally {
      setBusy('')
    }
  }

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    const { role: requestedRole, ...profileFields } = editForm
    const currentRole = selected.role ?? 'viewer'
    if (requestedRole !== currentRole) {
      const currentRoleLabel = ROLE_LABELS[currentRole] ?? currentRole
      const requestedRoleLabel = ROLE_LABELS[requestedRole] ?? requestedRole
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
          role: requestedRole,
        }),
      })
      const refreshedUsers = await fetchUsers()
      const savedUser = refreshedUsers.find((row) => row.user_id === selected.user_id)
      if (!savedUser) {
        throw new Error('保存后无法重新读取该用户，请刷新用户列表后核对')
      }
      if (savedUser.role !== requestedRole) {
        const actualRole = ROLE_LABELS[savedUser.role ?? ''] ?? savedUser.role ?? '未设置'
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
          <label className="flex h-11 w-[320px] max-w-[72vw] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500 shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索姓名、邮箱、电话或角色…"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">{visibleRows.length} 名用户</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void fetchUsers()} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            {loading ? '加载中…' : '刷新'}
          </button>
          <button type="button" onClick={openCreate} className="rounded-lg bg-[#004b8d] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#003f77]">
            ＋ 新增用户
          </button>
        </div>
      </div>

      {notice && (
        <div role="status" aria-live="polite" className={`fixed right-4 top-4 z-[80] max-w-[min(420px,calc(100vw-2rem))] rounded-lg border px-4 py-3 text-sm shadow-lg ${notice.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-slate-500">正在加载用户列表…</div>
        ) : error ? (
          <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3 text-sm text-slate-500">
            <span>{error}</span>
            <button type="button" onClick={() => void fetchUsers()} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700">重试</button>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-slate-500">没有找到匹配的用户</div>
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
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${row.disabled ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${row.disabled ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                      {row.disabled ? '已停用' : '正常'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${row.role === 'admin' ? 'bg-blue-50 text-blue-700' : row.role === 'editor' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {ROLE_LABELS[row.role ?? ''] ?? row.role ?? '未设置'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{row.email || '—'}</td>
                  <td className="px-4 py-3.5 text-slate-600">
                    <span>{row.stock_assignment_count} 个存量</span>
                    {row.future_assignment_count > 0 && <span className="ml-2 text-slate-400">· {row.future_assignment_count} 个未来</span>}
                  </td>
                  <td className="px-4 py-3.5 text-slate-500">{formatDateTime(row.last_sign_in_at)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button type="button" onClick={() => openManager(row)} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
                      管理
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-label="新增用户">
          <form onSubmit={(event) => void handleCreate(event)} className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div><h2 className="text-lg font-semibold text-slate-900">新增用户</h2><p className="mt-1 text-sm text-slate-500">设置临时密码，用户首次登录后必须修改。</p></div>
              <button type="button" onClick={() => setShowCreate(false)} disabled={Boolean(busy)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">关闭</button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="中文名" field="chinese_name" form={createForm} setForm={setCreateForm} />
              <Field label="英文名" field="full_name" form={createForm} setForm={setCreateForm} />
              <Field label="邮箱 *" field="email" form={createForm} setForm={setCreateForm} required type="email" />
              <Field label="电话" field="phone" form={createForm} setForm={setCreateForm} />
              <Field label="性别" field="gender" form={createForm} setForm={setCreateForm} />
              <Field label="职位" field="title" form={createForm} setForm={setCreateForm} />
              <Field label="分机号" field="internal_number" form={createForm} setForm={setCreateForm} />
              <RoleField form={createForm} setForm={setCreateForm} />
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                初始密码 *
                <div className="mt-1.5 flex gap-2">
                  <input
                    required
                    type={showCreatePassword ? 'text' : 'password'}
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    autoComplete="new-password"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <button type="button" onClick={() => setShowCreatePassword((current) => !current)} className="rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
                    {showCreatePassword ? '隐藏' : '显示'}
                  </button>
                  <button type="button" onClick={() => setCreatePassword(generateTemporaryPassword())} className="rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
                    重新生成
                  </button>
                </div>
                <span className="mt-1.5 block text-xs font-normal text-slate-400">至少 10 位，并同时包含字母和数字。</span>
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreate(false)} disabled={Boolean(busy)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600">取消</button>
              <button type="submit" disabled={Boolean(busy)} className="rounded-lg bg-[#004b8d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy === 'create' ? '创建中…' : '创建用户'}</button>
            </div>
          </form>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-label="用户管理">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-6 py-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{displayName(selected)}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${selected.disabled ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{selected.disabled ? '已停用' : '正常'}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">编辑资料、账号状态和楼宇任务归属</p>
              </div>
              <button type="button" onClick={closeManager} disabled={Boolean(busy)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">关闭</button>
            </div>

            <form onSubmit={(event) => void saveProfile(event)} className="border-b border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-900">基本资料与角色</h3>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="中文名" field="chinese_name" form={editForm} setForm={setEditForm} />
                <Field label="英文名" field="full_name" form={editForm} setForm={setEditForm} />
                <Field label="邮箱 *" field="email" form={editForm} setForm={setEditForm} required type="email" />
                <Field label="电话" field="phone" form={editForm} setForm={setEditForm} />
                <Field label="性别" field="gender" form={editForm} setForm={setEditForm} />
                <Field label="职位" field="title" form={editForm} setForm={setEditForm} />
                <Field label="分机号" field="internal_number" form={editForm} setForm={setEditForm} />
                <RoleField form={editForm} setForm={setEditForm} />
              </div>
              <div className="mt-5 flex justify-end">
                <button type="submit" disabled={Boolean(busy)} className="rounded-lg bg-[#004b8d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {busy === 'profile'
                    ? '保存中…'
                    : selected.role !== editForm.role
                      ? `保存并设为${ROLE_LABELS[editForm.role]}`
                      : '保存资料'}
                </button>
              </div>
            </form>

            <section className="border-b border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-900">账号安全</h3>
              <p className="mt-1 text-sm text-slate-500">停用不会删除历史填报、审计记录或楼宇任务。</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => void handleResetPassword()} disabled={Boolean(busy)} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60">
                  {busy === 'password' ? '生成中…' : '生成临时密码'}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleStatus()}
                  disabled={Boolean(busy)}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60 ${selected.disabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'}`}
                >
                  {busy === 'status' ? '处理中…' : selected.disabled ? '重新启用账号' : '停用账号'}
                </button>
              </div>
            </section>

            <section className="p-6">
              <h3 className="text-sm font-semibold text-slate-900">转移当前及未来任务</h3>
              <p className="mt-1 text-sm text-slate-500">只调整任务负责人，不修改已经提交的历史季度数据。</p>
              <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    接收人
                    <select
                      value={transferTarget}
                      onChange={(event) => {
                        setTransferTarget(event.target.value)
                        setTransferPreview(null)
                      }}
                      className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">请选择接收人</option>
                      {rows.filter((row) => row.user_id !== selected.user_id && !row.disabled).map((row) => (
                        <option key={row.user_id} value={row.user_id}>{displayName(row)} · {ROLE_LABELS[row.role ?? ''] ?? row.role}</option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-5 text-sm text-slate-600">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={includeStock} onChange={(event) => { setIncludeStock(event.target.checked); setTransferPreview(null) }} />存量楼宇任务</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={includeFuture} onChange={(event) => { setIncludeFuture(event.target.checked); setTransferPreview(null) }} />当前及未来供应任务</label>
                  </div>
                </div>
                <div className="flex items-end">
                  <button type="button" onClick={() => void previewTransfer()} disabled={!transferTarget || (!includeStock && !includeFuture) || Boolean(busy)} className="h-10 rounded-lg border border-blue-200 bg-white px-4 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                    {busy === 'preview' ? '统计中…' : '核对任务'}
                  </button>
                </div>
              </div>

              {transferPreview && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="text-sm text-blue-900">
                    将转移 <strong>{transferPreview.totalCount}</strong> 项任务
                    <span className="ml-2 text-blue-700">存量 {transferPreview.stockCount} · 未来供应 {transferPreview.futureCount}</span>
                  </div>
                  <button type="button" onClick={() => void executeTransfer()} disabled={transferPreview.totalCount === 0 || Boolean(busy)} className="rounded-lg bg-[#004b8d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === 'transfer' ? '转移中…' : '确认转移'}
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {oneTimeCredential && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="临时登录信息">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900">临时登录信息</h2>
            <p className="mt-1 text-sm text-slate-500">密码仅在此处显示一次，请复制后安全地交给用户。</p>
            <div className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="text-xs text-slate-400">邮箱</div>
                <div className="mt-1 break-all text-sm text-slate-800">{oneTimeCredential.email || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">临时密码</div>
                <div className="mt-1 break-all font-mono text-base font-semibold text-slate-900">{oneTimeCredential.password}</div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(`邮箱：${oneTimeCredential.email}\n临时密码：${oneTimeCredential.password}`)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                复制登录信息
              </button>
              <button type="button" onClick={() => setOneTimeCredential(null)} className="rounded-lg bg-[#004b8d] px-4 py-2 text-sm font-semibold text-white">
                我已保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
