import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OSSManager } from '../OSSManager';
import type { ResearchLibraryItem } from '../oss/libraryModel';

vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ role: 'admin' }) }));
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationRequestHeaders: () => ({}) }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-test' } } }) } } }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const folder = { name: '甲目录/', type: 'folder' } as const;
const file = (name: string): ResearchLibraryItem => ({ name, type: 'file' });
function response(data: ResearchLibraryItem[] = [], truncated = false, nextMarker: string | null = null) { return { ok: true, json: async () => ({ status: 'success', data, truncated, nextMarker }) } as Response; }
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { sessionStorage.clear(); fetchMock = vi.fn().mockResolvedValue(response([folder])); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { await act(async () => { render(<OSSManager userEmail="admin@example.test" />); }); }
async function enterFolder() { await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '甲目录' })[0]); }); }

describe('research library directory request ordering', () => {
  it('ignores a late success (including its truncated flag) after returning to root', async () => {
    await open();
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    await enterFolder();
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    fetchMock.mockResolvedValueOnce(response([file('根目录新资料.pdf')]));
    await act(async () => { fireEvent.click(screen.getByText('全部资料')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
    expect(signal.aborted).toBe(true);
    await act(async () => { old.resolve(response([file('错误的旧目录.pdf')], true)); });
    expect(screen.getAllByText('根目录新资料.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText('错误的旧目录.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText(/当前目录超过云端/)).not.toBeInTheDocument();
  });

  it('ignores stale failure/finally while the new directory is still loading', async () => {
    await open();
    const old = deferred<Response>();
    const current = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    await enterFolder();
    fetchMock.mockReturnValueOnce(current.promise);
    await act(async () => { fireEvent.click(screen.getByText('全部资料')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
    await act(async () => { old.reject(new Error('旧目录失败')); });
    expect(screen.getByText('正在加载研究资料')).toBeInTheDocument();
    expect(screen.queryByText('旧目录失败')).not.toBeInTheDocument();
    await act(async () => { current.resolve(response([file('当前资料.pdf')])); });
    expect(screen.getAllByText('当前资料.pdf').length).toBeGreaterThan(0);
  });

  it('retains the current request failure and lets the user retry', async () => {
    await open();
    fetchMock.mockRejectedValueOnce(new Error('连接失败'));
    await enterFolder();
    expect(screen.getByText('连接失败')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response([file('甲目录/恢复资料.pdf')]));
    await act(async () => { fireEvent.click(screen.getByText('重试')); });
    expect(screen.getAllByText('恢复资料.pdf').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(encodeURIComponent('甲目录/'));
  });

  it('does not navigate back when a folder creation finishes after navigation', async () => {
    await open();
    fetchMock.mockResolvedValueOnce(response([]));
    await enterFolder();
    fireEvent.click(screen.getByText('新建文件夹'));
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '新目录' } });
    const mutation = deferred<Response>();
    fetchMock.mockReturnValueOnce(mutation.promise);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '创建' })); });
    fetchMock.mockResolvedValueOnce(response([file('根目录.pdf')]));
    // Simulate navigation while the asynchronous mutation is in flight.
    await act(async () => { fireEvent.click(screen.getByText('全部资料')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
    const requests = fetchMock.mock.calls.length;
    await act(async () => { mutation.resolve(response()); });
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(screen.getAllByText('根目录.pdf').length).toBeGreaterThan(0);
  });

  it('reuses a fresh directory snapshot until the user requests a refresh', async () => {
    await open();
    fetchMock.mockResolvedValueOnce(response([file('甲目录/已缓存.pdf')]));
    await enterFolder();
    const count = fetchMock.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByText('全部资料')); });
    await enterFolder();
    expect(screen.getAllByText('已缓存.pdf').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(count);
    fetchMock.mockResolvedValueOnce(response([file('甲目录/已更新.pdf')]));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
    expect(screen.getAllByText('已更新.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText('已缓存.pdf')).not.toBeInTheDocument();
  });

  it('paginates the directory by OSS cursor without duplicating entries', async () => {
    await open();
    fetchMock.mockResolvedValueOnce(response([file('甲目录/第一份.pdf')], true, '甲目录/第一份.pdf'));
    await enterFolder();
    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(response([file('甲目录/第一份.pdf'), file('甲目录/第二份.pdf')]));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加载更多' })); });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('marker=');
    expect(screen.getAllByText('第一份.pdf')).toHaveLength(2);
    expect(screen.getAllByText('第二份.pdf')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('keeps at most three OSS upload requests in flight', async () => {
    await open();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', host: 'https://synthetic-oss.example.test', policy: 'policy', signature: 'sig', accessid: 'key' }),
    });
    let inFlight = 0;
    let peak = 0;
    const finishers: Array<() => void> = [];
    class FakeXHR {
      status = 200;
      upload = { addEventListener: () => {} };
      private listeners = new Map<string, () => void>();
      open() {}
      addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
      send() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        finishers.push(() => {
          inFlight--;
          this.listeners.get('load')?.();
        });
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const files = Array.from({ length: 5 }, (_, i) => new File(['fixture'], `sample-${i}.pdf`, { type: 'application/pdf' }));
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(finishers).toHaveLength(3));
    expect(peak).toBe(3);
    await act(async () => { finishers.shift()?.(); });
    await waitFor(() => expect(finishers).toHaveLength(3));
    await act(async () => { finishers.shift()?.(); finishers.shift()?.(); });
    await waitFor(() => expect(finishers).toHaveLength(2));
    await act(async () => { finishers.shift()?.(); finishers.shift()?.(); });
    await waitFor(() => expect(screen.getAllByText('上传完成')).toHaveLength(5));
    expect(peak).toBe(3);
  });

  it('keeps the directory search focused across cache-backed navigation and pagination', async () => {
    await open();
    fetchMock.mockResolvedValueOnce(response([file('甲目录/Alpha.pdf')], true, '甲目录/Alpha.pdf'));
    await enterFolder();
    const input = screen.getByPlaceholderText('搜索当前目录资料…') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'A', selectionStart: 1, selectionEnd: 1 } });
    expect(input).toHaveFocus();
    fetchMock.mockResolvedValueOnce(response([file('甲目录/Alps.pdf')]));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '加载更多' })); });
    expect(input).toHaveFocus();
    input.setSelectionRange(1, 1);
    fireEvent.change(input, { target: { value: 'Al', selectionStart: 2, selectionEnd: 2 } });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(2);
    expect(screen.getAllByText('Alpha.pdf')).toHaveLength(2);
    expect(screen.getAllByText('Alps.pdf')).toHaveLength(2);
  });

  it('aborts the list request when unmounted', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    let unmount!: () => void;
    await act(async () => { ({ unmount } = render(<OSSManager userEmail="admin@example.test" />)); });
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(response()); });
  });
});
