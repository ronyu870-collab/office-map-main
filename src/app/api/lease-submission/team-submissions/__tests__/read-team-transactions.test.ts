import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { readTeamTransactions } from '../readTeamTransactions';

const READ_AT = Date.parse('2026-10-12T08:00:00Z');
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(READ_AT));
afterEach(() => vi.restoreAllMocks());

type SyntheticRecord = LeaseTransaction & { id: string; created_at: string };
const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
function records(total: number, sameTimestamp = false): SyntheticRecord[] {
  return Array.from({ length: total }, (_, i) => ({
    id: uuid(total - i),
    created_at: `2026-09-01T08:00:00.${sameTimestamp ? '123456' : String(999999 - i).padStart(6, '0')}Z`,
    company: `企业${i}`, new_building: '测试楼宇', transaction_year: 2026, transaction_quarter: 'Q3',
    submitter_id: 'u', submitter_name: '顾问', face_rent: 4 * 365 / 12, effective_rent: 100.375,
  }));
}

// Model timestamp comparisons independently at PostgreSQL microsecond precision.
function micros(timestamp: string): bigint {
  const fraction = /\.(\d+)(?=Z|[+-])/.exec(timestamp)?.[1] ?? '';
  const seconds = Date.parse(timestamp.replace(/\.\d+(?=Z|[+-])/, ''));
  return BigInt(seconds) * BigInt(1000) + BigInt(fraction.padEnd(6, '0'));
}

let fixtureId = 0;
function fixture(initial: SyntheticRecord[], options: { failRequest?: number; afterFirstPage?: (rows: SyntheticRecord[]) => void; ignoreCursor?: boolean } = {}) {
  const rows = [...initial];
  const urls: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    if (urls.length === options.failRequest) return new Response(JSON.stringify({ message: 'synthetic read failure' }), { status: 400 });
    let selected = [...rows];
    for (const condition of url.searchParams.getAll('created_at')) {
      const operator = condition.slice(0, 3);
      const bound = micros(condition.slice(4));
      selected = selected.filter(row => operator === 'gte' ? micros(row.created_at) >= bound : micros(row.created_at) <= bound);
    }
    const condition = url.searchParams.get('or');
    if (condition && !options.ignoreCursor) {
      const cursor = /^\(created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^)]+)\)\)$/.exec(condition);
      if (!cursor || cursor[1] !== cursor[2]) throw new Error('Invalid composite cursor filter: ' + condition);
      const bound = micros(cursor[1]);
      selected = selected.filter(row => micros(row.created_at) < bound || (micros(row.created_at) === bound && row.id < cursor[3]));
    }
    selected.sort((a, b) => {
      const delta = micros(b.created_at) - micros(a.created_at);
      return delta ? (delta > BigInt(0) ? 1 : -1) : b.id.localeCompare(a.id);
    });
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const page = selected.slice(offset, offset + Number(url.searchParams.get('limit')));
    const body = JSON.stringify(page);
    if (urls.length === 1) options.afterFirstPage?.(rows);
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `synthetic-${fixtureId++}` },
    global: { fetch: fetcher },
  });
  return { client, urls };
}

