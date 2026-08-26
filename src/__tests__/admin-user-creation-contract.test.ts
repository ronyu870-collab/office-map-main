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

  it('keeps phone optional in the admin create-user form', () => {
    const manager = source('src/components/admin/UserManager.tsx')

    expect(manager).toContain('<Field label="电话" field="phone" form={createForm} setForm={setCreateForm} />')
    expect(manager).not.toContain('<Field label="电话 *"')
  })

  it('keeps success feedback and refresh after a completed create', () => {
    const manager = source('src/components/admin/UserManager.tsx')

    expect(manager).toContain('setOneTimeCredential({ email: createForm.email.trim(), password: createPassword })')
    expect(manager).toContain('await fetchUsers()')
    expect(manager).toContain('临时登录信息')
  })
})
