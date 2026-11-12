// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SearchPage from './page';

const mock = vi.hoisted(() => ({ companies: vi.fn(), buildings: vi.fn(), future: vi.fn(), status: 'authenticated' }));
vi.mock('@/src/services/apiClient', () => ({ getBuildings: mock.buildings }));
vi.mock('@/src/services/mapDataClient', () => ({ fetchFutureSupplyPayload: mock.future }));
vi.mock('@/src/services/leaseCompanyLookupClient', () => ({ searchLeaseCompanies: mock.companies }));
vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => ({ status: mock.status, session: { role: 'editor', user: { id: 'test', app_metadata: {} }, session: { access_token: 'fixture' } } }),
}));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ targetUserId: null, targetRole: null }) }));

beforeEach(() => {
  window.history.replaceState(null, '', '/search');
  mock.status = 'authenticated';
  mock.companies.mockReset().mockResolvedValue({ suggestions: [] });
  mock.buildings.mockReset().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', name: '示范中心东座', former_names: ['合成老楼'], lng: 116, lat: 39 }]);
  mock.future.mockReset().mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222', name: '合成项目', location_lng: 116, location_lat: 39 }]);
});

it('keeps unified search focus and caret across loading, results, and Chinese composition', async () => {
  render(<SearchPage />);
  const input = screen.getByRole('textbox', { name: '楼宇、项目或企业' }) as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: '合' } });
  await screen.findByText('示范中心东座');
  await waitFor(() => expect(mock.companies).toHaveBeenCalledWith('合', expect.any(AbortSignal)));
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
  fireEvent.change(input, { target: { value: '合老楼' } });
  input.setSelectionRange(1, 1);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '合cheng老楼' } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)); });
  expect(mock.companies).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: '合成老楼' } });
  input.setSelectionRange(2, 2);
  fireEvent.compositionEnd(input);
  await waitFor(() => expect(mock.companies).toHaveBeenCalledWith('合成老楼', expect.any(AbortSignal)));
  expect(screen.getByRole('link', { name: '地图详情' })).toHaveAttribute('href', expect.stringContaining('building=11111111-1111-4111-8111-111111111111'));
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(2);
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.change(input, { target: { value: '项目' } });
  expect(screen.getByRole('link', { name: '地图详情' })).toHaveAttribute('href', expect.stringContaining('future=22222222-2222-4222-8222-222222222222'));
});

it('never starts catalogs or company reads for an anonymous session', () => {
  mock.status = 'unauthenticated';
  render(<SearchPage />);
  expect(screen.getByRole('link', { name: '登录后使用统一搜索' })).toBeInTheDocument();
  expect(mock.buildings).not.toHaveBeenCalled();
  expect(mock.future).not.toHaveBeenCalled();
  expect(mock.companies).not.toHaveBeenCalled();
});