describe('团队成交完整读取（真实 SDK + 隔离 transport）', () => {
  it('reads 1201 records by a composite cursor and preserves timestamp microseconds and rent precision', async () => {
    const rows = records(1201);
    const { client, urls } = fixture(rows);
    expect(await readTeamTransactions(client)).toEqual(rows);
    expect(urls).toHaveLength(3);
    expect(urls[0].searchParams.has('or')).toBe(false);
    expect(urls[1].searchParams.get('or')).toBe(`(created_at.lt.${rows[499].created_at},and(created_at.eq.${rows[499].created_at},id.lt.${rows[499].id}))`);
    expect(urls[2].searchParams.get('or')).toBe(`(created_at.lt.${rows[999].created_at},and(created_at.eq.${rows[999].created_at},id.lt.${rows[999].id}))`);
    for (const url of urls) {
      expect(url.searchParams.has('offset')).toBe(false);
      expect(url.searchParams.get('limit')).toBe('500');
      expect(url.searchParams.getAll('created_at')).toEqual(['gte.2026-04-23T00:00:00Z', 'lte.2026-10-12T08:00:00.000Z']);
      expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc');
      expect(url.pathname).toBe('/rest/v1/lease_transactions');
    }
    expect(rows[0].face_rent).toBe(4 * 365 / 12);
    expect(rows[0].effective_rent).toBe(100.375);
  });
  it.each([0, 500, 1000])('handles %s records including exact page-size multiples', async (total) => {
    const rows = records(total);
    const { client, urls } = fixture(rows);
    expect(await readTeamTransactions(client)).toEqual(rows);
    expect(urls).toHaveLength(total / 500 + 1);
  });
  it('continues through 1201 identical timestamps using the ID tie breaker', async () => {
    const rows = records(1201, true);
    const { client } = fixture(rows);
    const result = await readTeamTransactions(client);
    expect(result).toEqual(rows);
    expect(new Set(result.map(row => row.id)).size).toBe(1201);
  });
  it('excludes a newly submitted row without duplicating existing records between pages', async () => {
    const rows = records(1001);
    const { client } = fixture(rows, { afterFirstPage: state => state.unshift({ ...rows[0], id: uuid(9999), created_at: '2026-10-12T08:00:01.000000Z' }) });
    const result = await readTeamTransactions(client);
    expect(result).toEqual(rows);
    expect(new Set(result.map(row => row.id)).size).toBe(result.length);
  });
  it('does not skip unrelated records when a previously read row is deleted', async () => {
    const rows = records(1001);
    const { client } = fixture(rows, { afterFirstPage: state => { state.splice(0, 1); } });
    expect(await readTeamTransactions(client)).toEqual(rows);
  });
  it('continues correctly after the last row of the first page is deleted', async () => {
    const rows = records(1001, true);
    const { client } = fixture(rows, { afterFirstPage: state => { state.splice(499, 1); } });
    expect(await readTeamTransactions(client)).toEqual(rows);
  });
  it('does not duplicate records after an insert at the same timestamp above the ID cursor', async () => {
    const rows = records(1001, true);
    const { client } = fixture(rows, { afterFirstPage: state => state.push({ ...rows[0], id: uuid(9999) }) });
    expect(await readTeamTransactions(client)).toEqual(rows);
  });
  it('uses the same upper time bound even when the clock advances between pages', async () => {
    const rows = records(501);
    const { client, urls } = fixture(rows, { afterFirstPage: state => {
      vi.mocked(Date.now).mockReturnValue(READ_AT + 1000);
      state.push({ ...rows[0], id: uuid(9999), created_at: '2026-10-12T08:00:00.500000Z' });
    } });
    expect(await readTeamTransactions(client)).toEqual(rows);
    expect(urls.map(url => url.searchParams.getAll('created_at')[1])).toEqual(['lte.2026-10-12T08:00:00.000Z', 'lte.2026-10-12T08:00:00.000Z']);
  });
  it('rejects a later-page failure instead of returning incomplete data', async () => {
    const { client } = fixture(records(1201), { failRequest: 2 });
    await expect(readTeamTransactions(client)).rejects.toThrow('synthetic read failure');
  });
  it('bounds the total read duration without returning a partial result', async () => {
    const { client } = fixture(records(1201));
    vi.mocked(Date.now).mockReturnValueOnce(READ_AT).mockReturnValue(READ_AT + 21000);
    await expect(readTeamTransactions(client)).rejects.toThrow(/timeout/);
  });
  it('fails rather than looping over a page whose cursor does not advance', async () => {
    const { client, urls } = fixture(records(1001), { ignoreCursor: true });
    await expect(readTeamTransactions(client)).rejects.toThrow('did not advance');
    expect(urls).toHaveLength(2);
  });
});
