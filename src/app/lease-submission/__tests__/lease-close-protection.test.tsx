import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ close: vi.fn(), save: vi.fn(), restore: vi.fn(), update: vi.fn(), duplicate: vi.fn(), companySearch: vi.fn(), companyDeals: vi.fn(), companyAssessment: vi.fn() }));
const buildings = [{ id: 'test-building', name: 'Synthetic Tower', submarket: 'CBD', district: '朝阳区', grade: 'A' }];
vi.mock('@/src/hooks/useBuildings', () => ({ useBuildings: () => ({ buildings, isLoading: false }) }));
vi.mock('@/src/services/leaseTransactionDraftService', () => ({ getLeaseTransactionDraft: () => state.restore(), saveLeaseTransactionDraft: (...args: unknown[]) => state.save(...args), deleteLeaseTransactionDraft: vi.fn() }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({ getAllBrokers: async () => [], checkFuzzyDuplicate: (...args: unknown[]) => state.duplicate(...args), submitTransaction: vi.fn(), updateTransaction: (...args: unknown[]) => state.update(...args) }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
vi.mock('@/src/services/leaseCompanyLookupClient', () => ({
  searchLeaseCompanies: (...args: unknown[]) => state.companySearch(...args),
  readRecentCompanyDeals: (...args: unknown[]) => state.companyDeals(...args),
  scheduleLeaseCompanyAssessment: (...args: unknown[]) => state.companyAssessment(...args),
}));
import type { LeaseCompanyLookupResult } from '../leaseCompanyLookup';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { LeaseTransactionForm } from '../components/LeaseTransactionWorkspaceForm';

function openForm() { render(<LeaseTransactionForm isOpen onClose={state.close} onSubmitSuccess={() => {}} userId="synthetic-user" userName="Synthetic" />); }
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).not.toBeDisabled()); }
function company() { return screen.getByLabelText(/企业名称/); }
function backdrop() { return document.querySelector<HTMLElement>('div[aria-hidden="true"][class*="z-[45]"]')!; }

beforeEach(() => {
  vi.clearAllMocks();
  state.restore.mockResolvedValue(null);
  state.duplicate.mockResolvedValue({ hasDuplicate: false, duplicates: [] });
  state.save.mockResolvedValue('2026-10-25T00:00:00Z');
  state.companySearch.mockReset().mockResolvedValue({ suggestions: [], hasRecentDeals: false });
  state.companyDeals.mockReset().mockResolvedValue({ records: [] });
  state.companyAssessment.mockReset().mockResolvedValue(undefined);
  window.localStorage.clear();
});
afterEach(cleanup);

