import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapQuerySelection } from '../MapQuerySelection';
import type { BuildingContext } from '@/src/lib/intelligence/query/buildingCards';

const mock = vi.hoisted(() => ({ capabilities: vi.fn(), buildings: vi.fn(), push: vi.fn(), target: null as string | null,
  session: { role: 'admin', user: { id: 'actor' }, sessionId: 'session', session: { user: { id: 'actor' } } } }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: { capabilities: mock.capabilities, buildings: mock.buildings } }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ session: mock.session }) }));
vi.mock('@/src/services/impersonationHeaders', () => ({ getImpersonationTargetUserId: () => mock.target }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mock.push }) }));
const requestId = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002';
const context = { requestId, details: false };
const result: BuildingContext = { status: 'ready', requestId, resultId: requestId, metadataReadAt: '2026-11-16T00:00:00Z', total: 2, offset: 0, hasMore: false,
  buildings: [{ id, name: '合成楼', submarket: 'CBD', grade: 'A', photo: null, located: true, unavailableReason: null },
    { id: requestId, name: '无坐标楼', submarket: 'CBD', grade: 'A', photo: null, located: false, unavailableReason: 'missing_coordinates' }] };
beforeEach(() => {
  vi.clearAllMocks(); mock.target = null; mock.session.sessionId = 'session';
  mock.capabilities.mockResolvedValue({ enabled: true }); mock.buildings.mockResolvedValue(result);
});
describe('AI map authorization bridge', () => {
  it('T06 reports available/missing locations and original-result navigation without coordinate invention', async () => {
    const change = vi.fn(); render(<MapQuerySelection context={context} onChange={change} />);
    expect(await screen.findByText(/可定位 1 栋；1 栋缺少可靠坐标/)).toBeVisible();
    expect(change).toHaveBeenLastCalledWith(result);
    expect(screen.getByRole('link', { name: '返回 AI 原结果' })).toHaveAttribute('href', `/?aiRequest=${requestId}#colliers-ai`);
    const action = new URL(screen.getByRole('link', { name: '分析选中项目' }).getAttribute('href')!, 'https://example.invalid');
    expect(action.searchParams.getAll('aiBuilding')).toEqual([id, requestId]); expect(action.searchParams.get('aiIntent')).toBe('compare');
  });
  it('T12 refreshes current grants on focus and removes the previous map ID set on revocation', async () => {
    const change = vi.fn(); render(<MapQuerySelection context={context} onChange={change} />);
    await screen.findByText(/可定位 1 栋/); mock.capabilities.mockResolvedValue({ enabled: false });
    fireEvent.focus(window);
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(null));
    expect(screen.getByRole('alert')).toHaveTextContent('当前 AI 查询资格已不可用');
    expect(screen.queryByRole('link', { name: '分析选中项目' })).not.toBeInTheDocument();
  });
  it('T07 only exposes the single-building trend action when existing capability examples authorize its fields', async () => {
    mock.buildings.mockResolvedValue({ ...result, total: 1, buildings: result.buildings.slice(0, 1) });
    mock.capabilities.mockResolvedValue({ enabled: true, examples: ['CBD净有效租金2026Q1至2026Q3趋势各期样本'] });
    const change = vi.fn(); render(<MapQuerySelection context={context} onChange={change} />);
    const summary = await screen.findByText('继续分析此项目'); fireEvent.click(summary);
    expect(screen.getByRole('link', { name: '历史净有效租金趋势' })).toHaveAttribute('href', expect.stringContaining('aiIntent=rent_trend'));
    expect(screen.getByRole('link', { name: '查看同子市场项目' })).toHaveAttribute('href', expect.stringContaining('aiIntent=peers'));
    mock.capabilities.mockResolvedValue({ enabled: true, examples: ['CBD有哪些楼'] }); fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole('link', { name: '历史净有效租金趋势' })).not.toBeInTheDocument());
  });
  it('T07/T12 only enables existing popup AI actions for a qualified real identity and passes the canonical ID', async () => {
    const popup = document.createElement('div'); popup.className = 'building-popup'; popup.dataset.buildingId = id;
    popup.innerHTML = '<button data-map-action="building-ai" hidden>AI 分析</button>'; document.body.append(popup);
    const change = vi.fn(); const view = render(<MapQuerySelection context={null} onChange={change} />);
    try {
      const button = popup.querySelector('button')!; await waitFor(() => expect(button.hidden).toBe(false)); fireEvent.click(button);
      expect(new URL(mock.push.mock.calls[0][0], 'https://example.invalid').searchParams.getAll('aiBuilding')).toEqual([id]);
      mock.target = 'impersonated'; view.rerender(<MapQuerySelection context={null} onChange={change} />);
      await waitFor(() => expect(button.hidden).toBe(true)); fireEvent.click(button); expect(mock.push).toHaveBeenCalledTimes(1);
    } finally { popup.remove(); }
  });
  it('T13/T15 aborts stale identity reads and removes lifecycle timers/listeners on unmount', async () => {
    let resolve!: (value: BuildingContext) => void;
    mock.buildings.mockImplementationOnce(() => new Promise<BuildingContext>(done => { resolve = done; }));
    const change = vi.fn(), view = render(<MapQuerySelection context={context} onChange={change} />);
    await waitFor(() => expect(mock.buildings).toHaveBeenCalledTimes(1)); const signal = mock.buildings.mock.calls[0][2] as AbortSignal;
    mock.session.sessionId = 'new-session'; view.rerender(<MapQuerySelection context={context} onChange={change} />);
    expect(signal.aborted).toBe(true); await screen.findByText(/可定位 1 栋/);
    await act(async () => { resolve({ ...result, buildings: [] }); });
    expect(change).toHaveBeenLastCalledWith(result);
    const calls = mock.capabilities.mock.calls.length; view.unmount(); fireEvent.focus(window);
    expect(mock.capabilities).toHaveBeenCalledTimes(calls);
  });
});
