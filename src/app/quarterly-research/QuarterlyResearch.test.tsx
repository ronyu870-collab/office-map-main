import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuarterlyResearch } from './QuarterlyResearch';
import { canReadQuarterlyResearch } from '@/src/config/quarterlyResearch';

const ctx = vi.hoisted(() => ({
  status: 'authenticated', impersonating: false,
  session: { role: 'admin', user: { id: 'synthetic-admin', app_metadata: { must_change_password: false } }, session: { access_token: 'synthetic-token' } },
}));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ctx }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: ctx.impersonating }) }));
vi.mock('@/src/services/impersonationHeaders', () => ({ withImpersonationHeaders: (headers: Record<string, string>) => headers }));
const fetcher = vi.fn();
beforeEach(() => {
  ctx.status = 'authenticated'; ctx.impersonating = false; ctx.session.role = 'admin'; ctx.session.user.app_metadata.must_change_password = false;
  fetcher.mockReset().mockResolvedValue(new Response('<h1>Synthetic fixture</h1>'));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('private research host lifecycle', () => {
  it.each(['viewer', 'editor', 'unknown'])('does not fetch or render report for %s', role => {
    ctx.session.role = role;
    render(<QuarterlyResearch />);
    expect(screen.getByText('此报告仅限管理员访问。')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
    expect(canReadQuarterlyResearch(role)).toBe(false);
  });
  it('does not permit impersonation or a forced password change', () => {
    ctx.impersonating = true;
    const { rerender } = render(<QuarterlyResearch />);
    expect(fetcher).not.toHaveBeenCalled();
    ctx.impersonating = false; ctx.session.user.app_metadata.must_change_password = true;
    rerender(<QuarterlyResearch />);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('loads authenticated inert content and removes it immediately when logged out', async () => {
    const { rerender } = render(<QuarterlyResearch />);
    const frame = await screen.findByTitle('2026Q3 北京写字楼交互研究');
    expect(frame).toHaveAttribute('srcdoc', '<h1>Synthetic fixture</h1>');
    expect(fetcher).toHaveBeenCalledWith('/api/quarterly-research?edition=2026Q3', expect.objectContaining({ cache: 'no-store', headers: { Authorization: 'Bearer synthetic-token' } }));
    ctx.status = 'unauthenticated'; rerender(<QuarterlyResearch />);
    expect(screen.queryByTitle('2026Q3 北京写字楼交互研究')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('ignores a late report response after logout', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValue(new Promise<Response>(r => { resolve = r; }));
    const { rerender } = render(<QuarterlyResearch />);
    ctx.status = 'unauthenticated'; rerender(<QuarterlyResearch />);
    await act(async () => { resolve(new Response('<h1>Late fixture</h1>')); });
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('accepts edition changes only from its active frame and removes the old content', async () => {
    render(<QuarterlyResearch />);
    const frame = await screen.findByTitle('2026Q3 北京写字楼交互研究') as HTMLIFrameElement;
    fireEvent(window, new MessageEvent('message', { source: window, data: { type: 'research-edition', edition: '2026Q2' } }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response('<h1>Previous fixture</h1>'));
    fireEvent(window, new MessageEvent('message', { source: frame.contentWindow, data: { type: 'research-edition', edition: '2026Q2' } }));
    await screen.findByTitle('2026Q2 北京写字楼交互研究');
    expect(document.querySelector('iframe')?.getAttribute('srcdoc') || '').not.toContain('Synthetic fixture');
    expect(fetcher).toHaveBeenLastCalledWith('/api/quarterly-research?edition=2026Q2', expect.any(Object));
  });
  it('revalidates on return to the tab and clears a report after access is revoked', async () => {
    render(<QuarterlyResearch />);
    await screen.findByTitle('2026Q3 北京写字楼交互研究');
    fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(screen.queryByTitle('2026Q3 北京写字楼交互研究')).not.toBeInTheDocument());
    expect(screen.getByText('访问状态已变化，请重新登录或重试。')).toBeInTheDocument();
    expect(document.querySelector('iframe')?.getAttribute('srcdoc') || '').not.toContain('Synthetic fixture');
  });
});
