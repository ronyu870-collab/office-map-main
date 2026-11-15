import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate, CandidatePage } from '@/src/lib/leaseExpiry/contracts';
const state = vi.hoisted(() => ({ role: 'admin', status: 'authenticated', user: 'synthetic-admin', token: 'synthetic-token', impersonating: false, list: vi.fn(), replace: vi.fn() }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: state.status, session: { role: state.role, user: { id: state.user }, session: { access_token: state.token } } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: state.impersonating }) }));
vi.mock('@/src/services/leaseExpiryTimelineApi', () => ({ listLeaseExpiries: state.list }));
import { LeaseExpiryTimeline } from './LeaseExpiryTimeline';
import { LeaseExpiryLink } from './LeaseExpiryLink';
import { LeaseReviewError } from '@/src/services/leaseExpiryApi';
const item: Candidate = {
  source_kind: 'history', source_available: true,
  source: { id: '11111111-1111-4111-8111-111111111111', company: '合成验证企业', building: '合成长名称示范楼宇 A 座', period_start: '2021-10-01', period_end: '2021-12-31', period_source: 'quarter', precision: 'quarter', lease_term_months: 60, source_lease_term_raw: '60', source_file: 'synthetic.xlsx', source_sheet: 'Sheet1', source_row: 2, source_info_date: null, quality_status: 'synthetic', building_match_scope: 'exact' },
  source_fingerprint: 'a'.repeat(32), proxy_start: '2026-10-01', proxy_end: '2026-12-31', has_later_name_match: true, review: null,
};
const data: CandidatePage = { items: [item], total: 1, page: 1, page_size: 25, as_of: '2026-11-13', window_end: '2027-05-13' };
beforeEach(() => { state.role = 'admin'; state.status = 'authenticated'; state.replace.mockReset(); state.user = 'synthetic-admin'; state.token = 'synthetic-token'; state.impersonating = false; state.list.mockReset().mockResolvedValue(structuredClone(data)); });
afterEach(cleanup);

