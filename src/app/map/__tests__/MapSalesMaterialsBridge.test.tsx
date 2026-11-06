import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapSalesMaterialsBridge } from '../MapSalesMaterialsBridge';
vi.mock('next/dynamic', () => ({ default: () => function MockPanel({ buildingId, buildingName, onClose }: { buildingId: string; buildingName: string; onClose: () => void }) { return <div role="dialog" aria-label={buildingName} data-id={buildingId}><button onClick={onClose}>关闭销控</button></div>; } }));
afterEach(() => { document.body.innerHTML = ''; });
describe('sales materials map entry', () => {
  it('opens only the clicked building, including nested icon clicks, and closes cleanly', () => {
    render(<><button data-map-action="building-sales-control" data-building-id="building-a" data-building-name="甲楼"><span>查看甲楼</span></button><button data-map-action="building-sales-control" data-building-id="building-b" data-building-name="乙楼">查看乙楼</button><MapSalesMaterialsBridge /></>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('查看甲楼'));
    expect(screen.getByRole('dialog', { name: '甲楼' })).toHaveAttribute('data-id', 'building-a');
    fireEvent.click(screen.getByText('关闭销控'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('查看乙楼'));
    expect(screen.getByRole('dialog', { name: '乙楼' })).toHaveAttribute('data-id', 'building-b');
  });
  it('ignores placeholders lacking a building id and removes its listener on unmount', () => {
    const { unmount } = render(<MapSalesMaterialsBridge />);
    const button = document.createElement('button'); button.dataset.mapAction = 'building-sales-control'; button.textContent = '无上下文'; document.body.appendChild(button);
    fireEvent.click(button); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); unmount();
    button.dataset.buildingId = 'building'; fireEvent.click(button); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
