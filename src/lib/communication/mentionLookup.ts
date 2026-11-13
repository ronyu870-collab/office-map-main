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
