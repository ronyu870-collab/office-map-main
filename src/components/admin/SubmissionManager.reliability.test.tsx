import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ read: vi.fn(), export: vi.fn(), queries: [] as any[], assignmentConfig: null as any }));
vi.mock('@/src/services/supabaseClient', () => {
  function query(table: string) {
    const state: any = { table, filters: [], from: 0, to: 499 };
    const q: any = { select: () => q, order: () => q, eq: (field: string, value: any) => { state.filters.push([field, value]); return q; }, neq: () => q, in: () => q, range: (from: number, to: number) => { state.from = from; state.to = to; return q; }, then: (resolve: any, reject: any) => { mock.queries.push({ ...state }); return Promise.resolve(mock.read(state)).then(resolve, reject); } };
    return q;
  }
  return { supabase: { from: query, rpc: (name: string) => query(name) } };
});
vi.mock('xlsx', () => ({ utils: { json_to_sheet: (rows: unknown) => rows, book_new: () => ({}), book_append_sheet: vi.fn() }, writeFile: (...args: any[]) => mock.export(...args) }));
vi.mock('./GenericTablePanel', () => ({ GenericTablePanel: ({ config }: any) => { mock.assignmentConfig = config; return <div>Assignments</div>; } }));
vi.mock('./BuildingSortManager', () => ({ BuildingSortManager: () => null }));
vi.mock('./SubmissionGrid', () => ({ SubmissionGrid: ({ data, loading, emptyMessage }: any) => <div data-testid="grid">{loading ? 'Loading' : data.length ? JSON.stringify(data) : emptyMessage}</div>, ProgressRenderer: () => null, DateRenderer: () => null }));
vi.mock('@/src/components/demo', () => ({ MaskedText: ({ children }: any) => <>{children}</> }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
import { SubmissionManager } from './SubmissionManager';
const settings = [{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: '3' }];
function base(state: any) {
  if (state.table === 'get_quarterly_rollout_status') return { data: { quarter_configuration_frozen: false }, error: null };
  if (state.table === 'app_settings') return { data: settings, error: null };
  if (state.from > 0) return { data: [], error: null };
  if (state.table === 'user_roles') return { data: [{ user_id: 'synthetic-user', chinese_name: 'Synthetic User' }], error: null };
  if (state.table === 'buildings') return { data: [{ id: 'synthetic-building', name: 'Synthetic Tower', grade: 'A' }], error: null };
  if (state.table === 'future_supplies') return { data: [{ id: 'synthetic-future', name: 'Synthetic Future' }], error: null };
  return { data: [], error: null };
}
beforeEach(() => { mock.read.mockImplementation(base); mock.export.mockClear(); mock.queries.length = 0; });
afterEach(cleanup);

describe('admin submission UI regressions', () => {
  it('loads the configured quarter, exports all pages, and disables export during a new-filter request', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise(resolve => { release = resolve; });
    mock.read.mockImplementation((state: any) => {
      if (state.table !== 'quarterly_submissions') return base(state);
      const q = state.filters.find(([field]: any) => field === 'record_quarter')?.[1];
      if (q === 2) return pending;
      return { data: Array.from({ length: 1107 }, (_, id) => ({ id: String(id), building_id: 'synthetic-building', record_year: 2026, record_quarter: q })).slice(state.from, Math.min(state.to + 1, state.from + 100)), error: null };
    });
    render(<SubmissionManager />); fireEvent.click(screen.getByText('填报数据'));
    await waitFor(() => expect(screen.getByText('1107 条记录')).toBeTruthy());
    const selects = screen.getAllByRole('combobox');
    await waitFor(() => expect((selects[1] as HTMLSelectElement).value).toBe('3'));
    await waitFor(() => expect((screen.getByText('导出 Excel').closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('导出 Excel')); expect(mock.export).toHaveBeenCalledTimes(1);
    expect(mock.export.mock.calls[0][1]).toBe('填报数据_全部_2026Q3.xlsx');
    fireEvent.change(selects[1], { target: { value: '2' } });
    expect((screen.getByText('导出 Excel').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('grid').textContent).toBe('Loading');
    await act(async () => release({ data: [], error: null }));
  });
  it('reads current audit events with both selected quarter and user filters', async () => {
    render(<SubmissionManager />); fireEvent.click(screen.getByText('填报数据'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Synthetic User' })).toBeTruthy());
    fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'synthetic-user' } });
    fireEvent.click(screen.getByText('操作日志'));
    await waitFor(() => expect(mock.queries.some(q => q.table === 'audit_logs')).toBe(true));
    const query = mock.queries.filter(q => q.table === 'audit_logs').at(-1);
    expect(query.filters).toContainEqual(['user_id', 'synthetic-user']);
    expect(query.filters).toContainEqual(['details->>quarter', '3']);
    expect(query.filters).toContainEqual(['action_type', 'SUBMIT_QUARTERLY_DATA']);
    expect(mock.queries.some(q => q.table === 'quarterly_updates')).toBe(false);
  });
  it('reports progress query failure rather than zero coverage or fabricated unassigned projects', async () => {
    mock.read.mockImplementation((state: any) => state.table === 'building_assignments' ? { data: null, error: { message: 'assignment read failed' } } : base(state));
    render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('assignment read failed'));
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('未分配楼宇')).toBeNull();
  });
  it('renders UUID/nested future drafts with names, revision, period, and zero values', async () => {
    mock.read.mockImplementation((state: any) => state.table === 'update_drafts' && state.from === 0 ? { data: [{ id: 'synthetic-draft-uuid', user_id: 'synthetic-user', tab: 'GradeA', revision: 7, record_year: 2026, record_quarter: 3, updated_at: '2026-10-01T00:00:00Z', draft_data: { 'synthetic-building': { qQuote: 0 }, __futureSupply__: { 'synthetic-future': { qQuote: '90' } } } }], error: null } : base(state));
    render(<SubmissionManager />); fireEvent.click(screen.getByText('草稿管理'));
    await waitFor(() => expect(screen.getByText('2 栋有草稿')).toBeTruthy());
    expect(screen.getByText(/版本 7/).textContent).toContain('2026 Q3');
    const row = screen.getByText('2 栋有草稿').closest('tr')!;
    fireEvent.click(row.querySelector('button')!);
    expect(screen.getByText('Synthetic Tower')).toBeTruthy();
    expect(screen.getByText('未来供应 · Synthetic Future')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

it('does not fabricate unassigned rows when the assignments read fails', async () => {
  mock.read.mockImplementation((state: any) => state.table === 'building_assignments' ? { data: null, error: { message: 'assignments unavailable' } } : base(state));
  render(<SubmissionManager />);
  await expect(mock.assignmentConfig.customFetch()).rejects.toThrow('assignments unavailable');
});

it('keeps the all-user denominator, deduplicated coverage, and history disclaimer', async () => {
  const buildings = Array.from({ length: 594 }, (_, id) => ({ id: `tower-${id}`, name: `Tower ${id}` }));
  const assignments = buildings.map((b, i) => ({ building_id: b.id, user_id: i < 103 ? 'admin-fixture' : 'editor-fixture' }));
  mock.read.mockImplementation((state: any) => {
    let rows;
    if (state.table === 'buildings') rows = buildings;
    else if (state.table === 'building_assignments') rows = assignments;
    else if (state.table === 'user_roles') rows = [{ user_id: 'admin-fixture', chinese_name: 'Admin Fixture' }, { user_id: 'editor-fixture', chinese_name: 'Editor Fixture' }];
    else if (state.table === 'get_quarterly_submission_summary') rows = assignments.slice(103, 315).map(a => ({ ...a, created_at: '2026-09-10T00:00:00Z' }));
    else return base(state);
    return { data: rows.slice(state.from, state.to + 1), error: null };
  });
  render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
  await waitFor(() => expect(screen.getByText('594')).toBeTruthy());
  expect(screen.getByText('382')).toBeTruthy(); expect(screen.getByText('36%')).toBeTruthy();
  expect(screen.getByText('103')).toBeTruthy(); expect(screen.getByText('491')).toBeTruthy();
  expect(screen.getByText(/按当前分配责任统计全部用户/).textContent).toContain('含管理员');
  expect(screen.getByText(/按当前分配责任统计全部用户/).textContent).toContain('不等于字段完整');
});

it('discards a late expanded-user history response after changing quarters', async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  mock.read.mockImplementation((state: any) => {
    if (state.table === 'building_assignments') return { data: state.from ? [] : [{ building_id: 'synthetic-building', user_id: 'synthetic-user' }], error: null };
    if (state.table === 'quarterly_submissions') return state.from ? { data: [], error: null } : pending;
    return base(state);
  });
  render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
  await waitFor(() => { expect((screen.getAllByRole('combobox')[3] as HTMLSelectElement).value).toBe('3'); expect(screen.getByRole('button', { name: '查看 Synthetic User 的上传记录' })).toBeTruthy(); });
  fireEvent.click(screen.getByRole('button', { name: '查看 Synthetic User 的上传记录' }));
  fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: '2' } });
  await act(async () => release({ data: [{ building_id: 'synthetic-building', created_at: '2026-09-10T00:00:00Z' }], error: null }));
  expect(screen.queryByText('上传记录（点击下载）')).toBeNull(); expect(mock.export).not.toHaveBeenCalled();
});

it('preserves an explicit viewed quarter when moving between admin tabs', async () => {
  render(<SubmissionManager />); fireEvent.click(screen.getByText('填报数据'));
  await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('3'));
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '1' } });
  fireEvent.click(screen.getByText('草稿管理')); fireEvent.click(screen.getByText('填报数据'));
  expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('1');
  fireEvent.click(screen.getByText('填报进度'));
  expect((screen.getAllByRole('combobox')[3] as HTMLSelectElement).value).toBe('1');
});

