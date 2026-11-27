import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepresentativeBrochureMatrix } from '../components/RepresentativeBrochureMatrix';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/src/services/map/marketAssetResearchClient', () => ({ fetchRepresentativeBrochures: read }));
vi.mock('@/src/utils/businessReadingAudit', () => ({ observeBusinessReading: vi.fn() }));

beforeEach(() => {
  read.mockReset().mockResolvedValue([
    { building_id: 'a', created_at: '2026-01-01', standard_floor_area: 500, clear_height: 3, contact_phone: 'private' },
    { building_id: 'unselected', standard_floor_area: 9999 },
  ]);
});
describe('representative brochure comparison', () => {
  it('loads only selected project IDs on demand and retains missing data honestly', async () => {
    const open = vi.fn();
    render(<RepresentativeBrochureMatrix projects={[{id:'a',name:'甲楼'},{id:'b',name:'乙楼'}]} identity="CBD" active onOpen={open} />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '比较代表项目楼书参数' }));
    const table = await screen.findByRole('table', { name: '代表项目楼书参数比较' });
    expect(read).toHaveBeenCalledWith(['a','b'], expect.any(AbortSignal));
    expect(within(table).getByRole('row', { name: /标准层面积/ })).toHaveTextContent('500');
    expect(within(table).getByRole('row', { name: /标准层面积/ })).toHaveTextContent('—');
    expect(table).not.toHaveTextContent('private');
    expect(table).not.toHaveTextContent('9999');
    fireEvent.click(within(table).getByRole('button', { name: '甲楼' }));
    expect(open).toHaveBeenCalledWith('a');
  });
});
