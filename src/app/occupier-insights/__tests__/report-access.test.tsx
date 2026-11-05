import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OccupierInsightsReport } from '../OccupierInsightsReport';

const app = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  session: { user: { id: 'test-viewer' } } as { user: { id: string } } | null,
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: app.replace }) }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: app.status, session: app.session }) }));

describe('occupier insights access and continuous reading', () => {
  beforeEach(() => { app.status = 'authenticated'; app.session = { user: { id: 'test-viewer' } }; app.replace.mockReset(); });

  it('renders all report content and chapter links for visitors without internal links', () => {
    app.status = 'unauthenticated';
    app.session = null;
    render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(11);
    expect(screen.getByRole('link', { name: '来源与口径' })).toHaveAttribute('href', '#sources');
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '打开北京办公楼市场地图' })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: '回到报告开头' })) expect(link).toHaveAttribute('href', '#report-top');
    expect(app.replace).not.toHaveBeenCalled();
  });

  it('shows internal navigation only after login and removes it without hiding the report on sign-out', () => {
    app.status = 'loading';
    const { rerender } = render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();

    app.status = 'authenticated';
    rerender(<OccupierInsightsReport />);
    expect(screen.getAllByRole('link', { name: '返回首页' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: '打开北京办公楼市场地图' })).toHaveAttribute('href', '/map');

    app.status = 'unauthenticated';
    app.session = null;
    rerender(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '打开北京办公楼市场地图' })).not.toBeInTheDocument();
    expect(app.replace).not.toHaveBeenCalled();
  });

  it('exposes all chapters and all eleven source notes without disclosure clicks', () => {
    const { container } = render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '报告章节' }).querySelectorAll('a')).toHaveLength(4);
    expect(screen.getByRole('link', { name: '来源与口径' })).toHaveAttribute('href', '#sources');
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(11);
    expect(screen.getByText('办公策略复盘')).toBeVisible();
    expect(screen.getByText('受访者画像')).toBeVisible();
    expect(screen.getByRole('link', { name: '打开北京办公楼市场地图' })).toHaveAttribute('href', '/map');
  });

  it('preserves research values, source attribution and the distinction from Beijing transactions', () => {
    const { container } = render(<OccupierInsightsReport />);
    for (const value of ['86.4', '69.1', '60.5', '54.3', '35.8', '7.4', '67.9']) expect(screen.getByText(value)).toBeVisible();
    const source = screen.getByRole('link', { name: /戴德梁行原报告/ });
    expect(source).toHaveAttribute('href', expect.stringContaining('cushwake.com'));
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/不代表北京企业的实际迁移、成交或未来供应/)).toBeVisible();
    expect(container.textContent).not.toMatch(/AI\s*生成/);
    expect(container.querySelectorAll('img[aria-hidden="true"][alt=""]')).toHaveLength(3);
  });
});
