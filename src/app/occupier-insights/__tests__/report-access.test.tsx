import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OccupierInsightsReport } from '../OccupierInsightsReport';
import { charts } from '../reportContent';
const app = vi.hoisted(() => ({ status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading', session: { user: { id: 'synthetic-reader' } } as { user: { id: string } } | null }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: app.status, session: app.session }) }));

describe('occupier insights access and complete source coverage', () => {
  beforeEach(() => { app.status = 'authenticated'; app.session = { user: { id: 'synthetic-reader' } }; });
  it('preserves public reading during anonymous, loading and logout transitions', () => {
    app.status = 'unauthenticated'; app.session = null;
    const { container, rerender } = render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeVisible();
    expect(container.querySelectorAll('a[href="/"],a[href="/map"]')).toHaveLength(0);
    app.status = 'loading'; rerender(<OccupierInsightsReport />);
    expect(container.querySelectorAll('[data-observation]')).toHaveLength(62);
    app.status = 'authenticated'; app.session = { user: { id: 'synthetic-reader' } }; rerender(<OccupierInsightsReport />);
    expect(container.querySelectorAll('a[href="/"],a[href="/map"]')).toHaveLength(2);
    app.session = null; rerender(<OccupierInsightsReport />);
    expect(container.querySelectorAll('a[href="/"],a[href="/map"]')).toHaveLength(0);
    app.status = 'unauthenticated'; rerender(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeVisible();
  });
  it('shows all seventeen scenes and all eleven original slide topics without clicks', () => {
    const { container } = render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeVisible();
    expect(container.querySelectorAll('main section')).toHaveLength(18);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(new Set([...container.querySelectorAll('[data-source-slide]')].map(node => node.getAttribute('data-source-slide'))).size).toBe(11);
    expect(screen.getByRole('navigation', { name: '报告章节' }).querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: '打开北京办公楼市场地图' })).toHaveAttribute('href', '/map');
    expect(screen.getByText('资料与口径')).toBeVisible();
  });
  it('renders every source observation rather than substituting a top-four summary', () => {
    const { container } = render(<OccupierInsightsReport />);
    expect(container.querySelectorAll('[data-chart]')).toHaveLength(11);
    expect(container.querySelectorAll('[data-observation]')).toHaveLength(62);
    for (const [key, chart] of Object.entries(charts)) {
      const figure = container.querySelector(`[data-chart="${key}"]`)!;
      chart.items.forEach(([label,value]) => {
        const row = [...figure.querySelectorAll('[data-observation]')].find(item => item.textContent?.includes(label));
        expect(row).toBeDefined();
        expect(row?.textContent).toContain(`${value.toFixed(1)}%`);
      });
    }
  });
  it('uses neutral provenance without presenting the source as a platform survey', () => {
    const { container } = render(<OccupierInsightsReport />);
    expect(container.innerHTML).not.toMatch(/戴德梁行|Cushman|Wakefield|cushwake|AI\s*生成/i);
    expect(container.textContent).not.toContain('第三方租户调研 · 北京看楼应用');
    expect(screen.getByText(/不将其表述为本平台自行开展的调查/)).toBeVisible();
    expect(screen.getByText(/不代表北京企业的实际迁移、成交或未来供应/)).toBeVisible();
    expect(container.querySelectorAll('img[aria-hidden="true"][alt=""]')).toHaveLength(2);
  });
});
