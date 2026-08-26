import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ADMIN_FORM_ROLES = new Set(['admin', 'editor', 'user'])
const PROFILE_FIELDS = ['chinese_name', 'full_name', 'phone', 'gender', 'title', 'internal_number'] as const

type AdminContext = {
  client: SupabaseClient
  caller: User
}

function toDatabaseRole(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!ADMIN_FORM_ROLES.has(normalized)) return null
  return normalized === 'user' ? 'viewer' : normalized
}

function toAdminRole(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'viewer' ? 'user' : normalized
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Server misconfiguration')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

async function requireAdmin(request: NextRequest): Promise<AdminContext | NextResponse> {
  const client = createAdminClient()
  const accessToken = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!accessToken) return NextResponse.json({ error: '未提供认证 Token' }, { status: 401 })

  const { data: { user: caller }, error: authError } = await client.auth.getUser(accessToken)
  if (authError || !caller) return NextResponse.json({ error: '登录状态已失效' }, { status: 401 })

  const { data: roleRow, error: roleError } = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle()
  if (roleError || roleRow?.role !== 'admin') {
    return NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 })
  }
  return { client, caller }
}

function isAdminContext(value: AdminContext | NextResponse): value is AdminContext {
  return !(value instanceof NextResponse)
}

async function audit(
  client: SupabaseClient,
  caller: User,
  operation: string,
  targetUserId: string,
  details: Record<string, unknown> = {},
) {
  const { error } = await client.from('audit_logs').insert({
    user_id: caller.email || caller.id,
    action_type: 'ADMIN_DATA_OPERATION',
    target_table: 'user_roles',
    target_id: targetUserId,
    details: {
      operation,
      table: 'user_roles',
      table_label: '用户管理',
      target_user_id: targetUserId,
      ...details,
    },
  })
  if (error) console.error('[admin/users] 审计日志写入失败:', error.message)
}

function normalizeText(value: unknown, maxLength = 200) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text.slice(0, maxLength) : null
}

function currentQuarter() {
  const now = new Date()
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 }
}

