import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StackingPlanWorkspace } from '../StackingPlanWorkspace';

const mocks = vi.hoisted(() => ({
  useAppSession: vi.fn(),
  getSessionFast: vi.fn(),
  withImpersonationHeaders: vi.fn(),
}));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: mocks.useAppSession }));
vi.mock('@/src/services/Auth', () => ({ getSessionFast: mocks.getSessionFast }));
vi.mock('@/src/services/impersonationHeaders', () => ({ withImpersonationHeaders: mocks.withImpersonationHeaders }));

const BUILDING_ID = '9ee3e3ff-4845-41a1-a78f-390c11b1917a';
const floorA = '00000000-0000-4000-8000-000000000001';
const floorB = '00000000-0000-4000-8000-000000000002';
const unitA = '00000000-0000-4000-8000-000000000003';
const unitB = '00000000-0000-4000-8000-000000000004';
const fixture = {
  building: { id: BUILDING_ID, name: '霄云路33号' },
  towers: [{ id: 'tower-A', code: 'A', display_name: 'A 座' }, { id: 'tower-B', code: 'B', display_name: 'B 座' }],
  floors: [
    { id: floorA, tower_id: 'tower-A', floor_code: '5', level_order: 5, floor_area_sqm: 1716.47, zone: '低区', use_type: 'office' },
    { id: floorB, tower_id: 'tower-A', floor_code: '4', level_order: 4, floor_area_sqm: 1716.47, zone: '低区', use_type: 'office' },
  ],
  spaces: [
    { id: unitA, floor_id: floorA, unit_code: '整层', occupancy_status: 'occupied', tenant_name: '奥迪', area_sqm: 1716.47, lease_steps: [], notes: '尚未审核', verification_status: 'source_unverified', revision: 1, source_id: 'image' },
    { id: unitB, floor_id: floorB, unit_code: '整层', occupancy_status: 'vacant', tenant_name: null, area_sqm: 1716.47, lease_steps: [], notes: '', verification_status: 'source_unverified', revision: 1, source_id: 'image' },
  ],
  sources: [{ id: 'image', title: '用户上传截图', source_as_of: '2026-11-18', as_of_kind: 'source_data_as_of', review_state: 'date_confirmed', source_note: null }],
  basis: 'source_snapshot_unverified',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAppSession.mockReturnValue({ status: 'authenticated', session: { role: 'admin' } });
  mocks.getSessionFast.mockResolvedValue({ session: { access_token: 'test-token' }, role: 'admin' });
  mocks.withImpersonationHeaders.mockImplementation((headers: HeadersInit) => new Headers(headers));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => fixture })));
});