describe('read-only expiry under leasing', () => {
  it('opens the leasing route and displays estimates directly without a review or AI flow', async () => {
    render(<><LeaseExpiryLink /><LeaseExpiryTimeline /></>);
    expect(screen.getByRole('link', { name: '租约到期' })).toHaveAttribute('href', '/lease-submission/expiry');
    expect(await screen.findByText('合成验证企业')).toBeVisible();
    expect(screen.getByText('2026 年第四季度 · 待核对')).toBeVisible();
    expect(screen.getByRole('table', { name: '企业预计到期时间图' })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /保存|跟进|核实/ })).toBeNull();
    expect(screen.queryByText(/AI 分析/)).toBeNull();
  });
  it.each(['editor', 'viewer', 'broker', 'manager'])('hides both entries and returns %s to leasing without a data request', role => {
    state.role = role;
    render(<><LeaseExpiryLink /><LeaseExpiryLink variant="compact" /><LeaseExpiryTimeline /></>);
    expect(screen.queryByRole('link', { name: '租约到期' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '租约到期' })).toBeNull();
    expect(state.replace).toHaveBeenCalledWith('/lease-submission');
    expect(state.list).not.toHaveBeenCalled();
  });
  it('hides the entry and page while impersonating, even when the operator is admin', () => {
    state.impersonating = true;
    render(<><LeaseExpiryLink /><LeaseExpiryTimeline /></>);
    expect(screen.queryByRole('link', { name: '租约到期' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '租约到期' })).toBeNull();
    expect(state.replace).toHaveBeenCalledWith('/lease-submission');
    expect(state.list).not.toHaveBeenCalled();
  });
  it('keeps the feature hidden while checking the session and sends signed-out users to login', () => {
    state.status = 'loading';
    const view = render(<><LeaseExpiryLink /><LeaseExpiryTimeline /></>);
    expect(screen.queryByText('租约到期')).toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
    state.status = 'unauthenticated';
    view.rerender(<><LeaseExpiryLink /><LeaseExpiryTimeline /></>);
    expect(screen.queryByText('租约到期')).toBeNull();
    expect(state.replace).toHaveBeenCalledWith('/login');
    expect(state.list).not.toHaveBeenCalled();
  });
  it('clears records when a permission recheck fails', async () => {
    render(<LeaseExpiryTimeline />); await screen.findByText('合成验证企业');
    state.list.mockRejectedValueOnce(new LeaseReviewError('权限已撤回', 403));
    fireEvent.focus(window); await screen.findByText('权限已撤回');
    expect(screen.queryByText('合成验证企业')).toBeNull();
  });
  it('discards a delayed response after an account/token change', async () => {
    let resolveOld!: (result: CandidatePage) => void;
    state.list.mockImplementationOnce(() => new Promise<CandidatePage>(resolve => { resolveOld = resolve; }));
    const view = render(<LeaseExpiryTimeline />);
    state.user = 'second-admin'; state.token = 'second-token';
    state.list.mockResolvedValue({ ...data, items: [] }); view.rerender(<LeaseExpiryTimeline />);
    await screen.findByText('未来六个月暂无可估算的到期记录。');
    await act(async () => { resolveOld(data); });
    expect(screen.queryByText('合成验证企业')).toBeNull();
  });
  it('keeps failed reads distinct from empty results and can retry', async () => {
    state.list.mockRejectedValueOnce(new TypeError('Failed to fetch')); render(<LeaseExpiryTimeline />);
    await screen.findByText('到期记录读取失败，请检查网络后重试'); expect(screen.queryByText('未来六个月暂无可估算的到期记录。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await screen.findByText('合成验证企业');
  });
  it('paginates server records without counting them as unique companies', async () => {
    state.list.mockResolvedValueOnce({ ...data, total: 26 }).mockResolvedValueOnce({ ...data, total: 26, page: 2, items: [{ ...item, source: { ...item.source, company: '第二页企业' } }] });
    render(<LeaseExpiryTimeline />); await screen.findByText('合成验证企业');
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); await screen.findByText('第二页企业');
    expect(screen.queryByText('合成验证企业')).toBeNull();
    expect(screen.getByText('共 26 条成交记录 · 日期为估算')).toBeVisible();
    expect(state.list).toHaveBeenLastCalledWith('synthetic-token', 2, expect.any(AbortSignal));
  });
  it('removes displayed data immediately when the active role changes', async () => {
    const view = render(<LeaseExpiryTimeline />); await screen.findByText('合成验证企业');
    state.role = 'broker'; view.rerender(<LeaseExpiryTimeline />);
    expect(screen.queryByText('合成验证企业')).toBeNull();
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/lease-submission'));
    expect(screen.queryByRole('heading', { name: '租约到期' })).toBeNull();
  });
});


it('groups original period, term, area, industry and deal-building submarket', async () => {
  state.list.mockResolvedValue({ ...data, items: [{ ...item, details: { area_sqm: 1250.5, industry: '信息技术', sub_industry: '软件', sub_market: '合成子市场' } }] });
  render(<LeaseExpiryTimeline />);await screen.findByText('合成验证企业');
  expect(screen.getByText('2021 年第四季度')).toBeVisible();expect(screen.getByText('60 个月')).toBeVisible();expect(screen.getByText('1,250.5 ㎡')).toBeVisible();expect(screen.getByText('信息技术 / 软件')).toBeVisible();expect(screen.getByText('合成子市场')).toBeVisible();
  expect(screen.queryByText(/签约日|起租日|联网补充/)).toBeNull();
});
it('keeps missing details unknown and marks an inferred deal period', async () => {
  state.list.mockResolvedValue({...data,items:[{...item,source:{...item.source,period_source:'info_date_inferred_same_year'},details:{area_sqm:null,industry:null,sub_industry:null,sub_market:null}}]});
  render(<LeaseExpiryTimeline />);await screen.findByText('合成验证企业');expect(screen.getByText('成交期间（推定）')).toBeVisible();expect(screen.getAllByText('未记录')).toHaveLength(3);
});