it('refreshes configured period after saving and keeps it correct across tab remounts', async () => {
  let currentQuarter = '3';
  mock.read.mockImplementation((state: any) => {
    if (state.table === 'set_current_submission_period_v2') { currentQuarter = '4'; return { data: null, error: null }; }
    if (state.table === 'app_settings') return { data: [{ key: 'current_submission_year', value: '2026' }, { key: 'current_submission_quarter', value: currentQuarter }], error: null };
    return base(state);
  });
  render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
  await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('3'));
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '4' } });
  fireEvent.click(screen.getByText('保存'));
  await waitFor(() => expect(mock.queries.filter(q => q.table === 'app_settings').length).toBe(2));
  fireEvent.click(screen.getByText('草稿管理')); fireEvent.click(screen.getByText('填报进度'));
  await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('4'));
  expect((screen.getAllByRole('combobox')[3] as HTMLSelectElement).value).toBe('4');
});

it('excludes inactive/unassigned projects and distinguishes global coverage from reassigned owner coverage', async () => {
  const datasets: Record<string, any[]> = {
    buildings: [{ id: 'active-assigned', name: 'Assigned' }, { id: 'active-unassigned', name: 'Unassigned' }],
    building_assignments: [{ building_id: 'active-assigned', user_id: 'new-owner' }, { building_id: 'inactive', user_id: 'new-owner' }],
    user_roles: [{ user_id: 'old-owner', chinese_name: 'Old Owner' }, { user_id: 'new-owner', chinese_name: 'New Owner' }],
    get_quarterly_submission_summary: ['active-assigned', 'active-unassigned', 'inactive'].map(building_id => ({ building_id, user_id: 'old-owner', created_at: '2026-09-01T00:00:00Z' })),
  };
  mock.read.mockImplementation((state: any) => datasets[state.table] ? { data: datasets[state.table].slice(state.from, state.to + 1), error: null } : base(state));
  render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
  await waitFor(() => expect(screen.getByText('New Owner')).toBeTruthy());
  expect(screen.getByText('已分配楼宇（去重）').parentElement?.textContent).toBe('已分配楼宇（去重）1');
  expect(screen.getAllByText(/Q3 有记录/)[0].parentElement?.textContent).toContain('1');
  const cells = screen.getByText('New Owner').closest('tr')!.querySelectorAll('td');
  expect(cells[2].textContent).toBe('1'); expect(cells[3].textContent).toBe('0');
  expect(screen.queryByText('Old Owner')).toBeNull();
});


