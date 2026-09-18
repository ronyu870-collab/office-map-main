import { describe, expect, it, vi } from 'vitest';

import {
  denyImpersonatedMutation,
  resolveEffectiveRequestIdentity,
  type EffectiveRequestIdentity,
} from '../impersonationAuth';

function createClient(params: {
  callerId?: string;
  callerRole: string;
  target?: {
    user_id: string;
    role: string;
    email?: string;
    chinese_name?: string;
    full_name?: string;
  } | null;
}) {
  let profileRead = 0;
  const maybeSingle = vi.fn(async () => {
    profileRead += 1;
    if (profileRead === 1) return { data: { role: params.callerRole }, error: null };
    return { data: params.target ?? null, error: null };
  });
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: {
            id: params.callerId ?? 'admin-1',
            email: 'admin@colliers.test',
          },
        },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  };
  return { client: client as any, maybeSingle };
}

describe('resolveEffectiveRequestIdentity', () => {
  it('uses the real JWT identity when no simulation header is present', async () => {
    const { client } = createClient({ callerRole: 'admin' });
    const request = new Request('https://example.test/api', {
      headers: { Authorization: 'Bearer verified-token' },
    });

    const result = await resolveEffectiveRequestIdentity(request, client);
    expect('identity' in result).toBe(true);
    if (!('identity' in result)) return;
    expect(result.identity.effectiveUserId).toBe('admin-1');
    expect(result.identity.effectiveRole).toBe('admin');
    expect(result.identity.isImpersonating).toBe(false);
  });

  it('keeps the real admin authenticated while inheriting the simulated editor role', async () => {
    const { client } = createClient({
      callerRole: 'admin',
      target: {
        user_id: 'editor-7',
        role: 'editor',
        email: 'editor@colliers.test',
        chinese_name: '编辑用户',
      },
    });
    const request = new Request('https://example.test/api', {
      headers: {
        Authorization: 'Bearer verified-token',
        'X-Colliers-Impersonate-User': 'editor-7',
      },
    });

    const result = await resolveEffectiveRequestIdentity(request, client);
    expect('identity' in result).toBe(true);
    if (!('identity' in result)) return;
    expect(result.identity.caller.id).toBe('admin-1');
    expect(result.identity.callerRole).toBe('admin');
    expect(result.identity.effectiveUserId).toBe('editor-7');
    expect(result.identity.effectiveRole).toBe('editor');
    expect(result.identity.isImpersonating).toBe(true);
    expect(result.identity.targetDisplayName).toBe('编辑用户');
  });

  it('rejects a simulation header from a non-admin real session', async () => {
    const { client, maybeSingle } = createClient({
      callerId: 'editor-real',
      callerRole: 'editor',
      target: { user_id: 'viewer-2', role: 'viewer' },
    });
    const request = new Request('https://example.test/api', {
      headers: {
        Authorization: 'Bearer verified-token',
        'X-Colliers-Impersonate-User': 'viewer-2',
      },
    });

    const result = await resolveEffectiveRequestIdentity(request, client);
    expect('response' in result).toBe(true);
    if (!('response' in result)) return;
    expect(result.response.status).toBe(403);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('blocks privileged mutations whenever a simulation is active', () => {
    const identity: EffectiveRequestIdentity = {
      caller: { id: 'admin-1' } as any,
      callerRole: 'admin',
      effectiveUserId: 'editor-7',
      effectiveRole: 'editor',
      isImpersonating: true,
      targetEmail: null,
      targetDisplayName: null,
    };

    expect(denyImpersonatedMutation(identity)?.status).toBe(403);
    expect(denyImpersonatedMutation({ ...identity, isImpersonating: false })).toBeNull();
  });
});