describe('lease close protection', () => {
  it('keeps enterprise type focus and caret while filtering and selects the matching option', async () => {
    openForm(); await ready();
    const user = userEvent.setup();
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: /企业类型/ });
    await user.click(input);
    await user.keyboard('央');
    expect(screen.getByRole('option', { name: '央国企' })).toBeVisible();
    expect(screen.queryByRole('option', { name: '民企' })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    await user.keyboard('企{ArrowLeft}国');
    expect(screen.getByRole('combobox', { name: /企业类型/ })).toBe(input);
    expect(input).toHaveValue('央国企');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(2);
    await user.keyboard('{Enter}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('央国企');
  });
  it('keeps building search focus after option updates and locks the selected building', async () => {
    openForm(); await ready();
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText<HTMLInputElement>('搜索楼宇名称…');
    await user.click(input);
    await user.keyboard('S');
    expect(screen.getByRole('option', { name: 'Synthetic Tower' })).toBeVisible();
    expect(input).toHaveFocus();
    await user.keyboard('nthetic Tower{Home}{ArrowRight}y');
    expect(screen.getByRole('combobox', { expanded: true })).toBe(input);
    expect(input).toHaveValue('Synthetic Tower');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(2);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '清除选择' })).toBeVisible();
    expect(screen.getByText('Synthetic Tower')).toBeVisible();
    expect(screen.getByDisplayValue('CBD')).toHaveAttribute('readonly');
  });
  it.each(['backdrop', 'close', 'cancel', 'escape'])('asks before %s can discard entered values', async (entry) => {
    openForm(); await ready();
    fireEvent.change(company(), { target: { value: 'Unsaved company' } });
    if (entry === 'backdrop') fireEvent.click(backdrop());
    if (entry === 'close') fireEvent.click(screen.getByRole('button', { name: '关闭填报' }));
    if (entry === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消' }));
    if (entry === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    const confirm = await screen.findByRole('dialog', { name: '未保存的修改' });
    expect(state.close).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: '继续编辑' }));
    expect(company()).toHaveValue('Unsaved company');
    expect(state.close).not.toHaveBeenCalled();
  });
  it('closes a clean form without interrupting and requires explicit discard for dirty input', async () => {
    openForm(); await ready();
    fireEvent.click(screen.getByRole('button', { name: '关闭填报' }));
    expect(state.close).toHaveBeenCalledTimes(1);
    fireEvent.change(company(), { target: { value: 'Unsaved' } });
    fireEvent.click(backdrop());
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
    expect(state.close).toHaveBeenCalledTimes(2);
  });
  it('retains input on save failure and only closes after a successful retry', async () => {
    state.save.mockRejectedValueOnce(new Error('offline'));
    openForm(); await ready();
    fireEvent.change(company(), { target: { value: 'Keep this company' } });
    fireEvent.click(backdrop());
    fireEvent.click(await screen.findByRole('button', { name: '保存草稿并关闭' }));
    await screen.findAllByText(/草稿保存失败/);
    expect(state.close).not.toHaveBeenCalled();
    expect(company()).toHaveValue('Keep this company');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿并关闭' }));
    await waitFor(() => expect(state.close).toHaveBeenCalledTimes(1));
    expect(state.save.mock.calls[1][2].values.company).toBe('Keep this company');
  });
  it('blocks dismissal while saving and detects input typed after the saved snapshot', async () => {
    let resolve!: (date: string) => void;
    state.save.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    openForm(); await ready();
    fireEvent.change(company(), { target: { value: 'Snapshot' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    fireEvent.click(backdrop());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '未保存的修改' })).not.toBeInTheDocument();
    expect(state.close).not.toHaveBeenCalled();
    fireEvent.change(company(), { target: { value: 'Typed during save' } });
    await act(async () => { resolve('2026-10-25T00:00:00Z'); });
    fireEvent.click(backdrop());
    expect(await screen.findByRole('dialog', { name: '未保存的修改' })).toBeInTheDocument();
    expect(company()).toHaveValue('Typed during save');
  });
  it('warns on page unload only when input is unpreserved', async () => {
    openForm(); await ready();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(company(), { target: { value: 'Unpreserved' } });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await screen.findByText('草稿已保存到云端');
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved); expect(saved.defaultPrevented).toBe(false);
  });
});

const record: LeaseTransaction = { id: 'synthetic-record', company: 'Saved company', new_building: 'Synthetic Tower', floor_info: 'A', floor: '8', area_sqm: 100, face_rent: 300, effective_rent: 200, transaction_year: new Date().getFullYear(), transaction_quarter: `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`, demand_type: '新租', enterprise_type: '民企', industry: '专业服务', sub_industry: '咨询', building_grade: 'A', sub_market: 'CBD', district: '朝阳区', submitter_id: 'synthetic-user', submitter_name: 'Synthetic' };

describe('existing record close protection', () => {
  it('protects unsaved edits without offering a draft action for formal records', async () => {
    render(<LeaseTransactionForm isOpen onClose={state.close} onSubmitSuccess={() => {}} userId="synthetic-user" userName="Synthetic" mode="edit" initialData={record} />);
    await waitFor(() => expect(company()).toHaveValue('Saved company'));
    fireEvent.change(company(), { target: { value: 'Edited company' } });
    fireEvent.click(backdrop());
    const confirm = await screen.findByRole('dialog', { name: '未保存的修改' });
    expect(within(confirm).queryByRole('button', { name: '保存草稿并关闭' })).not.toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: '继续编辑' }));
    expect(company()).toHaveValue('Edited company');
    expect(state.update).not.toHaveBeenCalled();
  });
  it('blocks all close paths during a confirmed update and preserves values on failure', async () => {
    let resolve!: (result: { success: boolean; error: string }) => void;
    state.update.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<LeaseTransactionForm isOpen onClose={state.close} onSubmitSuccess={() => {}} userId="synthetic-user" userName="Synthetic" mode="edit" initialData={record} />);
    await waitFor(() => expect(company()).toHaveValue('Saved company'));
    fireEvent.change(company(), { target: { value: 'Pending company' } });
    fireEvent.click(screen.getByRole('button', { name: '更新记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认更新' }));
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
    fireEvent.click(backdrop());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(state.close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '关闭填报' })).toBeDisabled();
    await act(async () => { resolve({ success: false, error: 'synthetic write failure' }); });
    expect(company()).toHaveValue('Pending company');
    expect(state.close).not.toHaveBeenCalled();
  });
});


