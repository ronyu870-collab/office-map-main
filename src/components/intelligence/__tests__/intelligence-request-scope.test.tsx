import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AuthSessionResult } from '@/src/services/Auth';
import { IntelligenceRecommendationWorkspace } from '../IntelligenceRecommendationWorkspace';

const mocks = vi.hoisted(() => ({
  session: null as AuthSessionResult | null,
  recommend: vi.fn(),
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/src/components/SessionProvider', () => ({
  useAppSession: () => ({ session: mocks.session, status: 'authenticated' }),
}));
vi.mock('@/src/services/intelligenceApi', () => ({
  recommendIntelligenceBuildings: mocks.recommend,
}));

function session(realId: string, effectiveId: string): AuthSessionResult {
  return {
    user: { id: effectiveId },
    session: { access_token: `token-${realId}`, user: { id: realId } },
    role: 'admin',
  } as AuthSessionResult;
}

it('cancels the previous scope and never renders its late result after the effective identity changes', async () => {
  mocks.session = session('operator', 'first');
  let reject!: (reason: Error) => void;
  mocks.recommend.mockReturnValueOnce(new Promise((_, failed) => { reject = failed; }));
  const view = render(<IntelligenceRecommendationWorkspace />);
  fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '第一位账号的私有需求' } });
  fireEvent.click(screen.getByRole('button', { name: '开始推荐' }));
  await waitFor(() => expect(mocks.recommend).toHaveBeenCalledTimes(1));
  const signal: AbortSignal = mocks.recommend.mock.calls[0][2];

  mocks.session = session('operator', 'second');
  view.rerender(<IntelligenceRecommendationWorkspace />);
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole('textbox', { name: '客户需求' })).toHaveValue('');
  await act(async () => reject(new Error('旧账号的迟到结果')));
  expect(screen.queryByText('旧账号的迟到结果')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始推荐' })).toBeDisabled();
});
