import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ close: vi.fn(), save: vi.fn(), restore: vi.fn(), update: vi.fn() }));
const buildings = [{ id: 'test-building', name: 'Synthetic Tower', submarket: 'CBD', district: '朝阳区', grade: 'A' }];
vi.mock('@/src/hooks/useBuildings', () => ({ useBuildings: () => ({ buildings, isLoading: false }) }));
vi.mock('@/src/services/leaseTransactionDraftService', () => ({ getLeaseTransactionDraft: () => state.restore(), saveLeaseTransactionDraft: (...args: unknown[]) => state.save(...args), deleteLeaseTransactionDraft: vi.fn() }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({ getAllBrokers: async () => [], checkFuzzyDuplicate: async () => ({ hasDuplicate: false, duplicates: [] }), submitTransaction: vi.fn(), updateTransaction: (...args: unknown[]) => state.update(...args) }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { LeaseTransactionForm } from '../components/LeaseTransactionWorkspaceForm';

function openForm() { render(<LeaseTransactionForm isOpen onClose={state.close} onSubmitSuccess={() => {}} userId="synthetic-user" userName="Synthetic" />); }
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).not.toBeDisabled()); }
function company() { return screen.getByRole('textbox', { name: /企业名称/ }); }
function backdrop() { return document.querySelector<HTMLElement>('div[aria-hidden="true"][class*="z-[45]"]')!; }

beforeEach(() => {
  vi.clearAllMocks();
  state.restore.mockResolvedValue(null);
  state.save.mockResolvedValue('2026-10-25T00:00:00Z');
  window.localStorage.clear();
});
afterEach(cleanup);

describe('lease close protection', () => {
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