describe('duplicate confirmation preserves validated values', () => {
  it('keeps cleared optional numbers null after duplicate and edit confirmation', async () => {
    state.duplicate.mockResolvedValue({ hasDuplicate: true, duplicates: [record] });
    state.update.mockResolvedValue({ success: false, error: 'synthetic persistence stop' });
    render(<LeaseTransactionForm isOpen onClose={state.close} onSubmitSuccess={() => {}} userId="synthetic-user" userName="Synthetic" mode="edit" initialData={{ ...record, lease_term_months: 3, fit_out_months: 2, rent_free_months: 1 }} />);
    await waitFor(() => expect(company()).toHaveValue('Saved company'));
    for (const label of ['租期 (月)', '装修期 (月)', '免租期 (月)']) fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '更新记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认不是同一笔并提交' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认更新' }));
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
    expect(state.update.mock.calls[0][1]).toEqual(expect.objectContaining({ lease_term_months: null, fit_out_months: null, rent_free_months: null }));
  });
});

describe('新增成交的企业联想与近期成交', () => {
  it('keeps the same input, focus and caret across results and chooses a company without overwriting other fields', async () => {
    state.companySearch.mockImplementation(async (query: string) => ({
      suggestions: query === 'A' || query === 'Acme' ? [{ company: 'Acme 研究' }] : [],
      hasRecentDeals: query === 'Acme 研究',
    }));
    state.companyDeals.mockResolvedValue({ records: [{
      read_id: 'live:synthetic', record_source: 'live', new_building: '演示办公中心',
      demand_type: '扩租', area_sqm: 1234.5, effective_rent: 138.25,
      transaction_date: '2026-10-15', transaction_year: 2026, transaction_quarter: 'Q4',
    }] });
    openForm(); await ready();
    const user = userEvent.setup();
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '企业名称' });
    await user.type(screen.getByLabelText('疑似企业全称'), '原有待核名称');
    await user.click(input);
    await user.keyboard('A');
    expect(input).toHaveFocus();
    await screen.findByRole('option', { name: 'Acme 研究' });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    await user.keyboard('cXe{ArrowLeft}{Backspace}m');
    expect(input).toHaveValue('Acme');
    expect(input.selectionStart).toBe(3);
    await screen.findByRole('option', { name: 'Acme 研究' });
    expect(company()).toBe(input);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(3);
    expect(screen.queryByRole('button', { name: '查看近期成交' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('Acme 研究');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox', { name: '已有成交企业' })).not.toBeInTheDocument();
    const history = await screen.findByRole('button', { name: '查看近期成交' });
    expect(history).toHaveAttribute('aria-expanded', 'false');
    expect(state.companyDeals).not.toHaveBeenCalled();
    await user.tab();
    expect(history).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('演示办公中心')).toBeVisible();
    expect(screen.getByText(/2026-10-15/)).toBeVisible();
    expect(screen.getByText(/1,234.5 ㎡.*138.3 元/)).toBeVisible();
    await user.keyboard('{Escape}');
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: '未保存的修改' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    expect(state.save.mock.calls[0][2].values).toMatchObject({ company: 'Acme 研究', suspected_company_fullname: '原有待核名称' });
  });

  it('ignores delayed results and IME composition, then keeps unmatched and failed searches fillable', async () => {
    let resolveOld!: (value: LeaseCompanyLookupResult) => void;
    state.companySearch.mockImplementation((query: string) => {
      if (query === 'A') return new Promise((resolve) => { resolveOld = resolve; });
      if (query === '新企业') return Promise.reject(new Error('offline'));
      return Promise.resolve({ suggestions: [], hasRecentDeals: false });
    });
    openForm(); await ready();
    const user = userEvent.setup();
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '企业名称' });
    await user.click(input);
    await user.keyboard('A');
    await waitFor(() => expect(state.companySearch).toHaveBeenCalledWith('A', expect.any(AbortSignal)));
    await user.keyboard('B');
    expect(await screen.findByText('未找到匹配企业，可继续手动填写')).toBeVisible();
    await act(async () => resolveOld({ suggestions: [{ company: '过期候选' }], hasRecentDeals: true }));
    expect(screen.queryByText('过期候选')).not.toBeInTheDocument();
    expect(state.companySearch.mock.calls[0][1].aborted).toBe(true);
    expect(input).toHaveFocus();

    fireEvent.compositionStart(input);
    await user.clear(input);
    await user.keyboard('xin');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(state.companySearch).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    await user.clear(input);
    await user.keyboard('新');
    fireEvent.compositionEnd(input, { data: '新' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('新');
    await user.keyboard('企业');
    expect(input).toHaveValue('新企业');
    expect(await screen.findByText('暂时无法联想，可继续手动填写')).toBeVisible();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(3);
    expect(screen.queryByRole('button', { name: '查看近期成交' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    expect(state.save.mock.calls[0][2].values.company).toBe('新企业');
  });

  it('offers history for an exact typed name without a selection and retries a failed read without clearing the name', async () => {
    state.companySearch.mockImplementation(async (query: string) => ({
      suggestions: [],
      hasRecentDeals: query === '手填企业',
    }));
    state.companyDeals.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ records: [] });
    openForm(); await ready();
    const input = screen.getByRole('combobox', { name: '企业名称' });
    fireEvent.change(input, { target: { value: '手填企业' } });
    const button = await screen.findByRole('button', { name: '查看近期成交' });
    expect(state.companyDeals).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(await screen.findByText('暂时无法读取成交。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无可查看的成交。')).toBeVisible();
    expect(input).toHaveValue('手填企业');
    fireEvent.change(input, { target: { value: '另一家企业' } });
    expect(screen.queryByRole('region', { name: '近期成交' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看近期成交' })).not.toBeInTheDocument();
  });

  it('waits for settled input before a silent assessment and cancels it on continued editing', async () => {
    state.companySearch.mockResolvedValue({ suggestions: [{ company: '样本证券' }], hasRecentDeals: false, canAssessSimilar: true });
    openForm(); await ready();
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '企业名称' });
    vi.useFakeTimers();
    try {
      act(() => input.focus());
      fireEvent.change(input, { target: { value: '样本' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(280); });
      expect(screen.getByRole('option', { name: '样本证券' })).toBeVisible();
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(state.companyAssessment).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: '样本证券' } });
      input.setSelectionRange(3, 3);
      await act(async () => { await vi.advanceTimersByTimeAsync(280); });
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      expect(state.companyAssessment).toHaveBeenCalledExactlyOnceWith('样本证券', expect.any(AbortSignal));
      expect(state.companySearch).toHaveBeenCalledTimes(2); // No polling or hidden refresh.
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(3);
      expect(screen.queryByText(/可能是.*企业/)).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('distinguishes both relation labels and loads recent deals only for the explicitly selected name', async () => {
    const selected = '样本证券股份有限公司';
    state.companySearch.mockImplementation(async (query: string) => query === '样本' ? {
      suggestions: [{ company: selected, relation: 'same_company' }, { company: '样本银行股份有限公司', relation: 'related_company' }],
      hasRecentDeals: false, canAssessSimilar: true,
    } : { suggestions: [{ company: selected }], hasRecentDeals: true });
    openForm(); await ready();
    const user = userEvent.setup();
    const input = screen.getByRole<HTMLInputElement>('combobox', { name: '企业名称' });
    await user.type(input, '样本');
    expect(await screen.findByRole('option', { name: /样本证券股份有限公司.*可能是同一家企业/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /样本银行股份有限公司.*可能是关联企业/ })).toBeVisible();
    expect(input).toHaveValue('样本');
    expect(input).toHaveFocus();
    expect(state.companyDeals).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue(selected);
    await user.click(await screen.findByRole('button', { name: '查看近期成交' }));
    expect(state.companyDeals).toHaveBeenCalledExactlyOnceWith(selected, expect.any(AbortSignal));
    expect(state.companyAssessment).not.toHaveBeenCalled();
  });
});
