import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ in: mocks.settings }) }) } }));
import { useSubmissionPeriod, useSubmissionRead } from './useSubmissionRead';
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

describe('keyed admin reads', () => {
  it('never displays Q3/user A under Q4/user B and rejects out of order responses', async () => {
    const old = deferred<string[]>(); const latest = deferred<string[]>();
    const { result, rerender } = renderHook(({ key }) => useSubmissionRead(key, () => key === 'Q3:A' ? old.promise : latest.promise), { initialProps: { key: 'Q3:A' } });
    rerender({ key: 'Q4:B' });
    expect(result.current.data).toBeUndefined();
    await act(async () => latest.resolve(['current']));
    await act(async () => old.resolve(['stale']));
    expect(result.current.data).toEqual(['current']);
  });
  it('clears previously loaded records immediately when filter changes', async () => {
    const next = deferred<string[]>();
    const { result, rerender } = renderHook(({ key }) => useSubmissionRead(key, () => key === 'old' ? Promise.resolve(['old']) : next.promise), { initialProps: { key: 'old' } });
    await waitFor(() => expect(result.current.data).toEqual(['old']));
    rerender({ key: 'new' });
    expect(result.current.data).toBeUndefined(); expect(result.current.loading).toBe(true);
  });
  it('surfaces errors and can retry without turning a failure into empty success', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useSubmissionRead('key', read));
    await waitFor(() => expect(result.current.error).toBe('offline'));
    expect(result.current.data).toBeUndefined();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.error).toBeUndefined();
  });
  it('ignores a response after the panel has been closed', async () => {
    const pending = deferred<string[]>();
    const { result, rerender } = renderHook(({ enabled }) => useSubmissionRead('key', () => pending.promise, enabled), { initialProps: { enabled: true } });
    rerender({ enabled: false }); await act(async () => pending.resolve(['late']));
    expect(result.current.data).toBeUndefined();
  });
});

it('defaults to the configured quarter', async () => {
  mocks.settings.mockResolvedValue({ data: [{ key: 'current_submission_year', value: '2025' }, { key: 'current_submission_quarter', value: '2' }], error: null });
  const { result } = renderHook(useSubmissionPeriod);
  await waitFor(() => expect(result.current.year).toBe(2025)); expect(result.current.quarter).toBe(2);
});
it('preserves explicit selection when settings arrive late', async () => {
  const pending = deferred<unknown>(); mocks.settings.mockReturnValue(pending.promise);
  const { result } = renderHook(useSubmissionPeriod);
  act(() => { result.current.setYear(2024); result.current.setQuarter(1); });
  await act(async () => pending.resolve({ data: [{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: '3' }], error: null }));
  expect(result.current.year).toBe(2024); expect(result.current.quarter).toBe(1);
});
