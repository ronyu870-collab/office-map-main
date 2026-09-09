import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('auth audit session context contract', () => {
  it('keeps a durable session snapshot and matches refreshes by updated_at', () => {
    const migration = read('supabase/migrations/20260909084827_fix_auth_audit_session_context.sql');
    expect(migration).toContain('create table if not exists public.auth_session_audit_context');
    expect(migration).toContain('coalesce(s.updated_at, s.created_at)');
    expect(migration).toContain('snapshot.auth_ip_address');
    expect(migration).toContain('snapshot.application_ip_address');
  });

  it('syncs Supabase Auth session IP and User-Agent without a browser request', () => {
    const migration = read('supabase/migrations/20260909084927_sync_auth_session_audit_context.sql');
    expect(migration).toContain('after insert or update of updated_at, ip, user_agent on auth.sessions');
    expect(migration).toContain('auth_ip_address');
    expect(migration).toContain('auth_user_agent');
  });

  it('keeps application-observed context as a best-effort fallback', () => {
    const route = read('src/app/api/audit-events/route.ts');
    expect(route).toContain(".from('auth_session_audit_context')");
    expect(route).toContain('application_ip_address');
    expect(route).toContain('application_user_agent');
    expect(route).toContain('snapshotError');
  });
});
