import { describe, expect, it } from 'vitest';
import { draftEntries, draftProjectLabel, fetchAllSubmissionPages, parseSubmissionPeriod, summarizeAdminDraft } from './submissionReliability';

describe('admin submission pagination', () => {
  it('reads all 1207 rows even when the server silently caps pages below the requested size', async () => {
    const source = Array.from({ length: 1207 }, (_, id) => ({ id }));
    const result = await fetchAllSubmissionPages(async from => ({ data: source.slice(from, from + 100), error: null }));
    expect(result).toEqual(source);
  });
  it('fails visibly if a server ignores range instead of looping indefinitely', async () => {
    await expect(fetchAllSubmissionPages(async () => ({ data: Array(500).fill({ id: 'repeated' }), error: null }))).rejects.toThrow('安全读取上限');
  });
  it('rejects partial success when a later page fails', async () => {
    await expect(fetchAllSubmissionPages(async from => from === 0 ? { data: [{ id: 1 }], error: null } : { data: null, error: { message: 'network lost' } })).rejects.toThrow('network lost');
  });
  it('does not report a missing response as empty data', async () => {
    await expect(fetchAllSubmissionPages(async () => ({ data: null, error: null }))).rejects.toThrow('数据响应不完整');
  });
});

describe('admin draft interpretation', () => {
  const draft = { 'synthetic-building-uuid': { qQuote: '120', qFree: 0 }, __futureSupply__: { 'synthetic-future-uuid': { qRemark: 'new project' }, empty: { qQuote: '' } }, metadata: 'ignored' };
  it('separates UUID keyed stock and nested future records and retains zero', () => {
    expect(draftEntries(draft)).toHaveLength(2);
    expect(summarizeAdminDraft(draft)).toEqual({ buildings: 2, fields: '报价、免租期、备注' });
  });
  it('resolves names without treating UUIDs as numeric row positions', () => {
    const entries = draftEntries(draft);
    expect(draftProjectLabel(entries[0], { 'synthetic-building-uuid': 'Test Tower' })).toBe('Test Tower');
    expect(draftProjectLabel(entries[1], {}, { 'synthetic-future-uuid': 'Test Future' })).toBe('未来供应 · Test Future');
    expect(draftProjectLabel(entries[0])).not.toContain('NaN');
    expect(draftProjectLabel({ id: '2', kind: 'regular', values: {} })).toBe('历史序号 3（无法确认项目）');
  });
  it('rejects malformed or empty nested payloads as data', () => {
    for (const draft of [null, [], 'bad', { __futureSupply__: {} }, { x: { qQuote: '', nested: {} } }]) expect(draftEntries(draft)).toEqual([]);
  });
});

it('validates both configured period fields, rather than silently using invalid defaults', () => {
  expect(parseSubmissionPeriod([{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: '3' }])).toEqual({ year: 2026, quarter: 3 });
  expect(() => parseSubmissionPeriod([])).toThrow();
  expect(() => parseSubmissionPeriod([{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: '5' }])).toThrow();
});
