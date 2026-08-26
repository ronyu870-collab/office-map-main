import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('admin user creation contract', () => {
  it('uses the canonical viewer/editor/admin role contract end to end', () => {
    const authTypes = source('src/types/auth.ts')
    const manager = source('src/components/admin/UserManager.tsx')
    const createRoute = source('src/app/api/admin/create-user/route.ts')
    const usersRoute = source('src/app/api/admin/users/route.ts')

    expect(authTypes).toContain("APP_ROLES = ['viewer', 'editor', 'admin']")
    expect(manager).toContain("type UserRole = 'admin' | 'editor' | 'viewer'")
    expect(manager).toContain('option value="viewer"')
    expect(manager).not.toContain('option value="user"')
    expect(createRoute).toContain("? 'viewer'")
    expect(createRoute).toContain('parseUserRole(role)')
    expect(usersRoute).toContain('new Set<string>(APP_ROLES)')
  })

  it('keeps phone optional while email and initial password remain required', () => {
    const manager = source('src/components/admin/UserManager.tsx')
    const createRoute = source('src/app/api/admin/create-user/route.ts')

    expect(manager).toContain('label="电话" field="phone" form={createForm} setForm={setCreateForm} />')
    expect(manager).not.toContain('label="电话 *"')
    expect(manager).toContain('label="邮箱 *" field="email"')
    expect(manager).toContain('初始密码 *')
    expect(createRoute).toContain('phone: normalizeOptionalText(phone, 50)')
  })

  it('surfaces create failures above dialogs and verifies successful list refresh', () => {
    const manager = source('src/components/admin/UserManager.tsx')

    expect(manager).toContain("const result = await createUser(createForm, createPassword)")
    expect(manager).toContain('row.user_id === result.userId')
    expect(manager).toContain('用户已创建，但列表刷新失败，请点击刷新后核对')
    expect(manager).toContain('fixed right-4 top-4 z-[80]')
  })

  it('rolls back the Auth account when profile creation fails', () => {
    const createRoute = source('src/app/api/admin/create-user/route.ts')

    expect(createRoute).toContain('supabaseAdmin.auth.admin.deleteUser(userId)')
    expect(createRoute).toContain('创建用户档案失败')
  })
})
