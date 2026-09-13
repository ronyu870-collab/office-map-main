import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeAuditBestEffort } from '@/src/lib/serverAudit';

function clientReturning(result: unknown): SupabaseClient {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(async () => result),
    })),
  } as unknown as SupabaseClient;
}

describe('writeAuditBestEffort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms successful persistence', async () => {
    const client = clientReturning({ error: null });
    await expect(writeAuditBestEffort(client, { action_type: 'TEST_ACTION' }, 'test')).resolves.toBe(true);
  });

  it('reports Supabase insert errors without throwing into the business flow', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = clientReturning({ error: { code: '42501', message: 'denied' } });

    await expect(writeAuditBestEffort(client, { action_type: 'TEST_ACTION' }, 'test')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[audit][server] write failed', expect.objectContaining({
      context: 'test',
      code: '42501',
    }));
  });

  it('reports thrown transport failures without throwing into the business flow', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => { throw new Error('network down'); }),
      })),
    } as unknown as SupabaseClient;

    await expect(writeAuditBestEffort(client, { action_type: 'TEST_ACTION' }, 'test')).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[audit][server] write threw', expect.objectContaining({
      context: 'test',
      message: 'network down',
    }));
  });
});