describe('Stacking Plan actual workspace focus continuity', () => {
  it('keeps Stacking Plan tenant input focused through filters, mid-word edits and Chinese IME', async () => {
    render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
    const initial = await screen.findByRole('button', { name: /奥迪/ });
    fireEvent.click(initial);
    fireEvent.click(screen.getByRole('button', { name: /编辑来源草稿/ }));
    const tenant = screen.getByLabelText('租户 / 用途') as HTMLInputElement;
    tenant.focus();
    fireEvent.change(tenant, { target: { value: '奥迪中国' } });
    tenant.setSelectionRange(2, 2);
    expect(document.activeElement).toBe(tenant);
    fireEvent.change(screen.getByLabelText('空间状态筛选'), { target: { value: 'vacant' } });
    expect(document.activeElement).toBe(tenant);
    expect(screen.getByLabelText('租户 / 用途')).toBe(tenant);
    expect(tenant.selectionStart).toBe(2);
    fireEvent.compositionStart(tenant);
    fireEvent.change(tenant, { target: { value: '奥迪租户中国' } });
    fireEvent.compositionEnd(tenant);
    expect(tenant.value).toBe('奥迪租户中国');
    expect(document.activeElement).toBe(tenant);
    fireEvent.change(screen.getByLabelText('空间状态筛选'), { target: { value: 'occupied' } });
    expect(screen.getByLabelText('租户 / 用途')).toBe(tenant);
    expect(document.activeElement).toBe(tenant);
    expect(tenant.value).toBe('奥迪租户中国');
  });

  it('keeps unsaved notes editable during the filter transition and does not rewrite the source snapshot', async () => {
    render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
    fireEvent.click(await screen.findByRole('button', { name: /奥迪/ }));
    fireEvent.click(screen.getByRole('button', { name: /编辑来源草稿/ }));
    const notes = screen.getByLabelText('备注 / 待核验事项') as HTMLTextAreaElement;
    notes.focus();
    fireEvent.change(notes, { target: { value: '首次校对' } });
    fireEvent.change(screen.getByLabelText('空间状态筛选'), { target: { value: 'vacant' } });
    fireEvent.change(notes, { target: { value: '首次校对—来源日期未确认' } });
    expect(notes.value).toBe('首次校对—来源日期未确认');
    expect(document.activeElement).toBe(notes);
    expect(screen.getByText(/来源快照 · 截至 2026-11-18/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.getSessionFast).toHaveBeenCalledTimes(1));
  });

  it('keeps tenant search focus through live results, edits and Chinese IME without replacing the input', async () => {
    render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
    const search = await screen.findByRole('searchbox', { name: '搜索租户、楼层或单元' }) as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: '奥' } });
    expect(document.activeElement).toBe(search);
    expect(screen.getByRole('button', { name: /奥迪/ })).toBeInTheDocument();
    search.setSelectionRange(1,1);
    fireEvent.change(search, { target: { value: '奥迪' } });
    expect(screen.getByRole('searchbox', { name: '搜索租户、楼层或单元' })).toBe(search);
    expect(document.activeElement).toBe(search);
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: '奥迪中国' } });
    fireEvent.compositionEnd(search);
    expect(search.value).toBe('奥迪中国');
    expect(screen.getByRole('button', { name: /奥迪/ }).className).toContain('miniMuted');
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /奥迪/ })).toBeInTheDocument();
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('');
  });

  it('shows the source quality caveat and never infers verified tenant facts from a date-confirmed screenshot', async () => {
    render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
    await screen.findByText(/逐项已核验/);
    expect(screen.getByText(/来源快照 · 截至 2026-11-18/)).toBeInTheDocument();
    expect(screen.getByText(/原始文件未归档/)).toBeInTheDocument();
    expect(screen.getByText(/来源快照 · 截至 2026-11-18/)).toBeInTheDocument();
  });

  it('preserves unsaved edit fields when refresh is rejected', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
      fireEvent.click(await screen.findByRole('button', { name: /奥迪/ }));
      fireEvent.click(screen.getByRole('button', { name: /编辑来源草稿/ }));
      const notes = screen.getByLabelText('备注 / 待核验事项') as HTMLTextAreaElement;
      fireEvent.change(notes, { target: { value: '请核对原图日期' } });
      fireEvent.click(screen.getByRole('button', { name: /刷新数据/ }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(notes.value).toBe('请核对原图日期');
      expect(screen.getByLabelText('备注 / 待核验事项')).toBe(notes);
      expect(mocks.getSessionFast).toHaveBeenCalledTimes(1);
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: /刷新数据/ }));
      await waitFor(() => expect(mocks.getSessionFast).toHaveBeenCalledTimes(2));
    } finally {
      confirm.mockRestore();
    }
  });

  it('closes export menu on Escape or outside pointer and keeps filters visible', async () => {
    render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
    await screen.findByRole('searchbox', { name: '搜索租户、楼层或单元' });
    const summary = screen.getByText('导出');
    const menu = summary.closest('details') as HTMLDetailsElement;
    expect(menu).not.toBeNull();
    menu.open = true;
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.open).toBe(false);
    menu.open = true;
    fireEvent.pointerDown(document.body);
    expect(menu.open).toBe(false);
    expect(screen.getByRole('searchbox', { name: '搜索租户、楼层或单元' })).toBeInTheDocument();
  });

  it('reports zero matching units while preserving floor navigation', async () => {
    render(<StackingPlanWorkspace buildingId={BUILDING_ID} />);
    const search = await screen.findByRole('searchbox', { name: '搜索租户、楼层或单元' });
    fireEvent.change(search, { target: { value: '不存在的租户名称' } });
    expect(screen.getByText('没有匹配单元')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /奥迪/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect((search as HTMLInputElement).value).toBe('');
  });

});
