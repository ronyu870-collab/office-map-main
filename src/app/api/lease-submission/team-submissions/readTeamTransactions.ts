import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeaseTransaction } from '@/src/types/lease-transaction';

const PAGE_SIZE = 500;
const READ_BUDGET_MS = 20_000;

/** Authorized callers only. Never return a truncated list when a later page fails. */
export async function readTeamTransactions(client: SupabaseClient): Promise<LeaseTransaction[]> {
  const started = Date.now();
  const upperCreatedAt = new Date(started).toISOString();
  const records: LeaseTransaction[] = [];
  let cursor = { createdAt: '', id: '' };
  for (;;) {
    if (Date.now() - started >= READ_BUDGET_MS) throw new Error('Team transaction read timeout');
    let query = client
      .from('lease_transactions')
      .select('*')
      .gte('created_at', '2026-04-23T00:00:00Z')
      .lte('created_at', upperCreatedAt)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);
    if (cursor.createdAt) {
      // Keep the database timestamp verbatim: Date would discard PostgreSQL microseconds.
      // A deleted cursor row still defines this boundary; offsets do not.
      query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }
    const { data, error } = await query
      .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(10_000, READ_BUDGET_MS - (Date.now() - started)))));
    if (error) throw new Error(error.message);
    if (Date.now() - started >= READ_BUDGET_MS) throw new Error('Team transaction read timeout');
    const page = (data ?? []) as LeaseTransaction[];
    records.push(...page);
    if (page.length < PAGE_SIZE) return records;
    const last = page[page.length - 1];
    if (!last.created_at || !last.id) throw new Error('Team transaction page is missing its cursor');
    if (cursor.createdAt === last.created_at && cursor.id === last.id) {
      throw new Error('Team transaction pagination did not advance');
    }
    cursor = { createdAt: last.created_at, id: last.id };
  }
}
