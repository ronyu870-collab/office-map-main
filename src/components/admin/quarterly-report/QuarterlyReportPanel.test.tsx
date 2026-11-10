import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/src/services/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('./data', () => ({ loadReport: vi.fn() }));
vi.mock('./workbook', () => ({ reportBytes: vi.fn() }));
// Match the production dynamic-import namespace: no synthetic named export.
vi.mock('file-saver', () => ({ default: vi.fn() }));
vi.mock('@/src/components/ui', () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string }) => {
  const { size, variant, ...rest } = props; void size; void variant;
  return <button type="button" {...rest} />;
} }));
import { loadReport } from './data';
import { reportBytes } from './workbook';
import saveAs from 'file-saver';
import { logAction } from '@/src/utils/audit';
import { buildReport, type Report } from './model';
import { QuarterlyReportPanel } from './QuarterlyReportPanel';

function report(quarter = 3) {
  return buildReport({ period: { year: 2026, quarter }, capturedAt: '2026-10-10T02:00:00Z', users: [], previousMetrics: [],
    buildings: [{ id: 'a', name: '测试楼', grade: 'A', submarket: 'CBD' }],
    submissions: [{ id: 's', building_id: 'a', record_year: 2026, record_quarter: quarter, created_at: '2026-10-10T01:00:00Z', total_area: 100, net_effective_rent: 240, vacant_area: 0, vacancy_rate: 0 }] });
}
function Panel({ quarter = 3 }: { quarter?: number }) {
  return <QuarterlyReportPanel period={{ year: 2026, quarter, ready: true, setYear: vi.fn(), setQuarter: vi.fn(), configured: { data: { year: 2026, quarter: 3 }, loading: false, error: undefined, reload: vi.fn() } }} history={<div>原始记录及操作日志</div>} />;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadReport).mockReset().mockImplementation(async p => report(p.quarter));
  vi.mocked(reportBytes).mockReset().mockResolvedValue(new Uint8Array([80, 75]));
});
afterEach(cleanup);

describe('quarterly report panel', () => {
  it('shows three category tables in order and retains the existing history area', async () => {
    render(<Panel />);
    await screen.findByText('甲级写字楼');
    expect(screen.getAllByRole('region').map(n => n.getAttribute('aria-label'))).toEqual(['甲级写字楼', '乙级写字楼', '产业园']);
    expect(screen.getAllByRole('columnheader', { name: '2026 Q3租金' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: '原始记录' }));
    expect(screen.getByText('原始记录及操作日志')).toBeTruthy();
    expect(screen.getByText(/导出始终包含所选季度全部数据/)).toBeTruthy();
  });
  it('blocks export while data is loading and never presents an error as zero market figures', async () => {
    let reject!: (cause: Error) => void;
    vi.mocked(loadReport).mockReturnValue(new Promise((_resolve, r) => { reject = r; }));
    render(<Panel />);
    expect(screen.getByRole('button', { name: '导出 Excel' })).toBeDisabled();
    await act(async () => { reject(new Error('读取失败测试')); });
    expect(screen.getByRole('alert').textContent).toContain('读取失败测试');
    expect(screen.queryByText('甲级写字楼')).toBeNull();
    expect(screen.getByRole('button', { name: '导出 Excel' })).toBeDisabled();
  });
  it('ignores an old-quarter response that arrives after the new quarter', async () => {
    let resolveOld!: (r: Report) => void;
    vi.mocked(loadReport).mockImplementation(p => p.quarter === 3 ? new Promise(r => { resolveOld = r; }) : Promise.resolve(report(4)));
    const view = render(<Panel />);
    view.rerender(<Panel quarter={4} />);
    await screen.findByText('甲级写字楼');
    await act(async () => { resolveOld(report(3)); });
    expect(screen.getByRole('combobox', { name: '统计季度' })).toHaveValue('4');
    expect(screen.getAllByRole('columnheader', { name: '2026 Q4租金' })).toHaveLength(3);
  });
  it('exports the same snapshot as the dashboard once, with one audit event', async () => {
    const snapshot = report();
    vi.mocked(loadReport).mockResolvedValue(snapshot);
    render(<Panel />);
    await screen.findByText('甲级写字楼');
    const button = screen.getByRole('button', { name: '导出 Excel' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
    expect(reportBytes).toHaveBeenCalledWith(snapshot);
    expect(vi.mocked(saveAs).mock.calls[0][1]).toBe('季度市场数据_2026Q3.xlsx');
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction).toHaveBeenCalledWith(undefined, 'EXPORT_DATA', expect.objectContaining({ year: 2026, quarter: 3, record_count: 1, latest_building_count: 1 }));
  });
  it('cancels an export when the selected quarter changes during generation', async () => {
    let resolveBytes!: (r: Uint8Array) => void;
    vi.mocked(reportBytes).mockReturnValue(new Promise(r => { resolveBytes = r; }));
    const view = render(<Panel />);
    await screen.findByText('甲级写字楼');
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(reportBytes).toHaveBeenCalledTimes(1));
    view.rerender(<Panel quarter={4} />);
    await act(async () => { resolveBytes(new Uint8Array([80, 75])); });
    expect(saveAs).not.toHaveBeenCalled(); expect(logAction).not.toHaveBeenCalled();
  });
  it('does not log a successful export when file generation fails', async () => {
    vi.mocked(reportBytes).mockRejectedValue(new Error('文件生成失败测试'));
    render(<Panel />);
    await screen.findByText('甲级写字楼');
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('文件生成失败测试');
    expect(saveAs).not.toHaveBeenCalled(); expect(logAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '导出 Excel' })).not.toBeDisabled();
  });
});
