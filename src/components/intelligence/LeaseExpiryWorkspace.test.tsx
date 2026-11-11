import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate, CandidatePage, Review } from '@/src/lib/leaseExpiry/contracts';
const state = vi.hoisted(() => ({ role: 'admin', user: 'synthetic-admin', impersonating: false, list: vi.fn(), save: vi.fn() }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: 'authenticated', session: { role: state.role, user: { id: state.user }, session: { access_token: 'synthetic-token' } } }) }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: state.impersonating }) }));
vi.mock('@/src/services/leaseExpiryApi', async original => ({ ...await original<object>(), listLeaseReviews: state.list, saveLeaseReview: state.save }));
import { LeaseExpiryWorkspace } from './LeaseExpiryWorkspace';
import { LeaseReviewError } from '@/src/services/leaseExpiryApi';
const item: Candidate = {
  source_kind: 'history', source_available: true,
  source: { id: '11111111-1111-4111-8111-111111111111', company: '合成核实企业', building: '合成楼宇', period_start: '2021-10-01', period_end: '2021-12-31', period_source: 'info_date_inferred_same_year', precision: 'quarter', lease_term_months: 60, source_lease_term_raw: '60', source_file: 'synthetic.xlsx', source_sheet: 'Sheet1', source_row: 2, source_info_date: null, quality_status: 'synthetic', building_match_scope: 'project' },
  source_fingerprint: 'a'.repeat(32), proxy_start: '2026-10-01', proxy_end: '2026-12-31', has_later_name_match: true, review: null,
};
const page: CandidatePage = { items: [item], total: 1, page: 1, page_size: 25, as_of: '2026-11-11', window_end: '2027-05-11' };
const saved: Review = { source_kind: 'history', source_id: item.source.id, revision: 1, status: 'missing_info', notes: '缺起租日', evidence_reference: '', source_snapshot: item.source, source_fingerprint: item.source_fingerprint, updated_by: 'synthetic-admin', updated_at: '2026-11-11T03:00:00Z' };
async function open() { fireEvent.click(await screen.findByRole('button', { name: /合成核实企业/ })); fireEvent.click(screen.getByText('补充资料或标记问题（可选）')); }
beforeEach(() => { state.role = 'admin'; state.user = 'synthetic-admin'; state.impersonating = false; state.list.mockReset().mockResolvedValue(structuredClone(page)); state.save.mockReset().mockResolvedValue(saved); vi.spyOn(window,'confirm').mockReturnValue(false); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('F6 administrator review workspace', () => {
  it('shows estimated expiry without evidence entry or any save request', async () => {
    render(<LeaseExpiryWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: /合成核实企业/ }));
    expect(screen.getByText('预计到期区间：2026-10-01 — 2026-12-31')).toBeVisible();
    expect(screen.getByLabelText('补充备注')).not.toBeVisible();
    expect(screen.getByText('补充资料或标记问题（可选）').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: '返回清单' }));
    expect(state.save).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('keeps conflicting source estimates available and preserves optional existing notes', async () => {
    state.list.mockResolvedValue({ ...page, items: [{ ...item, review: { ...saved, status: 'source_conflict', notes: '原件与录入租期不一致' } }] });
    render(<LeaseExpiryWorkspace />);
    await open();
    expect(screen.getByText('存在来源差异，当前仍按系统录入值估算。')).toBeVisible();
    expect(screen.getByText('预计到期区间：2026-10-01 — 2026-12-31')).toBeVisible();
    expect(screen.getByLabelText('补充备注')).toHaveValue('原件与录入租期不一致');
    expect(state.save).not.toHaveBeenCalled();
  });

  it('does not mix live and history notes when their source UUIDs are identical', async () => {
    state.list.mockResolvedValue({ ...page, total: 2, items: [item, { ...item, source_kind: 'live' }] });
    state.save.mockImplementation(async (_token, input) => ({ ...saved, ...input, revision: 1 }));
    render(<LeaseExpiryWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: /日常填报/ }));
    fireEvent.click(screen.getByText('补充资料或标记问题（可选）'));
    fireEvent.change(screen.getByLabelText('补充备注'), { target: { value: '仅日常填报备注' } });
    fireEvent.click(screen.getByRole('button', { name: '保存补充记录' }));
    await screen.findByText('补充记录已保存，预计到期区间仍按成交数据计算。');
    expect(state.save).toHaveBeenCalledWith('synthetic-token', expect.objectContaining({ source_kind: 'live', source_id: item.source.id }));
    fireEvent.click(screen.getByRole('button', { name: '返回清单' }));
    fireEvent.click(screen.getByRole('button', { name: /历史导入/ }));
    fireEvent.click(screen.getByText('补充资料或标记问题（可选）'));
    expect(screen.getByLabelText('补充备注')).toHaveValue('');
  });
  it('preserves deleted daily source notes as read-only without inventing an expiry', async () => {
    state.list.mockResolvedValue({ ...page, items: [{ ...item, source_kind: 'live', source_available: false, proxy_start: null, proxy_end: null, review: { ...saved, source_kind: 'live' } }] });
    render(<LeaseExpiryWorkspace />); await open();
    expect(screen.getByText('原成交已删除，以下为已存补充记录，不再参与预计到期计算。')).toBeVisible();
    expect(screen.getByRole('button', { name: '保存补充记录' })).toBeDisabled();
    expect(screen.getByLabelText('补充备注')).toBeDisabled();
    expect(screen.getByLabelText('补充备注')).toHaveValue(saved.notes);
    expect(state.save).not.toHaveBeenCalled();
  });
  it('keeps Chinese search focus and caret through filter results and clears the query', async () => {
    const user = userEvent.setup(); render(<LeaseExpiryWorkspace />);
    const input = screen.getByLabelText('企业或楼宇') as HTMLInputElement;
    await user.click(input); fireEvent.compositionStart(input); fireEvent.change(input,{ target: { value: '合成' } });
    fireEvent.keyDown(input,{ key: 'Enter',isComposing: true }); expect(state.list).toHaveBeenCalledTimes(1);
    fireEvent.compositionEnd(input); fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
    await user.type(input,'企业'); expect(input.value).toBe('合成企业');
    await user.clear(input); fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(3)); expect(document.activeElement).toBe(input);
  });
  it('retains unsaved input after failed save and retries the same logical request', async () => {
    state.save.mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce(saved);
    render(<LeaseExpiryWorkspace />); await open();
    fireEvent.change(screen.getByLabelText('资料标记'),{target:{value:'missing_info'}});
    fireEvent.change(screen.getByLabelText('补充备注'),{target:{value:'缺起租日'}});
    fireEvent.click(screen.getByRole('button',{name:'保存补充记录'})); await screen.findByText('网络中断');
    expect(screen.getByLabelText('补充备注')).toHaveValue('缺起租日');
    fireEvent.click(screen.getByRole('button',{name:'返回清单'})); expect(screen.getByLabelText('补充备注')).toHaveValue('缺起租日');
    fireEvent.click(screen.getByRole('button',{name:'保存补充记录'})); await screen.findByText('补充记录已保存，预计到期区间仍按成交数据计算。');
    expect(state.save.mock.calls[0][1].request_id).toBe(state.save.mock.calls[1][1].request_id);
  });
  it('keeps evidence on conflict and never silently overwrites a newer draft', async () => {
    state.save.mockRejectedValue(new LeaseReviewError('另一位管理员已更新',409));
    render(<LeaseExpiryWorkspace />); await open();
    fireEvent.change(screen.getByLabelText('补充备注'),{target:{value:'我的核实证据'}});
    fireEvent.click(screen.getByRole('button',{name:'保存补充记录'})); await screen.findByText('另一位管理员已更新');
    expect(screen.getByLabelText('补充备注')).toHaveValue('我的核实证据');
    expect(screen.getByRole('button',{name:'保存补充记录'})).toBeDisabled();
  });
  it('clears data on revocation and ignores an older in-flight save', async () => {
    let resolve!: (review: Review) => void;
    state.save.mockReturnValue(new Promise<Review>(done => {resolve=done;}));
    render(<LeaseExpiryWorkspace />); await open(); fireEvent.click(screen.getByRole('button',{name:'保存补充记录'}));
    state.list.mockRejectedValue(new LeaseReviewError('权限已撤回',403));
    fireEvent(window,new Event('focus')); await screen.findByText('权限已撤回');
    await act(async () => resolve(saved));
    expect(screen.queryByText(/合成核实企业/)).toBeNull(); expect(screen.queryByLabelText('补充备注')).toBeNull();
  });
  it('discards old user responses after account switch and hides simulated/admin-revoked access', async () => {
    let resolve!: (data: CandidatePage) => void;
    state.list.mockReturnValueOnce(new Promise<CandidatePage>(done=>{resolve=done;}));
    const view=render(<LeaseExpiryWorkspace />); state.user='new-admin'; state.list.mockResolvedValue({...page,items:[],total:0}); view.rerender(<LeaseExpiryWorkspace />);
    await screen.findByText(/当前范围没有匹配记录/); await act(async()=>resolve(page)); expect(screen.queryByRole('button',{name:/合成核实企业/})).toBeNull();
    state.impersonating=true; view.rerender(<LeaseExpiryWorkspace />); expect(screen.queryByLabelText('企业或楼宇')).toBeNull();
    state.impersonating=false; state.role='viewer'; view.rerender(<LeaseExpiryWorkspace />); expect(screen.queryByLabelText('企业或楼宇')).toBeNull();
  });
});
