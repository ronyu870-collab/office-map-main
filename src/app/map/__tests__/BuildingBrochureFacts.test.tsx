import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BuildingBrochureFacts } from '../components/BuildingBrochureFacts';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/src/services/map/marketAssetResearchClient', () => ({ fetchRepresentativeBrochures: read }));
beforeEach(() => { read.mockReset(); });
describe('building brochure facts', () => {
  it('loads only the requested building, takes one edition, and never renders private fields or other projects', async () => {
    read.mockResolvedValue([
      { id:'new', building_id:'a', created_at:'2026-07-06T00:00:00Z', clear_height:2.75, gfa_office:104000, elevator_passenger:29, contact_phone:'private' },
      { id:'old', building_id:'a', created_at:'2025-07-06T00:00:00Z', standard_floor_area:99999 },
      { id:'other', building_id:'b', clear_height:88 },
    ]);
    const toggle = vi.fn();
    const view = render(<BuildingBrochureFacts buildingId="a" active opened={false} onToggle={toggle} />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'楼书参数'}));
    expect(toggle).toHaveBeenCalledOnce();
    view.rerender(<BuildingBrochureFacts buildingId="a" active opened onToggle={toggle} />);
    expect(await screen.findByText('2.75')).toBeVisible();
    expect(read).toHaveBeenCalledWith(['a'],expect.any(AbortSignal));
    expect(screen.queryByText('标准层面积')).not.toBeInTheDocument();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
    expect(screen.queryByText('88')).not.toBeInTheDocument();
  });
  it('keeps denied/error reads distinct from empty data and retries', async () => {
    read.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce([]);
    render(<BuildingBrochureFacts buildingId="a" active opened onToggle={vi.fn()} />);
    await screen.findByText(/楼书暂不可用/);
    fireEvent.click(screen.getByRole('button',{name:'重试'}));
    await screen.findByText('暂无可用楼书参数');
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
  });
  it('does not read a hidden work surface', () => {
    render(<BuildingBrochureFacts buildingId="a" active={false} opened onToggle={vi.fn()} />);
    expect(read).not.toHaveBeenCalled();
  });
});
