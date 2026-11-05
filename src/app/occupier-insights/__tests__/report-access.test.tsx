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
    expect(container.querySelectorAll('main section')).toHaveLength(18);
    expect(screen.getByRole('navigation', { name: '报告章节' }).querySelectorAll('a')).toHaveLength(4);
    expect(screen.getByRole('link', { name: '决策与行动' })).toHaveAttribute('href', '#options');
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
    expect(container.querySelectorAll('main section')).toHaveLength(18);
    expect(container.querySelectorAll('figure[data-study]')).toHaveLength(11);
    expect(container.querySelectorAll('[data-survey-value]')).toHaveLength(62);
    expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0);
    expect(sourceNotes).toHaveLength(11);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '现有空间仍有价值，但审查不能停止。' })).toBeVisible();
    const count = Object.values(surveyPlots).reduce((sum, values) => sum + values.length, 0);
    expect(count).toBe(62);
  });

  it('removes the closing appendix and editorial footnotes while preserving survey values', () => {
    const { container } = render(<OccupierInsightsReport />);
    expect(container.querySelector('#sources')).toBeNull();
    expect(container.textContent).not.toMatch(/数据范围与应用边界|十一张现场资料|不代表北京|不等于|自行调查|AI\s*生成/);
    expect(screen.queryByRole('link', { name: /阅读公开调研/ })).not.toBeInTheDocument();
    const values = Array.from(container.querySelectorAll('[data-survey-value]')).map(row => row.textContent);
    for (const data of Object.values(surveyPlots)) {
      for (const [label, number] of data) expect(values).toContain(label + number.toFixed(1) + '%');
    }
    expect(new Set(Array.from(container.querySelectorAll('[data-plot]')).map(el=>el.getAttribute('data-plot'))).size).toBe(5);
  });
});
