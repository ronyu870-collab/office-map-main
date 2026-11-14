/**
 * The @ search accepts an exact English given name, never prefixes.
 * No lookup for a bare @, partial Chinese names, or a broad empty query.
 */
export function normalizeMentionLookupTerm(input: string | null): string | null {
  if (input === '所有人') return input;
  return input && /^[a-z][a-z'-]{1,39}$/i.test(input) ? input.toLowerCase() : null;
}

export function matchEnglishFirstName(fullName: unknown, term: string): string | null {
  if (typeof fullName !== 'string') return null;
  const normalized = fullName.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  const firstName = normalized.split(' ')[0];
  return normalizeMentionLookupTerm(firstName) === term ? normalized : null;
}

/**
 * Mirrors the admin user-management "disabled" status: a future Auth
 * banned_until is disabled. Soft-deleted identities must not be suggested.
 * Malformed non-null ban dates fail closed rather than exposing an account.
 */
export function isMentionableAuthUser(
  user: { banned_until?: string | null; deleted_at?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!user || user.deleted_at) return false;
  if (user.banned_until == null) return true;
  const bannedUntil = Date.parse(user.banned_until);
  return Number.isFinite(bannedUntil) && bannedUntil <= now;
}
