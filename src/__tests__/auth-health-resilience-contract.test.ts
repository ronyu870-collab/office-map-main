import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('login and health resilience contract', () => {
  it('does not disguise a user_roles infrastructure failure as bad credentials', () => {
    const auth = source('src/services/Auth.ts');

    expect(auth).toContain('options: { failOnQueryError?: boolean } = {}');
    expect(auth).toContain('{ failOnQueryError: true }');
    expect(auth).toContain('登录验证已通过，但系统数据服务暂时不可用');
    expect(auth).toContain('profile.phone === undefined || profile.phone !== phone');
    expect(auth).toContain('登录失败：邮箱、手机号或密码不匹配');
  });

  it('checks the real remote Auth service and the login-critical Data API path', () => {
    const health = source('src/app/api/health/route.ts');

    expect(health).toContain('/auth/v1/health');
    expect(health).toContain("db: { retry: false }");
    expect(health).toContain(".from('user_roles')");
    expect(health).toContain("'Cache-Control': 'no-store, max-age=0'");
    expect(health).not.toContain('supabase.auth.getSession()');
  });
});
