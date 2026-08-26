import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('admin user creation contract', () => {
  it('maps the admin UI ordinary-user alias to the canonical viewer role', () => {
    const createRoute = source('src/app/api/admin/create-user/route.ts')
    const usersRoute = source('src/app/api/admin/users/route.ts')

    expect(createRoute).toContain("normalized === 'user' ? 'viewer' : normalized")
    expect(usersRoute).toContain("normalized === 'user' ? 'viewer' : normalized")
    expect(usersRoute).toContain("normalized === 'viewer' ? 'user' : normalized")
  })

  it('upserts the trigger-created user profile instead of inserting the same primary key twice', () => {
    const createRoute = source('src/app/api/admin/create-user/route.ts')

    expect(createRoute).toContain(".from('user_roles')")
    expect(createRoute).toContain('.upsert({')
    expect(createRoute).toContain("{ onConflict: 'user_id' }")
    expect(createRoute).not.toContain(".from('user_roles')\n      .insert({\n        user_id: userId")
  })

  it('requires the same 11-digit phone credential in admin create and edit flows', () => {
    const manager = source('src/components/admin/UserManager.tsx')
    const createRoute = source('src/app/api/admin/create-user/route.ts')
    const usersRoute = source('src/app/api/admin/users/route.ts')

    expect(manager).toContain('<Field label="手机号 *" field="phone" form={createForm} setForm={setCreateForm} required type="tel" />')
    expect(manager).toContain('<Field label="手机号 *" field="phone" form={editForm} setForm={setEditForm} required type="tel" />')
    expect(manager).toContain("pattern={isPhone ? '\\\\d{11}' : undefined}")
    expect(createRoute).toContain("!/^\\d{11}$/.test(normalizedPhone)")
    expect(usersRoute).toContain("!/^\\d{11}$/.test(profileUpdate.phone)")
  })

  it('treats phone as a real login credential instead of overwriting it after login', () => {
    const auth = source('src/services/Auth.ts')

    expect(auth).toContain('phone: string;')
    expect(auth).toContain("!phone || !/^\\d{11}$/.test(phone)")
    expect(auth).toContain('profile.phone === undefined || profile.phone !== phone')
    expect(auth).toContain('登录失败：邮箱、手机号或密码不匹配')
    expect(auth).not.toContain('.update({ phone: submittedPhone })')
    expect(auth).not.toContain('手机号不是认证条件')
  })

  it('keeps success feedback and returns all three login credentials', () => {
    const manager = source('src/components/admin/UserManager.tsx')

    expect(manager).toContain('setOneTimeCredential({ email: createForm.email.trim(), phone, password: createPassword })')
    expect(manager).toContain('await fetchUsers()')
    expect(manager).toContain('临时登录信息')
    expect(manager).toContain('手机号：${oneTimeCredential.phone}')
  })
})
