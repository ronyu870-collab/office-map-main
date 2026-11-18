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
  sources: [{ id: 'image', title: '用户上传截图', source_as_of: null, as_of_kind: 'unknown', review_state: 'pending_source_date', source_note: null }],
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
    const notes = screen.getByLabelText('备注 / 待核验事项') as HTMLTextAreaElement;
    notes.focus();
    fireEvent.change(notes, { target: { value: '首次校对' } });
    fireEvent.change(screen.getByLabelText('空间状态筛选'), { target: { value: 'vacant' } });
    fireEvent.change(notes, { target: { value: '首次校对—来源日期未确认' } });
    expect(notes.value).toBe('首次校对—来源日期未确认');
    expect(document.activeElement).toBe(notes);
    expect(screen.getByText(/截至日期未确认/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.getSessionFast).toHaveBeenCalledTimes(1));
  });
});
