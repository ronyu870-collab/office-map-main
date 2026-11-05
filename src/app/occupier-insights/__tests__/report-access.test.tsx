import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OccupierInsightsReport } from '../OccupierInsightsReport';

const app = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'unauthenticated',
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: app.replace }) }));
vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => ({ status: app.status }),
}));

describe('occupier insights access and reading', () => {
  beforeEach(() => { app.status = 'authenticated'; app.replace.mockReset(); });

  it('prompts anonymous direct visitors to log in', async () => {
    app.status = 'unauthenticated';
    render(<OccupierInsightsReport />);
    expect(screen.queryByRole('heading', { name: '企业选址洞察' })).not.toBeInTheDocument();
    await waitFor(() => expect(app.replace).toHaveBeenCalledWith('/login'));
  });

  it('gives a reader a chapter index, source and access to the supporting notes', () => {
    render(<OccupierInsightsReport />);
    expect(screen.getByRole('heading', { name: '企业选址洞察' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '来源与口径' })).toHaveAttribute('href', '#sources');
    expect(screen.getByRole('link', { name: /戴德梁行原报告/ })).toHaveAttribute('href', expect.stringContaining('cushwake.com'));
    const disclosure = screen.getByText('查看 11 张现场照片的内容提要');
    fireEvent.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('办公策略复盘')).toBeVisible();
  });
});
