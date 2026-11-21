import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SalesMaterialsPanel from '../components/sales-materials/SalesMaterialsPanel';
import type { MaterialAccess, SalesMaterial } from '@/src/lib/sales-materials/model';

const audit = vi.hoisted(() => vi.fn());
vi.mock('@/src/utils/audit', () => ({ logAction: audit }));
const material: SalesMaterial = { id: 'material-a', title: '业主资料', source: '业主', notes: '', original_name: 'original.png',
  mime_type: 'image/png', file_size: 1024, document_date: null, created_at: '2026-11-21T01:00:00Z', content_types: ['availability', 'brochure'] };
const access: MaterialAccess = { preview_url: 'https://synthetic.invalid/private?signature=secret', download_url: 'https://synthetic.invalid/download', details: [],
  provenance: { document_date_evidence: '', received: null, version_recorded_at: material.created_at, source_sha256: 'a'.repeat(64) }, project_facts: [] };
const reader = { list: vi.fn(), access: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); reader.list.mockResolvedValue({ records: [material], count: 1 }); reader.access.mockResolvedValue(access); });

it('observes loaded category, version and original views without logging refreshes or private data', async () => {
  render(<SalesMaterialsPanel buildingId="building-a" buildingName="甲楼" reader={reader} onClose={vi.fn()} />);
  await waitFor(() => expect(audit).toHaveBeenCalledWith(undefined, 'VIEW_BUILDING_MATERIALS', expect.objectContaining({ category: 'availability', material_ids: ['material-a'] })));
  fireEvent.click(screen.getByRole('button', { name: '项目资料' }));
  await waitFor(() => expect(audit).toHaveBeenCalledWith(undefined, 'VIEW_BUILDING_MATERIALS', expect.objectContaining({ category: 'brochure' })));
  const count = audit.mock.calls.length;
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(reader.access.mock.calls.length).toBeGreaterThan(1));
  expect(audit).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole('button', { name: '查看原件' }));
  await waitFor(() => expect(audit).toHaveBeenCalledWith(undefined, 'VIEW_MATERIAL_ORIGINAL', expect.objectContaining({ material_id: 'material-a', version_recorded_at: material.created_at, observation: 'viewer_opened' })));
  expect(JSON.stringify(audit.mock.calls)).not.toContain('signature');
  expect(JSON.stringify(audit.mock.calls)).not.toContain('source_sha256');
});

it('records a newly selected version but never reports a failed access as a displayed document', async () => {
  reader.list.mockResolvedValue({ records: [material, { ...material, id: 'material-b', title: '另一版本' }], count: 2 });
  render(<SalesMaterialsPanel buildingId="building-a" buildingName="甲楼" reader={reader} onClose={vi.fn()} />);
  await waitFor(() => expect(audit).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('combobox', { name: '资料版本' }), { target: { value: 'material-b' } });
  await waitFor(() => expect(audit).toHaveBeenCalledWith(undefined, 'VIEW_BUILDING_MATERIALS', expect.objectContaining({ material_ids: ['material-b'] })));
  audit.mockClear(); reader.access.mockRejectedValue(new Error('读取失败'));
  fireEvent.change(screen.getByRole('combobox', { name: '资料版本' }), { target: { value: 'material-a' } });
  await screen.findByRole('alert');
  expect(audit).not.toHaveBeenCalled();
});
