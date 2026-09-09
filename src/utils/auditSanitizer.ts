const SENSITIVE_KEY = /(password|passcode|access[_-]?token|refresh[_-]?token|authorization|cookie|api[_-]?key|secret|supabase_secret_key)/i;

export function isSensitiveAuditKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeAuditPayload(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveAuditKey(key)) {
      clean[key] = '[REDACTED]';
      continue;
    }
    clean[key] = sanitizeAuditPayload(child, depth + 1);
  }
  return clean;
}

export function sanitizeAuditText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/(authorization|cookie|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000);
}
