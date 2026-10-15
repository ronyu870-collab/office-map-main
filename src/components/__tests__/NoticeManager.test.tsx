import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticeManager } from '../NoticeManager';

const api = vi.hoisted(() => ({ getAllActiveNotices: vi.fn(), publishNotice: vi.fn(), deactivateNotice: vi.fn() }));
vi.mock('@/src/services/apiClient', () => ({ getAllActiveNotices: api.getAllActiveNotices }));
vi.mock('@/src/services/adminApi', () => api);
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const published = { id: 'notice-1', content: '已发布公告', updated_by: 'admin@example.test', updated_at: '2026-10-15T00:00:00Z' };

beforeEach(() => { vi.clearAllMocks(); api.getAllActiveNotices.mockResolvedValue([]); api.publishNotice.mockResolvedValue(published); api.deactivateNotice.mockResolvedValue(undefined); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function open() { await act(async () => { render(<NoticeManager adminEmail="admin@example.test" />); }); }
function drafts() { return screen.getAllByRole('textbox') as HTMLTextAreaElement[]; }
function fill(values: string[]) { values.forEach((value, index) => fireEvent.change(drafts()[index], { target: { value } })); }

describe('notice draft preservation', () => {
  it.each([0, 1, 2])('publishing slot %i keeps every other draft visible', async (slot) => {
    await open();
    fill(['草稿甲', '草稿乙', '草稿丙']);
    api.getAllActiveNotices.mockResolvedValue([published]);
    await act(async () => { fireEvent.click(screen.getAllByText('发布公告')[slot]); });
    expect(api.publishNotice).toHaveBeenCalledExactlyOnceWith(['草稿甲', '草稿乙', '草稿丙'][slot], 'admin@example.test');
    expect(drafts().map(input => input.value)).toEqual(['草稿甲', '草稿乙', '草稿丙'].filter((_, index) => index !== slot));
  });

  it('keeps drafts when deleting an active notice', async () => {
    api.getAllActiveNotices.mockResolvedValueOnce([published]).mockResolvedValue([]);
    await open();
    fill(['保留甲', '保留乙']);
    await act(async () => { fireEvent.click(screen.getByText('删除此条')); });
    expect(drafts().map(input => input.value)).toEqual(['保留甲', '保留乙', '']);
  });

  it('keeps all input after publishing fails', async () => {
    await open();
    fill(['失败保留', '另一个草稿', '']);
    api.publishNotice.mockRejectedValueOnce(new Error('发布失败'));
    await act(async () => { fireEvent.click(screen.getAllByText('发布公告')[0]); });
    expect(drafts().map(input => input.value)).toEqual(['失败保留', '另一个草稿', '']);
  });

  it('serializes publishing while preserving edits in the other draft slots', async () => {
    let resolve!: (value: typeof published) => void;
    api.publishNotice.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    await open();
    fill(['发布甲', '保留乙', '']);
    fireEvent.click(screen.getAllByText('发布公告')[0]);
    expect(drafts()[0]).toBeDisabled();
    fireEvent.change(drafts()[1], { target: { value: '乙继续输入' } });
    fireEvent.click(screen.getAllByText('发布公告')[0]);
    expect(api.publishNotice).toHaveBeenCalledTimes(1);
    api.getAllActiveNotices.mockResolvedValue([published]);
    await act(async () => { resolve(published); });
    expect(drafts()[0]).toHaveValue('乙继续输入');
  });
});
