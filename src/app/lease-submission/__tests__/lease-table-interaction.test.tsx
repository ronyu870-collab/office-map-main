import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { SubmissionDetailTable } from '../components/SubmissionDetailTable';

vi.mock('@/src/components/demo', () => ({ MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/AdminLeaseExportButton', () => ({ AdminLeaseExportButton: () => null }));
const auditRows = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(table === 'audit_logs' ? auditRows.load() : { data: [], error: null }).then(resolve);
        },
      };
      return query;
    },
  },
}));

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

  it('offers the horizontal hint only for content still offscreen and restores it after scrolling back', () => {
    const { rerender } = render(<SubmissionDetailTable submissions={[row(1)]} title="团队成交汇总" />);
    const hint = () => screen.queryByText('横向滑动查看更多列');
    const scroller = screen.getByRole('table').parentElement!;
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 320, writable: true },
    });
    fireEvent.scroll(scroller);
    expect(hint()).not.toBeInTheDocument();
    Object.defineProperty(scroller, 'scrollWidth', { value: 1000 });
    fireEvent.scroll(scroller);
    expect(hint()).not.toHaveAttribute('aria-hidden');

    scroller.scrollLeft = 679.5;
    fireEvent.scroll(scroller);
    expect(hint()).toHaveAttribute('aria-hidden', 'true');
    scroller.scrollLeft = 630;
    fireEvent.scroll(scroller);
    expect(hint()).not.toHaveAttribute('aria-hidden');
    rerender(<SubmissionDetailTable submissions={[]} title="团队成交汇总" />);
    expect(hint()).not.toBeInTheDocument();
  });

  it('opens and closes details from the keyboard and preserves row-click and management actions', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const record = row(1, { remarks: '详情内容保持可达', submitter_name: 'Alexandria Montgomery' });
    render(<SubmissionDetailTable submissions={[record]} title="团队成交汇总" canManageTeamRecords onEdit={onEdit} />);
    const toggle = screen.getByRole('button', { name: '展开第1条成交详情' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('详情内容保持可达')).toBeVisible();
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toContainElement(screen.getByText('详情内容保持可达'));
    expect(within(document.getElementById(toggle.getAttribute('aria-controls')!)!).getByText('Alexandria Montgomery')).toBeVisible();
    await user.keyboard(' ');
    expect(screen.queryByText('详情内容保持可达')).not.toBeInTheDocument();
    await user.click(screen.getByText('企业1'));
    expect(screen.getByText('详情内容保持可达')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '管理记录' }));
    await user.click(screen.getByRole('button', { name: '编辑企业1的成交记录' }));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(record);
    expect(screen.getByText('详情内容保持可达')).toBeVisible();
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

  it('keeps the company filter input and caret through successive edits with a condition applied and after reset', async () => {
    const user = userEvent.setup();
    render(<SubmissionDetailTable submissions={[
      row(1, { company: 'Alto Capital' }),
      row(2, { company: 'Arbor Tech', industry: '科技' }),
    ]} title="团队成交汇总" />);
    await user.click(screen.getByRole('button', { name: '行业分类筛选和排序' }));
    const industry = within(screen.getByRole('dialog'));
    await user.click(industry.getByRole('checkbox', { name: '科技' }));
    await user.click(industry.getByRole('button', { name: '应用筛选' }));
    expect(screen.getByText(/已筛选 1 项/)).toBeVisible();

    const companyFilter = screen.getByRole('button', { name: '公司名称筛选和排序' });
    async function enterCompany(text: string) {
      await user.click(companyFilter);
      const company = within(screen.getByRole('dialog'));
      const input = company.getByRole('textbox', { name: '公司名称包含关键词' }) as HTMLInputElement;
      expect(input).toHaveFocus();
      await user.keyboard(text[0]);
      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(1);
      await user.keyboard(`${text[1]}{ArrowLeft}${text[2]}`);
      expect(company.getByRole('textbox', { name: '公司名称包含关键词' })).toBe(input);
      expect(input).toHaveFocus();
      expect(input).toHaveValue(text[0] + text[2] + text[1]);
      expect(input.selectionStart).toBe(2);
      await user.click(company.getByRole('button', { name: '应用筛选' }));
      expect(companyFilter).toHaveFocus();
    }
    await enterCompany('Atl');
    expect(screen.getByText(/已筛选 2 项/)).toBeVisible();
    expect(within(screen.getByRole('table')).getByText('Alto Capital')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重置筛选和排序' }));
    await enterCompany('Abr');
    expect(within(screen.getByRole('table')).getByText('Arbor Tech')).toBeVisible();
    expect(within(screen.getByRole('table')).queryByText('Alto Capital')).not.toBeInTheDocument();
  });

  it('continues searching change history from the toolbar as audit rows arrive and the result narrows', async () => {
    let resolveAudit!: (value: unknown) => void;
    auditRows.load.mockReturnValueOnce(new Promise((resolve) => { resolveAudit = resolve; }));
    const user = userEvent.setup();
    render(<SubmissionDetailTable submissions={[row(1)]} title="团队成交汇总" canManageTeamRecords />);
    await user.click(screen.getByRole('button', { name: '变更记录' }));
    const history = within(screen.getByRole('dialog', { name: '租赁成交变更记录' }));
    const input = history.getByPlaceholderText('搜索企业 / 楼宇') as HTMLInputElement;
    await user.click(input);
    await user.keyboard('A');
    expect(history.getByText('正在读取变更记录')).toBeVisible();
    await act(async () => resolveAudit({
      data: [
        { id: 1, user_id: 'system', target_name: 'Alto Capital' },
        { id: 2, user_id: 'system', target_name: 'Arbor Tech' },
      ],
      error: null,
    }));
    expect(await history.findByText('Arbor Tech')).toBeVisible();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    await user.keyboard('t{ArrowLeft}l');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Alt');
    expect(input.selectionStart).toBe(2);
    expect(history.getByText('Alto Capital')).toBeVisible();
    expect(history.queryByText('Arbor Tech')).not.toBeInTheDocument();
    await user.click(history.getByRole('button', { name: '关闭变更记录' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

