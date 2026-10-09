import { describe, expect, it, vi } from 'vitest';
import { readQuarterlyPages } from './quarterlyReadPages';
describe('quarterly paginated reads', () => {
  it('reads beyond the server page limit without dropping rows', async () => {
    const read = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: [3], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await readQuarterlyPages(read, 2)).toEqual([1, 2, 3]);
    expect(read.mock.calls).toEqual([[0, 1], [2, 3], [3, 4]]);
  });
  it('continues through partial pages when the server caps pages below the requested size', async () => {
    const allRows = [1, 2, 3, 4, 5];
    const read = vi.fn(async (from: number, to: number) => ({ data: allRows.slice(from, Math.min(to + 1, from + 2)), error: null }));
    expect(await readQuarterlyPages(read, 500)).toEqual(allRows);
    expect(read.mock.calls).toEqual([[0, 499], [2, 501], [4, 503], [5, 504]]);
  });
  it('does not turn later page errors into partial success', async () => {
    const read = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(readQuarterlyPages(read, 2)).rejects.toThrow('offline');
  });
  it('fails visibly at the safety bound instead of reporting partial counts', async () => {
    await expect(readQuarterlyPages(async () => ({ data: [1], error: null }), 1, 2)).rejects.toThrow('安全读取上限');
  });
});
