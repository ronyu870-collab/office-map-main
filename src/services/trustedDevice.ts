const TRUSTED_UNTIL_KEY = 'colliers_trusted_device_until';
const TRUST_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

type TrustState = 'trusted' | 'untrusted' | 'expired';

function getTrustState(): TrustState {
  if (typeof window === 'undefined') return 'untrusted';

  const raw = window.localStorage.getItem(TRUSTED_UNTIL_KEY);
  if (!raw) return 'untrusted';

  const expiresAt = Number(raw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    window.localStorage.removeItem(TRUSTED_UNTIL_KEY);
    return 'expired';
  }

  return 'trusted';
}

/** 仅保存设备信任期限；从不保存密码。 */
export function setTrustedDevice(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) {
    window.localStorage.setItem(TRUSTED_UNTIL_KEY, String(Date.now() + TRUST_DURATION_MS));
  } else {
    window.localStorage.removeItem(TRUSTED_UNTIL_KEY);
  }
}

export function isTrustedDevice(): boolean {
  return getTrustState() === 'trusted';
}

export function getTrustedDeviceRemainingMs(): number | null {
  if (!isTrustedDevice() || typeof window === 'undefined') return null;
  const expiresAt = Number(window.localStorage.getItem(TRUSTED_UNTIL_KEY));
  return Math.max(0, expiresAt - Date.now());
}

/** 供 Supabase Auth 使用：可信设备持久保存，其他设备仅保留到浏览器关闭。 */
export const deviceAwareAuthStorage = {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;

    const trustState = getTrustState();
    if (trustState === 'trusted') return window.localStorage.getItem(key);
    if (trustState === 'expired') {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
      return null;
    }

    const temporarySession = window.sessionStorage.getItem(key);
    if (temporarySession) return temporarySession;

    // 旧版本统一写入 localStorage；首次升级时转移到临时会话，避免突然中断在用账号。
    const legacySession = window.localStorage.getItem(key);
    if (legacySession) {
      window.sessionStorage.setItem(key, legacySession);
      window.localStorage.removeItem(key);
    }
    return legacySession;
  },
  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    const storage = isTrustedDevice() ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
    (storage === window.localStorage ? window.sessionStorage : window.localStorage).removeItem(key);
  },
  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};