describe('quarter configuration rollout guard', () => {
  it.each([
    { name: 'frozen', response: { data: { quarter_configuration_frozen: true }, error: null }, message: /版本切换保护中/ },
    { name: 'read error', response: { data: null, error: { message: 'synthetic rollout status unavailable' } }, message: /季度切换状态读取失败/ },
    { name: 'unknown status', response: { data: {}, error: null }, message: /季度切换状态读取失败/ },
  ])('blocks configuration save and setter RPC when rollout status is $name', async ({ response, message }) => {
    mock.read.mockImplementation((state: { table: string }) => state.table === 'get_quarterly_rollout_status' ? response : base(state));
    render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
    await screen.findByText(message);
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '4' } });
    fireEvent.click(save);
    expect(mock.queries.some(query => query.table === 'set_current_submission_period_v2')).toBe(false);
    if (response.data && 'quarter_configuration_frozen' in response.data) {
      expect(screen.getByText(message)).toHaveTextContent('普通草稿保存和提交不受此冻结影响');
    }
  });

  it('keeps configuration save blocked while status is loading and enables it only after explicit false', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise(resolve => { release = resolve; });
    mock.read.mockImplementation((state: { table: string }) => state.table === 'get_quarterly_rollout_status' ? pending : base(state));
    render(<SubmissionManager />); fireEvent.click(screen.getByText('填报进度'));
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled(); fireEvent.click(save);
    expect(mock.queries.some(query => query.table === 'set_current_submission_period_v2')).toBe(false);
    await act(async () => release({ data: { quarter_configuration_frozen: false }, error: null }));
    await waitFor(() => expect(save).toBeEnabled());
    expect(mock.queries.some(query => query.table === 'set_current_submission_period_v2')).toBe(false);
  });
});
