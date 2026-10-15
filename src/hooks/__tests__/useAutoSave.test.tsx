import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave } from '../useAutoSave';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useAutoSave draft durability', () => {
  it('flushes before debounce and does not write an unchanged server baseline', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ content }) => useAutoSave({ content, savedContent: 'server', onSave: save }), { initialProps: { content: 'server' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(save).not.toHaveBeenCalled();
    rerender({ content: 'new draft' });
    await act(async () => { expect(await result.current.forceSave()).toBe(true); });
    expect(save).toHaveBeenCalledExactlyOnceWith('new draft');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('serializes slow writes and flushes edits made while a write is in flight', async () => {
    const first = deferred();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ content }) => useAutoSave({ content, savedContent: 'server', onSave: save }), { initialProps: { content: 'first' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    rerender({ content: 'latest' });
    let leaving!: Promise<boolean>;
    act(() => { leaving = result.current.forceSave(); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); expect(await leaving).toBe(true); });
    expect(save.mock.calls.map(([value]) => value)).toEqual(['first', 'latest']);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('keeps a failed draft dirty and retries the current input', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ content }) => useAutoSave({ content, savedContent: 'server', onSave: save }), { initialProps: { content: 'draft' } });
    await act(async () => { expect(await result.current.forceSave()).toBe(false); });
    expect(result.current.error?.message).toBe('offline');
    expect(result.current.hasUnsavedChanges).toBe(true);
    rerender({ content: 'edited after failure' });
    await act(async () => { expect(await result.current.forceSave()).toBe(true); });
    expect(save).toHaveBeenLastCalledWith('edited after failure');
    expect(result.current.error).toBeNull();
  });

  it('retries after a failed write even when the user restores the last known saved text', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ content }) => useAutoSave({ content, savedContent: 'server', onSave: save }), { initialProps: { content: 'draft' } });
    await act(async () => { expect(await result.current.forceSave()).toBe(false); });
    rerender({ content: 'server' });
    expect(result.current.hasUnsavedChanges).toBe(true);
    await act(async () => { expect(await result.current.forceSave()).toBe(true); });
    expect(save).toHaveBeenLastCalledWith('server');
    expect(result.current.error).toBeNull();
    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  it('puts explicit version saves after any active autosave', async () => {
    const pending = deferred();
    const save = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined);
    const version = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ content }) => useAutoSave({ content, savedContent: 'server', onSave: save }), { initialProps: { content: 'first' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    rerender({ content: 'latest' });
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.forceSave(version); });
    expect(version).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); await saving; });
    expect(version).toHaveBeenCalledExactlyOnceWith('latest');
  });

  it('cancels a pending debounce on unmount', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutoSave({ content: 'draft', onSave: save }));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(save).not.toHaveBeenCalled();
  });
});
