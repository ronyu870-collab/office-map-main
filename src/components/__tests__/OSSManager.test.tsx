import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OSSManager } from '../OSSManager';
import type { ResearchLibraryItem } from '../oss/libraryModel';

const auth = vi.hoisted(() => ({ role: 'admin', token: 'synthetic-test', userId: 'synthetic-user' }));
const sdkSession = () => ({ access_token: auth.token, user: { id: auth.userId }, expires_at: Math.floor(Date.now() / 1000) + 3600 });
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({ role: auth.role }) }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => auth.token
  ? { status: 'authenticated', session: { role: auth.role, user: { id: auth.userId }, session: sdkSession() } }
  : { status: 'unauthenticated', session: null } }));
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationRequestHeaders: () => ({}) }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: auth.token ? sdkSession() : null } }) } } }));
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
beforeEach(() => {
  auth.role = 'admin'; auth.token = 'synthetic-test'; auth.userId = 'synthetic-user';
  sessionStorage.clear(); fetchMock = vi.fn().mockResolvedValue(response([folder])); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { await act(async () => { render(<OSSManager userEmail="admin@example.test" />); }); }
async function enterFolder() { await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '甲目录' })[0]); }); }

describe('research library directory request ordering', () => {
  it('reuses a verified read-only directory after a short return but reloads after credential rotation', async () => {
    auth.role = 'viewer';
    auth.token = 'synthetic-before-rotation';
    fetchMock.mockResolvedValueOnce(response([file('只读资料.pdf')]));
    await open();
    expect(screen.getAllByText('只读资料.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText('上传文件')).not.toBeInTheDocument();
    cleanup();
    await open();
    expect(screen.getAllByText('只读资料.pdf').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanup();
    auth.token = 'synthetic-after-rotation';
    fetchMock.mockResolvedValueOnce(response([file('新凭据目录.pdf')]));
    await open();
    expect(screen.queryByText('只读资料.pdf')).not.toBeInTheDocument();
    expect(screen.getAllByText('新凭据目录.pdf').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps the library search focused and editable as directory results change', async () => {
    fetchMock.mockResolvedValueOnce(response([file('北京市场.pdf'), file('北京租赁.pdf'), file('上海市场.pdf')]));
    await open();
    const input = screen.getByRole('textbox', { name: '搜索当前目录资料' }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '北京', selectionStart: 2, selectionEnd: 2 } });
    expect(screen.queryByText('上海市场.pdf')).not.toBeInTheDocument();
    expect(screen.getAllByText('北京租赁.pdf').length).toBeGreaterThan(0);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(2);
    fireEvent.change(input, { target: { value: '北京市场', selectionStart: 4, selectionEnd: 4 } });
    expect(screen.queryByText('北京租赁.pdf')).not.toBeInTheDocument();
    expect(screen.getAllByText('北京市场.pdf').length).toBeGreaterThan(0);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(4);
  });

  it('ignores a late success (including its truncated flag) after returning to root', async () => {
    await open();
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    await enterFolder();
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    fetchMock.mockResolvedValueOnce(response([file('根目录新资料.pdf')]));
    await act(async () => { fireEvent.click(screen.getByText('全部资料')); });
    expect(signal.aborted).toBe(true);
    await act(async () => { old.resolve(response([file('错误的旧目录.pdf')], true)); });
    expect(screen.getAllByText('根目录新资料.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText('错误的旧目录.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText(/当前目录超过云端/)).not.toBeInTheDocument();
  });

  it('lets readers load later directory pages and find files without losing their search focus', async () => {
    auth.role = 'viewer';
    auth.token = 'synthetic-reader-paging';
    fetchMock.mockResolvedValueOnce(response([file('第一页.pdf')], true, '第一页.pdf'));
    await open();
    const input = screen.getByRole('textbox', { name: '搜索当前目录资料' });
    fireEvent.change(input, { target: { value: '第二' } });
    expect(screen.queryByText('第一页.pdf')).not.toBeInTheDocument();
    const second = deferred<Response>();
    fetchMock.mockReturnValueOnce(second.promise);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加载更多' })));
    input.focus();
    await act(async () => second.resolve(response([file('第二页.pdf')])));
    expect(input).toHaveFocus();
    expect(screen.getAllByText('第二页.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
    const pageUrl = new URL(fetchMock.mock.calls[1][0], 'http://localhost');
    expect(pageUrl.searchParams.get('marker')).toBe('第一页.pdf');
  });

  it('discards a pending next page when entering another folder and prevents duplicate requests', async () => {
    fetchMock.mockResolvedValueOnce(response([folder], true, '甲目录/'));
    await open();
    const second = deferred<Response>();
    fetchMock.mockReturnValueOnce(second.promise);
    const more = screen.getByRole('button', { name: '加载更多' });
    await act(async () => { fireEvent.click(more); fireEvent.click(more); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    fetchMock.mockResolvedValueOnce(response([file('甲目录/子目录资料.pdf')]));
    await enterFolder();
    expect(signal.aborted).toBe(true);
    await act(async () => second.resolve(response([file('旧目录第二页.pdf')])));
    expect(screen.getAllByText('子目录资料.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText('旧目录第二页.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('keeps partial results after a failed continuation and clears them when authorization is denied', async () => {
    fetchMock.mockResolvedValueOnce(response([file('第一页.pdf')], true, '第一页.pdf'));
    await open();
    fetchMock.mockRejectedValueOnce(new Error('连接失败'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加载更多' })));
    expect(screen.getByText('连接失败')).toBeInTheDocument();
    expect(screen.getAllByText('第一页.pdf').length).toBeGreaterThan(0);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ message: '访问已撤销' }) });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加载更多' })));
    expect(screen.getByText('访问已撤销')).toBeInTheDocument();
    expect(screen.queryByText('第一页.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('requires the administrator to load a full directory before checking uploads for duplicate names', async () => {
    fetchMock.mockResolvedValueOnce(response([file('第一页.pdf')], true, '第一页.pdf'));
    await open();
    const upload = screen.getByRole('button', { name: '上传文件' });
    expect(upload).toBeDisabled();
    fetchMock.mockResolvedValueOnce(response([file('重复名称.pdf')]));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '加载更多' })));
    expect(upload).toBeEnabled();
    const input = document.querySelector('input[type="file"]')!;
    await act(async () => fireEvent.change(input, { target: { files: [new File(['test'], '重复名称.pdf', { type: 'application/pdf' })] } }));
    expect(screen.getByText('当前目录已存在同名文件')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores stale failure/finally while the new directory is still loading', async () => {
    await open();
    const old = deferred<Response>();
    const current = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    await enterFolder();
    fetchMock.mockReturnValueOnce(current.promise);
    await act(async () => { fireEvent.click(screen.getByText('全部资料')); });
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
    const requests = fetchMock.mock.calls.length;
    await act(async () => { mutation.resolve(response()); });
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(screen.getAllByText('根目录.pdf').length).toBeGreaterThan(0);
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
