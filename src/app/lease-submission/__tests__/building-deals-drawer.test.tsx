import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import LeaseSubmissionPage from '../page';

const state = vi.hoisted(() => ({
  rows: [] as LeaseTransaction[],
  router: { replace: vi.fn() },
  role: 'admin',
  demo: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => ({
  user: { id: 'synthetic-user' }, role: state.role, displayName: '合成账户', session: { access_token: 'fixture-token' },
}) }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({
  getWeeklyProgress: async () => ({ targetCount: 2, submittedCount: 0 }),
  getMySubmissions: async () => [],
  getAllSubmissions: async () => state.rows,
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/components/demo/DemoProvider', () => ({ useIsDemo: () => state.demo, DemoProvider: React.Fragment }));
vi.mock('../components/AdminLeaseExportButton', () => ({ AdminLeaseExportButton: () => null }));
vi.mock('../components/LeaseTransactionHistoryDrawer', () => ({ LeaseTransactionHistoryDrawer: () => null }));

function row(id: string, building: string): LeaseTransaction {
  return { id, company: `企业 ${id}`, new_building: building, submitter_id: 'staff', submitter_name: '示例顾问', industry: '金融', transaction_year: 2026, transaction_quarter: 'Q1' };
}
const payload = (records: unknown[], count = records.length) => Response.json({ records, count, access: { canReadHistory: state.role === 'admin' } });
const deal = (company: string, id = company) => ({
  read_id: id, company, transaction_year: 2025, transaction_quarter: 'Q3', area_sqm: 1260, effective_rent: 140.02,
});
const lookup = (building_id: string | null, building_match_scope: string) => payload([{ building_id, building_match_scope }]);
const search = (input: RequestInfo | URL) => new URL(String(input), 'https://preview.invalid').searchParams;

beforeEach(() => {
  state.role = 'admin';
  state.demo = false;
  state.rows = [row('a-row', '云庭 A 座'), row('b-row', '云庭 B 座'), row('p-row', '云庭中心'), row('u-row', '待核对楼宇')];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('楼宇成交抽屉', () => {
  it('opens from the actual page without toggling the row, separates project deals, and restores focus and the expanded row', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fixture-token');
      const params = search(input);
      if (params.get('live_record_id')) return lookup(params.get('live_record_id') === 'a-row' ? 'a' : 'b', 'exact');
      if (params.get('building_scope') === 'project') return payload([deal('仅项目企业')]);
      return payload([deal(params.get('building_id') === 'a' ? 'A 座企业' : 'B 座企业')]);
    });
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<LeaseSubmissionPage />);
    const openA = await screen.findByRole('button', { name: '查看云庭 A 座的成交记录' });
    const toggle = screen.getByRole('button', { name: '展开第1条成交详情' });
    await user.click(toggle);
    expect(fetcher).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '全屏显示团队成交汇总' }));
    openA.focus();
    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: '云庭 A 座' });
    const panel = within(drawer);
    expect(await panel.findByText('本楼成交 1 条 · 当前及历史')).toBeVisible();
    expect(panel.getByText('A 座企业')).toBeVisible();
    expect(panel.getByText('140.0')).toBeVisible();
    expect(panel.queryByText('B 座企业')).not.toBeInTheDocument();
    expect(panel.getByText('仅项目企业')).not.toBeVisible();
    const close = panel.getByRole('button', { name: '关闭楼宇成交' });
    const project = panel.getByRole('button', { name: /项目级成交/ });
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab();
    expect(project).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(project);
    expect(panel.getByText('仅项目企业')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(openA).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '退出全屏显示' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '查看云庭 B 座的成交记录' }));
    const other = within(await screen.findByRole('dialog', { name: '云庭 B 座' }));
    expect(await other.findByText('B 座企业')).toBeVisible();
    expect(other.queryByText('A 座企业')).not.toBeInTheDocument();
  });

  it('distinguishes project-only, unmapped, and known empty cases without picking a sibling tower', async () => {
    state.role = 'viewer';
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const params = search(input);
      if (params.get('live_record_id') === 'p-row') return lookup(null, 'project');
      if (params.get('live_record_id') === 'u-row') return lookup(null, 'unmapped');
      if (params.get('live_record_id')) return lookup('a', 'exact');
      return payload([]);
    });
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<LeaseSubmissionPage />);
    await user.click(await screen.findByRole('button', { name: '查看云庭中心的成交记录' }));
    expect(await screen.findByText('这条成交只关联到项目，尚未确认具体楼座。')).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '关闭楼宇成交' }));
    await user.click(screen.getByRole('button', { name: '查看待核对楼宇的成交记录' }));
    expect(await screen.findByText('这条成交尚未关联到可查询的楼宇。')).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: '关闭楼宇成交' }));
    await user.click(screen.getByRole('button', { name: '查看云庭 A 座的成交记录' }));
    expect(await screen.findByText('本楼成交 0 条 · 当前成交')).toBeVisible();
    expect(screen.getByText('当前可见范围内暂无本楼成交。')).toBeVisible();
  });

  it('opens the same scoped drawer from expanded details and returns focus to that building', async () => {
    state.role = 'viewer';
    state.rows.push(row('no-building', '   '));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const params = search(input);
      if (params.get('live_record_id') === 'a-row') return lookup('a', 'exact');
      if (params.get('building_id') === 'a' && params.get('building_scope') === 'tower') {
        return payload([deal('A 座企业')]);
      }
      return payload([]);
    });
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<LeaseSubmissionPage />);
    const toggle = await screen.findByRole('button', { name: '展开第1条成交详情' });
    await user.click(toggle);
    const details = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(details).not.toBeNull();
    const building = within(details!).getByRole('button', { name: '查看云庭 A 座的成交记录' });
    expect(fetcher).not.toHaveBeenCalled();
    await user.click(building);
    const drawer = within(await screen.findByRole('dialog', { name: '云庭 A 座' }));
    expect(await drawer.findByText('A 座企业')).toBeVisible();
    expect(drawer.getByText('本楼成交 1 条 · 当前成交')).toBeVisible();
    await waitFor(() => expect(drawer.getByRole('button', { name: '关闭楼宇成交' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(building).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const noBuilding = screen.getByRole('button', { name: '展开第5条成交详情' });
    await user.click(noBuilding);
    const missingBuildingDetails = document.getElementById(noBuilding.getAttribute('aria-controls')!);
    expect(missingBuildingDetails).not.toBeNull();
    expect(within(missingBuildingDetails!).queryByRole('button', { name: /成交记录/ })).not.toBeInTheDocument();
  });

  it('retries a failed request and appends the next scoped page without replacing the first', async () => {
    let failed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const params = search(input);
      if (params.has('live_record_id')) return lookup('a', 'exact');
      if (params.get('building_scope') === 'project') return payload([]);
      if (!failed) { failed = true; return Response.json({ error: '暂时不可用' }, { status: 500 }); }
      if (params.get('offset') === '0') return payload(Array.from({ length: 30 }, (_, i) => deal(`企业编号 ${i + 1}`)), 31);
      expect(params.get('offset')).toBe('30');
      expect(params.get('include_count')).toBe('0');
      return payload([deal('企业编号 31')]);
    }));
    const user = userEvent.setup();
    render(<LeaseSubmissionPage />);
    await user.click(await screen.findByRole('button', { name: '查看云庭 A 座的成交记录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用');
    await user.click(screen.getByRole('button', { name: '重新加载' }));
    await user.click(await screen.findByRole('button', { name: '加载更多' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(await drawer.findByText('企业编号 31')).toBeVisible();
    expect(drawer.getByText('企业编号 1')).toBeVisible();
    expect(drawer.getByRole('button', { name: '没有更多记录' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps masked demo building cells out of the drawer entry path', async () => {
    state.demo = true;
    const user = userEvent.setup();
    render(<LeaseSubmissionPage />);
    await waitFor(() => expect(screen.getByText('云庭 A 座')).toBeVisible());
    await user.click(screen.getByRole('button', { name: '展开第1条成交详情' }));
    expect(screen.queryByRole('button', { name: /查看云庭/ })).not.toBeInTheDocument();
  });
});