async function updateAssignmentsInChunks(
  client: SupabaseClient,
  table: 'building_assignments' | 'future_supply_assignments',
  ids: string[],
  values: { user_id: string; user_name: string },
) {
  const completedIds: string[] = []
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100)
    const { error } = await client.from(table).update(values).in('id', chunk)
    if (error) return { error, completedIds }
    completedIds.push(...chunk)
  }
  return { error: null, completedIds }
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireAdmin(request)
    if (!isAdminContext(context)) return context
    const { client } = context

    const [profilesResult, authResult, stockResult, futureResult] = await Promise.all([
      client.from('user_roles').select('user_id, role, chinese_name, full_name, email, phone, gender, title, internal_number, created_at').order('created_at', { ascending: false }),
      client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      client.from('building_assignments').select('user_id'),
      client.from('future_supply_assignments').select('user_id, record_year, record_quarter'),
    ])

    if (profilesResult.error) throw profilesResult.error
    if (authResult.error) throw authResult.error
    if (stockResult.error) throw stockResult.error
    if (futureResult.error) throw futureResult.error

    const authById = new Map(authResult.data.users.map((user) => [user.id, user]))
    const stockCounts = new Map<string, number>()
    const futureCounts = new Map<string, number>()
    const period = currentQuarter()

    for (const row of stockResult.data ?? []) {
      if (row.user_id) stockCounts.set(row.user_id, (stockCounts.get(row.user_id) ?? 0) + 1)
    }
    for (const row of futureResult.data ?? []) {
      const isCurrentOrFuture = Number(row.record_year) > period.year
        || (Number(row.record_year) === period.year && Number(row.record_quarter) >= period.quarter)
      if (row.user_id && isCurrentOrFuture) {
        futureCounts.set(row.user_id, (futureCounts.get(row.user_id) ?? 0) + 1)
      }
    }

    const users = (profilesResult.data ?? []).map((profile) => {
      const authUser = authById.get(profile.user_id)
      const bannedUntil = authUser?.banned_until ?? null
      const disabled = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now())
      return {
        ...profile,
        // Admin UI historically calls viewer "user". Keep that presentation alias at the API boundary.
        role: toAdminRole(profile.role),
        email: authUser?.email ?? profile.email,
        disabled,
        banned_until: bannedUntil,
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        stock_assignment_count: stockCounts.get(profile.user_id) ?? 0,
        future_assignment_count: futureCounts.get(profile.user_id) ?? 0,
      }
    })

    return NextResponse.json({ users })
  } catch (error) {
    console.error('[admin/users] 获取用户失败:', error)
    return NextResponse.json({ error: '用户列表加载失败' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireAdmin(request)
    if (!isAdminContext(context)) return context
    const { client, caller } = context
    const body = await request.json() as Record<string, unknown>
    const action = String(body.action ?? '')
    const userId = String(body.userId ?? '').trim()
    if (!userId) return NextResponse.json({ error: '缺少目标用户' }, { status: 400 })

    if (action === 'update_profile') {
      const requestedRole = String(body.role ?? '').trim().toLowerCase()
      const expectedRequestedRole = String(body.expectedRole ?? '').trim().toLowerCase()
      const role = toDatabaseRole(requestedRole)
      const expectedRole = toDatabaseRole(expectedRequestedRole)
      const email = normalizeText(body.email, 320)
      if (!role) return NextResponse.json({ error: '无效的用户角色' }, { status: 400 })
      if (!expectedRole) return NextResponse.json({ error: '页面数据已过期，请刷新用户列表后再保存' }, { status: 409 })
      if (!email || !email.includes('@')) return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
      if (userId === caller.id && role !== 'admin') {
        return NextResponse.json({ error: '不能取消自己的管理员权限' }, { status: 400 })
      }

      const { data: oldProfile, error: oldProfileError } = await client
        .from('user_roles')
        .select('role, email, chinese_name, full_name, phone, gender, title, internal_number')
        .eq('user_id', userId)
        .maybeSingle()
      if (oldProfileError || !oldProfile) return NextResponse.json({ error: '目标用户不存在' }, { status: 404 })
      const currentRole = String(oldProfile.role ?? '').trim().toLowerCase()
      if (currentRole !== expectedRole) {
        return NextResponse.json({ error: '该用户资料已在其他页面更新，请刷新用户列表后再保存' }, { status: 409 })
      }

      const profileUpdate: Record<string, string | null> = { role, email }
      for (const field of PROFILE_FIELDS) profileUpdate[field] = normalizeText(body[field], field === 'phone' ? 50 : 200)

      const { data: authProfile, error: authProfileError } = await client.auth.admin.getUserById(userId)
      if (authProfileError || !authProfile.user) return NextResponse.json({ error: '找不到对应的登录账号' }, { status: 404 })
      const previousAuthEmail = authProfile.user.email ?? oldProfile.email
      const emailChanged = previousAuthEmail !== email
      if (emailChanged) {
        const { error: authUpdateError } = await client.auth.admin.updateUserById(userId, { email, email_confirm: true })
        if (authUpdateError) return NextResponse.json({ error: `邮箱修改失败：${authUpdateError.message}` }, { status: 400 })
      }

      const { data: savedProfile, error: profileError } = await client
        .from('user_roles')
        .update(profileUpdate)
        .eq('user_id', userId)
        .eq('role', expectedRole)
        .select('user_id, role')
        .maybeSingle()
      if (profileError) {
        if (emailChanged && previousAuthEmail) {
          await client.auth.admin.updateUserById(userId, { email: previousAuthEmail, email_confirm: true })
        }
        return NextResponse.json({ error: `资料保存失败：${profileError.message}` }, { status: 500 })
      }
      if (!savedProfile) {
        if (emailChanged && previousAuthEmail) {
          await client.auth.admin.updateUserById(userId, { email: previousAuthEmail, email_confirm: true })
        }
        return NextResponse.json({ error: '该用户资料已在其他页面更新，请刷新用户列表后再保存' }, { status: 409 })
      }

      const changedFields = Object.keys(profileUpdate).filter((key) => oldProfile[key as keyof typeof oldProfile] !== profileUpdate[key])
      await audit(client, caller, 'UPDATE_USER_PROFILE', userId, {
        changed_fields: changedFields,
        requested_role: requestedRole,
        expected_role: expectedRequestedRole,
        role_before: currentRole,
        role_after: savedProfile.role,
      })
      return NextResponse.json({
        success: true,
        message: '用户资料和角色已更新',
        user: { ...savedProfile, role: toAdminRole(savedProfile.role) },
      })
    }

    if (action === 'set_status') {
      const disabled = body.disabled === true
      if (userId === caller.id) return NextResponse.json({ error: '不能停用自己的账号' }, { status: 400 })

      const { error: authUpdateError } = await client.auth.admin.updateUserById(userId, {
        ban_duration: disabled ? '876000h' : 'none',
      })
      if (authUpdateError) return NextResponse.json({ error: `账号状态修改失败：${authUpdateError.message}` }, { status: 500 })
      if (disabled) await client.from('user_roles').update({ session_id: null }).eq('user_id', userId)

      await audit(client, caller, disabled ? 'DISABLE_USER' : 'ENABLE_USER', userId)
      return NextResponse.json({ success: true, message: disabled ? '账号已停用，历史数据保持不变' : '账号已重新启用' })
    }

    if (action === 'transfer_assignments') {
      const targetUserId = String(body.targetUserId ?? '').trim()
      const includeStock = body.includeStock !== false
      const includeFuture = body.includeFuture !== false
      const dryRun = body.dryRun === true
      if (!targetUserId || targetUserId === userId) return NextResponse.json({ error: '请选择不同的接收人' }, { status: 400 })
      if (!includeStock && !includeFuture) return NextResponse.json({ error: '请至少选择一种任务' }, { status: 400 })

      const { data: targetProfile, error: targetError } = await client
        .from('user_roles')
        .select('chinese_name, full_name, email')
        .eq('user_id', targetUserId)
        .maybeSingle()
      if (targetError || !targetProfile) return NextResponse.json({ error: '接收人不存在' }, { status: 404 })
      const { data: sourceProfile } = await client
        .from('user_roles')
        .select('chinese_name, full_name, email')
        .eq('user_id', userId)
        .maybeSingle()
      const targetName = targetProfile.chinese_name || targetProfile.full_name || targetProfile.email || targetUserId
      const sourceName = sourceProfile?.chinese_name || sourceProfile?.full_name || sourceProfile?.email || userId

      const [stockResult, futureResult] = await Promise.all([
        includeStock ? client.from('building_assignments').select('id').eq('user_id', userId) : Promise.resolve({ data: [], error: null }),
        includeFuture ? client.from('future_supply_assignments').select('id, record_year, record_quarter').eq('user_id', userId) : Promise.resolve({ data: [], error: null }),
      ])
      if (stockResult.error || futureResult.error) return NextResponse.json({ error: '任务统计失败' }, { status: 500 })

      const period = currentQuarter()
      const stockIds = (stockResult.data ?? []).map((row) => row.id)
      const futureIds = (futureResult.data ?? [])
        .filter((row) => Number(row.record_year) > period.year || (Number(row.record_year) === period.year && Number(row.record_quarter) >= period.quarter))
        .map((row) => row.id)

      if (dryRun) {
        return NextResponse.json({ success: true, stockCount: stockIds.length, futureCount: futureIds.length, totalCount: stockIds.length + futureIds.length })
      }
      if (stockIds.length + futureIds.length === 0) return NextResponse.json({ error: '没有可转移的当前或未来任务' }, { status: 400 })

      const stockTransfer = await updateAssignmentsInChunks(
        client,
        'building_assignments',
        stockIds,
        { user_id: targetUserId, user_name: targetName },
      )
      if (stockTransfer.error) {
        if (stockTransfer.completedIds.length > 0) {
          await updateAssignmentsInChunks(
            client,
            'building_assignments',
            stockTransfer.completedIds,
            { user_id: userId, user_name: sourceName },
          )
        }
        return NextResponse.json({ error: `存量楼宇任务转移失败，已完成部分已回滚：${stockTransfer.error.message}` }, { status: 500 })
      }

      const futureTransfer = await updateAssignmentsInChunks(
        client,
        'future_supply_assignments',
        futureIds,
        { user_id: targetUserId, user_name: targetName },
      )
      if (futureTransfer.error) {
        if (futureTransfer.completedIds.length > 0) {
          await updateAssignmentsInChunks(
            client,
            'future_supply_assignments',
            futureTransfer.completedIds,
            { user_id: userId, user_name: sourceName },
          )
        }
        await updateAssignmentsInChunks(
          client,
          'building_assignments',
          stockIds,
          { user_id: userId, user_name: sourceName },
        )
        return NextResponse.json({ error: `未来供应任务转移失败，已完成任务已回滚：${futureTransfer.error.message}` }, { status: 500 })
      }

      await audit(client, caller, 'TRANSFER_USER_ASSIGNMENTS', userId, {
        target_user_id: targetUserId,
        stock_count: stockIds.length,
        future_count: futureIds.length,
        historical_submissions_changed: false,
      })
      return NextResponse.json({ success: true, message: `已转移 ${stockIds.length + futureIds.length} 项当前及未来任务，历史填报未修改` })
    }

    return NextResponse.json({ error: '不支持的操作' }, { status: 400 })
  } catch (error) {
    console.error('[admin/users] 操作失败:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
