import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  session: vi.fn(), progress: vi.fn(), submissions: vi.fn(), team: vi.fn(), replace: vi.fn(),
}));
vi.mock('next/navigation', () => {
  const router = { replace: services.replace };
  return { useRouter: () => router };
});
vi.mock('next/dynamic', () => ({ default: () => ({ onSubmitSuccess }: { onSubmitSuccess: () => Promise<void> }) => (
  <button onClick={() => { void onSubmitSuccess(); }}>模拟成功保存</button>
) }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: services.session }));
vi.mock('@/src/services/leaseTransactionSubmitService', () => ({
  getWeeklyProgress: services.progress, getMySubmissions: services.submissions,
  getAllSubmissions: services.team, getAllBrokers: vi.fn(),
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/components/demo', () => ({ MaskedCell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/SubmissionDetailTable', () => ({ SubmissionDetailTable: () => <div>Team rows</div> }));
import LeaseSubmissionPage from '../page';

const record = { id: 'lease-1', company: '合成成交记录', new_building: '合成大楼' };
const progress = { submittedCount: 2, targetCount: 2, percentage: 100 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  services.session.mockResolvedValue({ user: { id: 'synthetic-user' }, displayName: '合成账号', role: 'viewer' });
  services.progress.mockResolvedValue(progress);
  services.submissions.mockResolvedValue([record]);
  services.team.mockResolvedValue([]);
});
afterEach(cleanup);

describe('租赁成交工作区独立读取', () => {
  it('renders personal history and read-only access while weekly progress is pending', async () => {
    const held = deferred<typeof progress>();
    services.progress.mockReturnValue(held.promise);
    render(<LeaseSubmissionPage />);
    const history = await screen.findByRole('region', { name: '我的提交记录' });
    expect(await within(history).findByText(record.company)).toBeInTheDocument();
    expect(screen.queryByText('本周进行中')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增成交' })).not.toBeInTheDocument();
    expect(within(history).queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    await act(async () => held.resolve(progress));
    expect(screen.getByText('本周已完成')).toBeInTheDocument();
    expect(screen.getByText('数据已就绪')).toBeInTheDocument();
  });

  it('renders weekly progress while history loads, without showing a false empty result', async () => {
    const held = deferred<(typeof record)[]>();
    services.submissions.mockReturnValue(held.promise);
    render(<LeaseSubmissionPage />);
    expect(await screen.findByText('本周已完成')).toBeInTheDocument();
    const history = screen.getByRole('region', { name: '我的提交记录' });
    expect(within(history).getByText('正在加载提交记录…')).toBeInTheDocument();
    expect(within(history).queryByText('暂无提交记录')).not.toBeInTheDocument();
    await act(async () => held.resolve([]));
    expect(within(history).getByText('暂无提交记录')).toBeInTheDocument();
  });

  it('keeps history usable after progress fails and retries only the failed resource', async () => {
    services.progress.mockRejectedValue(new Error('进度不可用'));
    render(<LeaseSubmissionPage />);
    const history = await screen.findByRole('region', { name: '我的提交记录' });
    const retry = await screen.findByRole('button', { name: '重试加载本周进度' }, { timeout: 2200 });
    expect(within(history).getByText(record.company)).toBeInTheDocument();
    expect(screen.queryByText('数据已就绪')).not.toBeInTheDocument();
    expect(services.progress).toHaveBeenCalledTimes(3);
    services.progress.mockResolvedValue(progress);
    fireEvent.click(retry);
    expect(await screen.findByText('本周已完成')).toBeInTheDocument();
    expect(services.submissions).toHaveBeenCalledTimes(1);
    expect(services.team).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a successful write and ignores the late opening read', async () => {
    const held = deferred<(typeof record)[]>();
    services.session.mockResolvedValue({ user: { id: 'synthetic-user' }, displayName: '合成账号', role: 'editor' });
    services.submissions.mockReturnValueOnce(held.promise);
    render(<LeaseSubmissionPage />);
    await screen.findByText('本周已完成');
    fireEvent.click(screen.getByRole('button', { name: '新增成交' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟成功保存' }));
    const history = screen.getByRole('region', { name: '我的提交记录' });
    expect(await within(history).findByText(record.company)).toBeInTheDocument();
    await act(async () => held.resolve([{ ...record, company: '过时的成交记录' }]));
    expect(within(history).queryByText('过时的成交记录')).not.toBeInTheDocument();
    expect(within(history).getByText(record.company)).toBeInTheDocument();
    expect(services.submissions).toHaveBeenCalledTimes(2);
    expect(services.progress).toHaveBeenCalledTimes(2);
  });

  it('keeps the personal workspace ready while the team overview still loads', async () => {
    const held = deferred<[]>();
    services.team.mockReturnValue(held.promise);
    render(<LeaseSubmissionPage />);
    expect(await screen.findByText('数据已就绪')).toBeInTheDocument();
    expect(screen.getByText('正在加载团队成交数据…')).toBeInTheDocument();
    expect(screen.getByText(record.company)).toBeInTheDocument();
    await act(async () => held.resolve([]));
    expect(screen.getByText('Team rows')).toBeInTheDocument();
  });
});
