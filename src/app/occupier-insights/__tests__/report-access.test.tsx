import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OccupierInsightsReport } from '../OccupierInsightsReport';
import { surveyPlots, sourceNotes } from '../reportContent';

const app = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  session: { user: { id: 'test-viewer' } } as { user: { id: string } } | null,
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: app.replace }) }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: app.status, session: app.session }) }));

describe('occupier insights extended public research', () => {
  beforeEach(() => {
    app.status = 'authenticated';
    app.session = { user: { id: 'test-viewer' } };
    app.replace.mockReset();
  });

  it('keeps the public report readable without exposing internal system links', () => {
    app.status = 'unauthenticated';
    app.session = null;
    const { container } = render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeInTheDocument();
    expect(container.querySelectorAll('main section')).toHaveLength(19);
    expect(screen.getByRole('navigation', { name: '报告章节' }).querySelectorAll('a')).toHaveLength(4);
    expect(screen.getByRole('link', { name: '结论与口径' })).toHaveAttribute('href', '#sources');
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '打开北京办公楼市场地图' })).not.toBeInTheDocument();
    expect(app.replace).not.toHaveBeenCalled();
  });

  it('gates internal links by the shared session and retains public access after sign-out', () => {
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
  });

  it('keeps all eleven photo topics and all 62 chart observations visible', () => {
    const { container } = render(<OccupierInsightsReport />);
    expect(container.querySelectorAll('main section')).toHaveLength(19);
    expect(container.querySelectorAll('figure[data-study]')).toHaveLength(11);
    expect(container.querySelectorAll('[data-survey-value]')).toHaveLength(62);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(11);
    expect(sourceNotes).toHaveLength(11);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(screen.getByText('战略准备与优化机遇')).toBeVisible();
    expect(screen.getByText('结论与下一步')).toBeVisible();
    const count = Object.values(surveyPlots).reduce((sum, values) => sum + values.length, 0);
    expect(count).toBe(62);
  });

  it('retains third-party data boundaries without printing the competitor brand name', () => {
    const { container } = render(<OccupierInsightsReport />);
    for (const value of ['86.4', '69.1', '60.5', '54.3', '35.8', '7.4', '67.9']) {
      expect(screen.getAllByText(value).length).toBeGreaterThan(0);
    }
    const source = screen.getByRole('link', { name: /阅读公开调研原始页面/ });
    expect(source).toHaveAttribute('href', expect.stringContaining('cushwake.com'));
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/不代表北京企业的实际迁移、成交或未来供应/)).toBeVisible();
    expect(container.textContent).not.toMatch(/戴德梁行|AI\s*生成/);
    expect(container.querySelectorAll('img[aria-hidden="true"][alt=""]')).toHaveLength(3);
  });
});
