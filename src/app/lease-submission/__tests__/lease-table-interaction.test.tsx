import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { SubmissionDetailTable } from '../components/SubmissionDetailTable';

vi.mock('@/src/components/demo', () => ({ MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/AdminLeaseExportButton', () => ({ AdminLeaseExportButton: () => null }));
vi.mock('../components/LeaseTransactionHistoryDrawer', () => ({ LeaseTransactionHistoryDrawer: () => null }));

afterEach(cleanup);
const row = (id: number, extra: Partial<LeaseTransaction> = {}): LeaseTransaction => ({
  id: String(id), company: `企业${id}`, new_building: '测试楼宇', submitter_id: 'u1', submitter_name: '顾问',
  transaction_year: 2026, transaction_quarter: 'Q1', area_sqm: id, face_rent: 121.667, effective_rent: 100.375,
  industry: '金融', ...extra,
});

describe('成交汇总交互', () => {
  it('keeps team column option search focused during a correction and restores focus on close', async () => {
    const user = userEvent.setup();
    render(<SubmissionDetailTable submissions={[row(1, { industry: '互联网' }), row(2, { industry: '金融' })]} title="团队成交汇总" />);
    const trigger = screen.getByRole('button', { name: '行业分类筛选和排序' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    const search = within(dialog).getByRole('searchbox', { name: /搜索行业分类选项/ }) as HTMLInputElement;
    await user.type(search, '互网');
    expect(within(dialog).getByText('无匹配选项')).toBeInTheDocument();
    expect(search).toHaveFocus();
    search.setSelectionRange(1, 1);
    await user.keyboard('联');
    expect(search).toHaveValue('互联网');
    expect(search).toHaveFocus();
    expect(search.selectionStart).toBe(2);
    expect(within(dialog).getByRole('checkbox', { name: '互联网' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('sorts all records before paginating, resets page, exposes all header menus and preserves rent values', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 40 }, (_, i) => row(i));
    render(<SubmissionDetailTable submissions={rows} title="团队成交汇总" />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(16);
    for (const th of screen.getAllByRole('columnheader').slice(1)) expect(within(th).getByRole('button')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(within(screen.getByRole('table')).getByText('企业20')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '成交面积筛选和排序' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '从大到小' }));
    const body = screen.getByRole('table').querySelector('tbody')!;
    expect(within(body.rows[0]).getByText('企业39')).toBeVisible();
    expect(within(body).queryByText('企业0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '成交面积筛选和排序' }).closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(within(body.rows[0]).getByText('121.7')).toBeVisible();
    expect(within(body.rows[0]).getByText('100.4')).toBeVisible();
    expect(rows[39].face_rent).toBe(121.667);
  });

  it('retains header filter state and validates inverted numeric ranges', async () => {
    const user = userEvent.setup();
    render(<SubmissionDetailTable submissions={[row(1), row(2), row(3)]} title="团队成交汇总" />);
    await user.click(screen.getByRole('button', { name: '成交面积筛选和排序' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('成交面积最小值'), '3');
    await user.type(within(dialog).getByLabelText('成交面积最大值'), '1');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('最小值不能大于最大值');
    expect(within(dialog).getByRole('button', { name: '应用筛选' })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('成交面积最大值'));
    await user.type(within(dialog).getByLabelText('成交面积最大值'), '3');
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }));
    expect(within(screen.getByRole('table')).queryByText('企业1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('企业3')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '成交面积筛选和排序' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('成交面积最小值')).toHaveValue(3);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清除本列条件' }));
    expect(within(screen.getByRole('table')).getByText('企业1')).toBeVisible();
  });

  it('combines category multi-select with a cross-year quarter range and supports clearing all', async () => {
    const user = userEvent.setup();
    render(<SubmissionDetailTable submissions={[row(1, { transaction_year: 2025, transaction_quarter: 'Q4', industry: '金融' }), row(2, { industry: '互联网' }), row(3, { industry: '其他' })]} title="团队成交汇总" />);
    await user.click(screen.getByRole('button', { name: '行业分类筛选和排序' }));
    let dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '取消全选' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '金融' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '互联网' }));
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }));
    await user.click(screen.getByRole('button', { name: '成交季度筛选和排序' }));
    dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('起始季度'), '2026Q1');
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }));
    expect(within(screen.getByRole('table')).getByText('企业2')).toBeVisible();
    expect(within(screen.getByRole('table')).queryByText('企业1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('企业3')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重置筛选和排序' }));
    expect(within(screen.getByRole('table')).getByText('企业1')).toBeVisible();
    expect(within(screen.getByRole('table')).getByText('企业3')).toBeVisible();
  });

  it('closes the portal with Escape and outside click, and keeps full-screen mode when dismissing a menu', async () => {
    const user = userEvent.setup();
    render(<SubmissionDetailTable submissions={[row(1)]} title="团队成交汇总" />);
    await user.click(screen.getByRole('button', { name: '全屏显示团队成交汇总' }));
    await user.click(screen.getByRole('button', { name: '公司名称筛选和排序' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出全屏显示' })).toBeVisible();
    expect(screen.getByRole('button', { name: '公司名称筛选和排序' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '公司名称筛选和排序' }));
    await user.click(screen.getByText('团队成交汇总'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps departed submitters selectable even when all account activity flags are false', async () => {
    const user = userEvent.setup();
    const rows = [row(1, { submitter_active: false }), row(2, { submitter_id: 'u2', submitter_name: '离职顾问', submitter_active: false })];
    render(<SubmissionDetailTable submissions={rows} title="团队成交汇总" />);
    await user.click(screen.getByRole('button', { name: '提交人筛选和排序' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: '离职顾问' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: '取消全选' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '离职顾问' }));
    await user.click(within(dialog).getByRole('button', { name: '应用筛选' }));
    expect(within(screen.getByRole('table')).getByText('企业2')).toBeVisible();
    expect(within(screen.getByRole('table')).queryByText('企业1')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '提交人筛选和排序' }));
    expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: '离职顾问' })).toBeChecked();
  });
});

