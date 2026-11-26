import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MapController } from '../MapController';
import { fetchBuildingTrendPayload } from '../mapDataClient';
vi.mock('../mapDataClient', () => ({ fetchBuildingTrendPayload: vi.fn() }));

const rows = [{ record_year: 2026, record_quarter: 3, net_effective_rent: 200, vacancy_rate: .12 }];
let toggle: (id: string, reading?: { onReady: () => void }) => void;
let controller: MapController;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchBuildingTrendPayload).mockReset();
  document.body.innerHTML = '<section id="info-chart-panel" style="display:none"><div class="workspace-trend-switch"><button id="chart-btn-rent" aria-pressed="true">净有效租金</button></div><div id="info-chart-container"></div></section>';
  controller = new MapController();
  toggle = (window as any).__colliers_toggleTrend;
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('distinguishes empty reads from errors and retries once without closing the panel', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(fetchBuildingTrendPayload).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce([]);
  const ready = vi.fn();
  toggle('a', { onReady: ready });
  await waitFor(() => expect(document.body.textContent).toContain('暂无历史数据'));
  expect(document.querySelector('#info-chart-container button')).toBeNull();
  toggle('a'); toggle('a', { onReady: ready });
  await waitFor(() => expect(document.body.textContent).toContain('历史数据读取失败'));
  const retry = document.querySelector<HTMLButtonElement>('#info-chart-container button')!;
  expect(retry).not.toBeNull();
  expect(retry.textContent).toBe('重试读取历史数据');
  retry.focus(); retry.click();
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(3));
  expect(fetchBuildingTrendPayload).toHaveBeenCalledTimes(3);
  expect(document.getElementById('info-chart-panel')?.style.display).toBe('block');
  expect(document.activeElement?.textContent).toContain('暂无历史数据');
  expect(ready).toHaveBeenCalledTimes(3);
});

it('ignores an earlier read after close and reopen of the same project', async () => {
  let finishOld!: (data: typeof rows) => void;
  vi.mocked(fetchBuildingTrendPayload).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValueOnce([]);
  const oldReady = vi.fn(), currentReady = vi.fn();
  toggle('a', { onReady: oldReady });
  toggle('a'); toggle('a', { onReady: currentReady });
  await waitFor(() => expect(currentReady).toHaveBeenCalledOnce());
  finishOld([]);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(oldReady).not.toHaveBeenCalled();
  expect(document.getElementById('info-chart-panel')?.dataset.trendState).toBe('empty');
  expect(currentReady).toHaveBeenCalledOnce();
});

it('ignores late reads after hiding or detaching the current trend panel', async () => {
  let finish!: (data: typeof rows) => void;
  vi.mocked(fetchBuildingTrendPayload).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const ready = vi.fn();
  toggle('a', { onReady: ready }); toggle('a'); finish([]);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(ready).not.toHaveBeenCalled();
  toggle('a', { onReady: ready }); document.getElementById('info-chart-panel')!.remove(); finish(rows);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(ready).not.toHaveBeenCalled();
});

it('does not render a pending read after controller destruction', async () => {
  let finish!: (data: typeof rows) => void;
  vi.mocked(fetchBuildingTrendPayload).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const ready = vi.fn();
  toggle('a', { onReady: ready }); controller.destroy(); finish([]);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(ready).not.toHaveBeenCalled();
});
