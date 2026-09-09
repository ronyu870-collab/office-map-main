import { beforeEach, describe, expect, it } from 'vitest';
import { AUDIT_DEVICE_ID_STORAGE_KEY, getOrCreateDeviceId } from '@/src/services/deviceIdentity';

describe('deviceIdentity', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the browser device id stable across reads', () => {
    const first = getOrCreateDeviceId();
    const second = getOrCreateDeviceId();
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(localStorage.getItem(AUDIT_DEVICE_ID_STORAGE_KEY)).toBe(first);
  });

  it('creates a new id after site storage is cleared', () => {
    const first = getOrCreateDeviceId();
    localStorage.clear();
    const second = getOrCreateDeviceId();
    expect(second).not.toBe(first);
  });
});
