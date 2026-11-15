/** The same user-entered keyword semantics for stock and future supply. */
export function normalizeMapSearchText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').toLocaleLowerCase();
}
