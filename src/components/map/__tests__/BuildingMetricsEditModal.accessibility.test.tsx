import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

it('associates editable metric and period labels with their controls', async () => {
  render(<BuildingMetricsEditModal {...props} />);
  await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveValue('8'));
  for (const label of ['报价租金','物业费','表面租金','免租期（月）','空置面积','年份','季度']) {
    expect(screen.getByLabelText(label,{exact:true})).toBeVisible();
  }
});

it('names the icon-only metric editor close action', async () => {
  render(<BuildingMetricsEditModal {...props} />);
  await waitFor(() => expect(screen.getAllByRole('textbox')[0]).toHaveValue('8'));
  expect(screen.getByRole('button',{name:'关闭指标编辑'})).toBeVisible();
});
