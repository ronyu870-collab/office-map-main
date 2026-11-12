import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/services/Auth', () => ({
  getSessionFast: async () => ({ user: { id: 'synthetic-admin' }, role: 'admin', session: { access_token: 'synthetic-token' } }),
}));
vi.mock('@/src/services/impersonationHeaders', async (load) => ({
  ...await load<object>(),
  withImpersonationHeaders: (headers: HeadersInit) => new Headers(headers),
}));
vi.mock('@/src/components/ui', () => ({
  AppHeader: ({ title }: { title: React.ReactNode }) => <div>{title}</div>,
  LoadingState: ({ label }: { label: string }) => <span>{label}</span>,
  Button: ({ children, size: _size, variant: _variant, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) =>
    <button {...rest}>{children}</button>,
}));
import LeaseHistoryPage from '../page';

const access = { canReadHistory: true, effectiveRole: 'admin', effectiveSource: 'all', impersonating: false };
const records = [
  { read_id: 'syn-1', company: '合成甲企业', record_source: 'live', building_match_scope: 'exact', new_building: '甲楼', transaction_year: 2026, transaction_quarter: 'Q3', area_sqm: 120 },
  { read_id: 'syn-2', company: '合成乙企业', record_source: 'live', building_match_scope: 'exact', new_building: '乙楼', transaction_year: 2026, transaction_quarter: 'Q3', area_sqm: 180 },
];

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/lease-submission/history');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const params = new URL(url, 'https://synthetic.invalid').searchParams;
    const company = params.get('company') ?? '';
    const filtered = records.filter(record => record.company.includes(company));
    return {
      ok: true, status: 200,
      json: async () => ({ records: params.has('count_only') ? [] : filtered, count: params.has('count_only') ? filtered.length : null, access }),
    };
  }));
});

describe('lease history search and focus', () => {
  it('preserves the history company input caret and focus when filtered results return', async () => {
    render(<LeaseHistoryPage />);
    await screen.findByText('合成甲企业');
    const input = screen.getByRole('textbox', { name: '搜索公司名称' }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '合成乙' } });
    input.setSelectionRange(3, 3);
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByText('合成乙企业')).toBeInTheDocument());
    expect(screen.queryByText('合成甲企业')).toBeNull();
    expect(input).toHaveFocus();
    expect(input.value).toBe('合成乙');
    expect(input.selectionStart).toBe(3);
  });
});

it('keeps the first records actionable, retries count alone, and ignores a late count after a newer search', async () => {
  const pending: Array<{ signal?: AbortSignal; resolve: (response: Response) => void }> = [];
  const reads = vi.fn(async (url: string, init: RequestInit) => {
    const params = new URL(url, 'https://synthetic.invalid').searchParams;
    const filtered = records.filter(record => record.company.includes(params.get('company') || ''));
    if (params.has('count_only')) return new Promise<Response>(resolve => pending.push({ signal: init.signal ?? undefined, resolve }));
    return new Response(JSON.stringify({ records: filtered, count: null, access }));
  });
  vi.stubGlobal('fetch', reads);
  render(<LeaseHistoryPage />);

  fireEvent.click(await screen.findByText('合成甲企业'));
  expect(screen.getByRole('dialog', { name: '成交详情' })).toBeInTheDocument();
  expect(screen.getByText('正在统计总数…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  expect(screen.queryByText('0 条')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^关闭$/ }));
  await act(async () => pending[0].resolve(new Response('{}', { status: 500 })));
  fireEvent.click(await screen.findByRole('button', { name: '重试总数' }));
  expect(reads.mock.calls.map(([url]) => url.includes('count_only'))).toEqual([false, true, true]);

  const input = screen.getByRole('textbox', { name: '搜索公司名称' }) as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: '乙' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(pending).toHaveLength(3));
  expect(pending[1].signal?.aborted).toBe(true);
  await act(async () => pending[1].resolve(new Response(JSON.stringify({ count: 999, access }))));
  expect(screen.queryByText('999 条')).toBeNull();
  expect(screen.getByText('合成乙企业')).toBeInTheDocument();
  expect(screen.queryByText('合成甲企业')).toBeNull();
  await act(async () => pending[2].resolve(new Response(JSON.stringify({ count: 1, access }))));
  expect(screen.getByText('1 条')).toBeInTheDocument();
  expect(input).toHaveFocus();
});

it('removes previously loaded records when the count endpoint reports narrower permission', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('count_only')
    ? { count: 2, access: { ...access, canReadHistory: false, effectiveRole: 'viewer', effectiveSource: 'live' } }
    : { records, count: null, access }))));
  render(<LeaseHistoryPage />);
  expect(await screen.findByText('读取权限已变化，请重新加载')).toBeInTheDocument();
  expect(screen.queryByText('合成甲企业')).toBeNull();
  expect(screen.queryByText('2 条')).toBeNull();
});
