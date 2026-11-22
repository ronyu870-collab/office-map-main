import * as React from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildListResult } from '@/src/lib/intelligence/query/result';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
const client = vi.hoisted(() => ({ download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryDataTable } from '../HomeQueryDataTable';
const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const result = () => resultViewSchema.parse(buildListResult(fixture(), ['height', 'netEffectiveRent']));
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('continues search through result updates, middle edits, empty results and IME without losing focus or selection', async () => {
  const user = userEvent.setup();
  render(<HomeQueryDataTable result={result()} internalExport={false} onSource={vi.fn()} />);
  const input = screen.getByRole('searchbox', { name: '搜索本次结果' });
  await user.click(input); await user.type(input, 'A');
  expect(screen.getByRole('table')).toHaveTextContent('A座');
  expect(screen.getByRole('table')).not.toHaveTextContent('B座');
  await user.type(input, '座'); expect(input).toHaveValue('A座'); expect(input).toHaveFocus();
  (input as HTMLInputElement).setSelectionRange(1, 1); await user.keyboard('X');
  expect(input).toHaveValue('AX座'); expect(input).toHaveFocus();
  expect((input as HTMLInputElement).selectionStart).toBe(2);
  expect(screen.getByRole('table')).toHaveTextContent('没有匹配的记录');
  await user.clear(input); fireEvent.compositionStart(input); await user.type(input, 'B'); fireEvent.compositionEnd(input);
  await user.type(input, '座'); expect(input).toHaveValue('B座'); expect(input).toHaveFocus();
  expect(screen.getByRole('table')).toHaveTextContent('B座'); await user.clear(input);
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(4);
});
it('sorts actual values, keeps unknowns last, changes columns and selects across filters without mutating the snapshot', async () => {
  const value = result(), original = JSON.stringify(value);
  render(<HomeQueryDataTable result={value} internalExport={false} onSource={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '建筑高度（米）' }));
  const table = screen.getByRole('table');
  expect(table.querySelectorAll('tbody tr')[0]).toHaveTextContent('B座');
  expect(table.querySelectorAll('tbody tr')[3]).toHaveTextContent('D座');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择B座' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'A座' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '全选筛选结果' }));
  expect(screen.getByRole('status')).toHaveTextContent('已选 2 条');
  fireEvent.click(screen.getByText('显示字段'));
  fireEvent.click(screen.getByRole('checkbox', { name: '建筑高度' }));
  expect(within(table).queryByRole('columnheader', { name: /建筑高度/ })).toBeNull();
  expect(JSON.stringify(value)).toBe(original);
});
it('sends exact selected snapshot indexes for export, without model or new query calls', async () => {
  const value = result();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:fixture'); static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  client.download.mockResolvedValue({ blob: new Blob(['xlsx bytes']), filename: '选中.xlsx' });
  render(<HomeQueryDataTable result={value} requestId={requestId} scope={scope} internalExport onSource={vi.fn()} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择B座' })); fireEvent.click(screen.getByText('导出表格'));
  expect(screen.getByRole('combobox', { name: '导出范围' })).toHaveValue('selected');
  fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
  expect(client.download).toHaveBeenCalledWith(scope, { requestId, resultId: value.resultId, action: 'export', format: 'xlsx', selection: { kind: 'selected', rowIndexes: [1] } }, expect.any(AbortSignal));
  expect(screen.getByText('已发起下载')).toBeVisible();
});

function classified() {
  const raw = resultViewSchema.parse(buildListResult(fixture(), ['height']));
  return resultViewSchema.parse({ ...raw, table: { ...raw.table, columns: [...raw.table.columns, { key: 'submarket', label: '子市场', unit: null }, { key: 'grade', label: '等级', unit: null }],
    rows: raw.table.rows.map((row, i) => ({ ...row, cells: { ...row.cells, submarket: { kind: 'text', value: i < 3 ? 'CBD' : '望京', sourceIds: [] }, grade: { kind: 'text', value: i % 2 ? 'B' : 'A', sourceIds: [] } } })) } });
}
it('combines returned categories, explains outside selections, restores original sort and removes one filter', () => {
  const value = classified(), original = JSON.stringify(value);
  render(<HomeQueryDataTable result={value} internalExport={false} onSource={vi.fn()} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择B座' }));
  fireEvent.click(screen.getByText('筛选'));
  fireEvent.change(screen.getByRole('combobox', { name: '筛选子市场' }), { target: { value: 'CBD' } });
  fireEvent.change(screen.getByRole('combobox', { name: '筛选等级' }), { target: { value: '甲级' } });
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(2);
  expect(screen.getByRole('status')).toHaveTextContent('筛选外 1 条');
  fireEvent.click(screen.getByRole('button', { name: '建筑高度（米）' }));
  fireEvent.click(screen.getByRole('button', { name: '建筑高度（米）' }));
  fireEvent.click(screen.getByRole('button', { name: '恢复原始顺序' }));
  expect(screen.getByRole('columnheader', { name: '建筑高度（米）' })).toHaveAttribute('aria-sort', 'none');
  fireEvent.click(screen.getByRole('button', { name: '移除筛选：甲级' }));
  expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(3);
  expect(screen.getByRole('checkbox', { name: '选择B座' })).toBeChecked();
  expect(JSON.stringify(value)).toBe(original);
});
