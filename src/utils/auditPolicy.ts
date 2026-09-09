const NOISY_WINDOWS_MS: Record<string, number> = {
  PAGE_VIEW: 15_000,
  ENTER_MODULE: 5_000,
  SEARCH: 3_000,
  FILTER: 2_000,
  MAP_FILTER: 2_000,
  VIEW_BUILDING: 10_000,
  VIEW_CHART: 10_000,
  VIEW_BI_CHART: 10_000,
  LOOKUP_LEASE_COMPANY_HISTORY: 5_000,
  OPEN_LEASE_FORM: 5_000,
};

const NOISY_BUDGET_WINDOW_MS = 60_000;
const MAX_NOISY_EVENTS_PER_WINDOW = 120;
const MAX_RECENT_KEYS = 500;

function normalizedValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) return '[depth]';
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => normalizedValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 30)
        .map(([key, item]) => [key, normalizedValue(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 200);
}

function fingerprint(actionType: string, details: Record<string, unknown>): string {
  const serialized = JSON.stringify(normalizedValue(details));
  return `${actionType}:${serialized.slice(0, 1200)}`;
}

export function isNoisyAuditAction(actionType: string): boolean {
  return Object.prototype.hasOwnProperty.call(NOISY_WINDOWS_MS, actionType.trim().toUpperCase());
}

export class AuditPolicyGate {
  private recent = new Map<string, number>();
  private bucketStartedAt: number | null = null;
  private bucketCount = 0;

  shouldRecord(actionType: string, details: Record<string, unknown> = {}, now = Date.now()): boolean {
    const normalized = actionType.trim().toUpperCase();
    const dedupeWindow = NOISY_WINDOWS_MS[normalized];
    if (!dedupeWindow) return true;

    if (this.bucketStartedAt === null || now - this.bucketStartedAt >= NOISY_BUDGET_WINDOW_MS) {
      this.bucketStartedAt = now;
      this.bucketCount = 0;
    }
    if (this.bucketCount >= MAX_NOISY_EVENTS_PER_WINDOW) return false;

    const key = fingerprint(normalized, details);
    const last = this.recent.get(key);
    if (last !== undefined && now - last < dedupeWindow) return false;

    this.recent.set(key, now);
    this.bucketCount += 1;

    if (this.recent.size > MAX_RECENT_KEYS) {
      for (const [recentKey, timestamp] of this.recent) {
        if (now - timestamp > NOISY_BUDGET_WINDOW_MS) this.recent.delete(recentKey);
      }
    }
    return true;
  }

  reset(): void {
    this.recent.clear();
    this.bucketStartedAt = null;
    this.bucketCount = 0;
  }
}

export const auditPolicyGate = new AuditPolicyGate();
