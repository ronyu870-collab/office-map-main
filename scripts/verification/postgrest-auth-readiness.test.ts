import { describe, expect, it, vi } from 'vitest';
import { waitForPostgrestAuth } from './postgrest-auth-readiness.mjs';

const future = { status: 401, error: { code: 'PGRST303', message: 'JWT issued at future' } };
describe('disposable Auth / Data API clock readiness', () => {
  it('waits for an unchanged real token to be accepted by a read', async () => {
    const probe = vi.fn().mockResolvedValueOnce(future).mockResolvedValue({ status: 200, error: null });
    const pause = vi.fn().mockResolvedValue(undefined);
    await waitForPostgrestAuth(probe, pause);
    expect(probe).toHaveBeenCalledTimes(2); expect(pause).toHaveBeenCalledExactlyOnceWith(250);
  });
  it.each([
    { status: 403, error: { code: '42501', message: 'permission denied' } },
    { status: 401, error: { code: 'PGRST303', message: 'JWT expired' } },
    { status: 503, error: { code: 'PGRST000', message: 'unavailable' } },
  ])('does not conceal other authentication, permission or service failures', async response => {
    const probe = vi.fn().mockResolvedValue(response), pause = vi.fn();
    await expect(waitForPostgrestAuth(probe, pause)).rejects.toThrow('DISPOSABLE_AUTH_READINESS_REJECTED');
    expect(probe).toHaveBeenCalledOnce(); expect(pause).not.toHaveBeenCalled();
  });
  it('fails after the bounded readiness window', async () => {
    const probe = vi.fn().mockResolvedValue(future), pause = vi.fn().mockResolvedValue(undefined);
    await expect(waitForPostgrestAuth(probe, pause)).rejects.toThrow('DISPOSABLE_AUTH_CLOCK_NOT_READY');
    expect(probe).toHaveBeenCalledTimes(8); expect(pause).toHaveBeenCalledTimes(7);
  });
});
