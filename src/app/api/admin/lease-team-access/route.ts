import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { denyImpersonatedMutation, resolveEffectiveRequestIdentity, type EffectiveRequestIdentity } from '@/src/lib/server/impersonationAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SETTING_KEY = 'editor_can_view_lease_team_submissions'

type AdminContext = {
  client: SupabaseClient
  caller: User
  identity: EffectiveRequestIdentity
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
  const identityResult = await resolveEffectiveRequestIdentity(request, client)
  if ('response' in identityResult) return identityResult.response
  const { identity } = identityResult
  if (identity.effectiveRole !== 'admin') {
    return NextResponse.json({ error: '权限不足，仅管理员可执行此操作' }, { status: 403 })
  }
  return { client, caller: identity.caller, identity }
}

function isAdminContext(value: AdminContext | NextResponse): value is AdminContext {
  return !(value instanceof NextResponse)
}

async function readEnabled(client: SupabaseClient) {
  const { data, error } = await client
    .from('system_settings')
    .select('boolean_value, updated_at')
    .eq('key', SETTING_KEY)
    .maybeSingle()
  if (error) throw error
  return {
    enabled: data?.boolean_value ?? true,
    updatedAt: data?.updated_at ?? null,
  }
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireAdmin(request)
    if (!isAdminContext(context)) return context
    return NextResponse.json(await readEnabled(context.client), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[admin/lease-team-access] 读取设置失败:', error)
    return NextResponse.json({ error: '读取租赁成交权限设置失败' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireAdmin(request)
    if (!isAdminContext(context)) return context
    const impersonationBlock = denyImpersonatedMutation(context.identity)
    if (impersonationBlock) return impersonationBlock
    const body = await request.json() as Record<string, unknown>
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: '缺少有效的开关状态' }, { status: 400 })
    }

    const before = await readEnabled(context.client)
    const { error: saveError } = await context.client
      .from('system_settings')
      .upsert({
        key: SETTING_KEY,
        boolean_value: body.enabled,
        updated_by: context.caller.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
    if (saveError) throw saveError

    const { count: editorCount, error: countError } = await context.client
      .from('user_roles')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', 'editor')
    if (countError) throw countError

    const { error: auditError } = await context.client.from('audit_logs').insert({
      user_id: context.caller.email || context.caller.id,
      action_type: 'UPDATE_LEASE_TEAM_ACCESS',
      target_table: 'system_settings',
      target_id: SETTING_KEY,
      details: {
        setting_key: SETTING_KEY,
        enabled_before: before.enabled,
        enabled_after: body.enabled,
        affected_editor_count: editorCount ?? 0,
      },
    })
    if (auditError) console.error('[admin/lease-team-access] 审计日志写入失败:', auditError.message)

    return NextResponse.json({
      success: true,
      enabled: body.enabled,
      editorCount: editorCount ?? 0,
      message: body.enabled
        ? `已向 ${editorCount ?? 0} 名编辑用户开放团队成交汇总`
        : `已关闭 ${editorCount ?? 0} 名编辑用户的团队成交汇总访问权限`,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin/lease-team-access] 更新设置失败:', error)
    return NextResponse.json({ error: '更新租赁成交权限设置失败' }, { status: 500 })
  }
}
