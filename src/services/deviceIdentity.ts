const DEVICE_ID_KEY = 'colliers_device_id_v1';

let memoryDeviceId: string | null = null;

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns a browser-scoped identifier used only for audit correlation.
 * It is not a physical-device fingerprint and intentionally changes when site
 * storage is cleared or a different browser/profile is used.
 */
export function getOrCreateDeviceId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY)?.trim();
    if (existing) {
      memoryDeviceId = existing;
      return existing;
    }

    const created = createDeviceId();
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    memoryDeviceId = created;
    return created;
  } catch {
    // Privacy modes or hardened browsers may deny localStorage. Keep a stable
    // identifier for the current page lifetime without blocking the product.
    if (!memoryDeviceId) memoryDeviceId = createDeviceId();
    return memoryDeviceId;
  }
}

export const AUDIT_DEVICE_ID_STORAGE_KEY = DEVICE_ID_KEY;
