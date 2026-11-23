import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BuildingMetricsEditModal } from '../BuildingMetricsEditModal';

const api = vi.hoisted(() => ({ from: vi.fn(), saved: vi.fn(), closed: vi.fn() }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: api.from } }));
vi.mock('@/src/services/buildingIdentity', () => ({ resolveBuildingId: vi.fn(async (_client: unknown, id: string) => id) }));
vi.mock('@/src/services/Auth', () => ({ getSession: vi.fn() }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('@/src/services/auditService', () => ({ AuditService: {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('navigation', new EventTarget());
  api.from.mockImplementation(table => {
    const data = table === 'buildings' ? { id: 'building-a', name: '测试楼', total_area: 10000 } : {
      id: 'metric-a', asking_rent: 8, management_fee: 30, face_rent: 180, rent_free_period: 3, vacant_area: 1000, updated_at: '2026-11-23T00:00:00Z',
    };
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn(async () => ({ data, error: null })) };
    for (const method of ['select', 'eq', 'order', 'limit'] as const) query[method].mockReturnValue(query);
    return query;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const props = { buildingId: 'building-a', buildingName: '测试楼', isOpen: true, onClose: api.closed, onSave: api.saved };
const unload = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };

it('protects actual metric edits from unload and releases the guard on revert, closed state and unmount', async () => {
  const view = render(<BuildingMetricsEditModal {...props} />);
  await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveValue('8'));
  const input = screen.getAllByRole('textbox')[0];
  expect(unload()).toBe(false);
  fireEvent.change(input, { target: { value: '9' } });
  expect(unload()).toBe(true);
  fireEvent.change(input, { target: { value: '8' } });
  expect(unload()).toBe(false);
  fireEvent.change(input, { target: { value: '9' } });
  view.rerender(<BuildingMetricsEditModal {...props} isOpen={false} />);
  expect(unload()).toBe(false);
  view.unmount();
  expect(unload()).toBe(false);
  expect(api.saved).not.toHaveBeenCalled();
});

it('cancels navigation while preserving the metric draft without saving', async () => {
  const navigation = new EventTarget(); vi.stubGlobal('navigation', navigation);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<><a href="/home" onClick={event => event.preventDefault()}>导航回归入口</a><BuildingMetricsEditModal {...props} /></>);
  await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveValue('8'));
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '9' } });
  fireEvent.click(screen.getByRole('link', { name: '导航回归入口' }));
  const event = new Event('navigate', { cancelable: true }); Object.assign(event, { navigationType: 'traverse' });
  navigation.dispatchEvent(event);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(event.defaultPrevented).toBe(true);
  expect(screen.getAllByRole('textbox')[0]).toHaveValue('9');
  expect(api.saved).not.toHaveBeenCalled();
});
