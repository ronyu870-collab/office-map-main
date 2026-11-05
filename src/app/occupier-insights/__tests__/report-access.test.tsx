import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OccupierInsightsReport } from '../OccupierInsightsReport';

const app = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: app.replace }) }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: app.status }) }));

describe('occupier insights access and continuous reading', () => {
  beforeEach(() => { app.status = 'authenticated'; app.replace.mockReset(); });

  it('prompts anonymous direct visitors to log in', async () => {
    app.status = 'unauthenticated';
    render(<OccupierInsightsReport />);
    expect(screen.queryByRole('heading', { name: '企业选址洞察' })).not.toBeInTheDocument();
    await waitFor(() => expect(app.replace).toHaveBeenCalledWith('/login'));
  });

  it('does not expose the report while the shared session is loading', () => {
    app.status = 'loading';
    render(<OccupierInsightsReport />);
    expect(screen.getByRole('status')).toHaveTextContent('正在打开企业选址洞察');
    expect(screen.queryByRole('heading', { name: '企业选址洞察' })).not.toBeInTheDocument();
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
