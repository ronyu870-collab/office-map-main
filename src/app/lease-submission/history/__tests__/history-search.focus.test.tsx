import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/services/Auth', () => ({
  getSessionFast: async () => ({ user: { id: 'synthetic-admin' }, role: 'admin', session: { access_token: 'synthetic-token' } }),
}));
vi.mock('@/src/services/impersonationHeaders', () => ({
  withImpersonationHeaders: (headers: HeadersInit) => new Headers(headers),
}));
vi.mock('@/src/components/ui', () => ({
  AppHeader: ({ title }: { title: React.ReactNode }) => <div>{title}</div>,
  LoadingState: ({ label }: { label: string }) => <span>{label}</span>,
  Button: ({ children, size: _size, variant: _variant, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) =>
    <button {...rest}>{children}</button>,
}));
import LeaseHistoryPage from '../page';

const records = [
  { read_id: 'syn-1', company: '合成甲企业', record_source: 'live', building_match_scope: 'exact', new_building: '甲楼', transaction_year: 2026, transaction_quarter: 'Q3', area_sqm: 120 },
  { read_id: 'syn-2', company: '合成乙企业', record_source: 'live', building_match_scope: 'exact', new_building: '乙楼', transaction_year: 2026, transaction_quarter: 'Q3', area_sqm: 180 },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const params = new URL(url, 'https://synthetic.invalid').searchParams;
    const company = params.get('company') ?? '';
    const filtered = records.filter(record => record.company.includes(company));
    return {
      ok: true, status: 200,
      json: async () => ({ records: filtered, count: filtered.length, access: { canReadHistory: true } }),
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
