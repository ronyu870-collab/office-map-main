import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProposalDraft } from '@/src/lib/intelligence/proposalDraft';

const fixture = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
  read: vi.fn<(table: string, ids: string[]) => Promise<{ data: unknown[]; error: null }>>(),
  user: 'operator-one', token: 'token-one', role: 'admin',
}));
vi.mock('next/navigation', () => ({ useRouter: () => fixture.router }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ status: 'authenticated', session: {
  user: { id: fixture.user, email: 'proposal@example.test' }, session: { access_token: fixture.token }, role: fixture.role,
} }) }));
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: (table: string) => {
  let ids: string[] = [];
  const query = { select: () => query, eq: () => query, order: () => query, in: (_key: string, list: string[]) => { ids = list; return query; },
    abortSignal: () => query,
    then: <T,>(resolve: (result: Awaited<ReturnType<typeof fixture.read>>) => T) => fixture.read(table, ids).then(resolve),
  };
  return query;
} } }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
import { PROPOSAL_DRAFT_EVENT, PROPOSAL_DRAFT_STORAGE_KEY } from '@/src/lib/intelligence/proposalDraft';
import { ProposalWorkspace } from '../ProposalWorkspace';

const draft: ProposalDraft = { version: 1, clientName: '', requirementFingerprint: 'fixture', updatedAt: '2026-11-10T00:00:00Z',
  requirement: { parsed: { city: '北京', locations: [], area: { minSqm: null, maxSqm: null }, rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' },
    moveInMonth: null, grades: [], metro: { preferred: false, maxDistanceMeters: null }, greenCertifications: [], otherPreferences: [], unresolved: [] },
    capabilities: [], appliedCapabilities: [], evaluationCapabilities: [] },
  items: [{ buildingId: 'alpha', buildingName: '合成甲楼', addedAt: '2026-11-10' }, { buildingId: 'beta', buildingName: '合成乙楼', addedAt: '2026-11-10' }],
};
function setDraft(next = draft) {
  window.sessionStorage.setItem(PROPOSAL_DRAFT_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(PROPOSAL_DRAFT_EVENT));
}
const names = () => screen.getAllByRole('article').map(article => within(article).getByRole('heading').textContent);
beforeEach(() => {
  fixture.user = 'operator-one'; fixture.token = 'token-one'; fixture.role = 'admin';
  fixture.read.mockReset().mockImplementation(async (table, ids) => ({ data: table === 'buildings' ? ids.map(id => ({ id, grade: 'A', name: id === 'alpha' ? '合成甲楼' : '合成乙楼' })) : [], error: null }));
  window.sessionStorage.clear(); setDraft();
});
afterEach(cleanup);

it('keeps selected facts while renaming the client and reordering the same buildings', async () => {
  render(<ProposalWorkspace />);
  await screen.findByRole('heading', { name: '合成甲楼' });
  const input = screen.getByPlaceholderText('例如：XX科技有限公司');
  fireEvent.change(input, { target: { value: '合成客户' } });
  await act(async () => { fireEvent.blur(input); });
  expect(fixture.read).toHaveBeenCalledTimes(3);
  expect(input).toHaveValue('合成客户');
  await act(async () => { fireEvent.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: '下移' })); });
  expect(names()).toEqual(['合成乙楼', '合成甲楼']);
  expect(fixture.read).toHaveBeenCalledTimes(3);
});

it('re-reads a changed set and does not show older results after a credential change', async () => {
  const view = render(<ProposalWorkspace />);
  await screen.findByRole('heading', { name: '合成甲楼' });
  await act(async () => setDraft({ ...draft, items: draft.items.slice(0, 1) }));
  expect(names()).toEqual(['合成甲楼']);
  expect(fixture.read.mock.calls.slice(-3).every(([, ids]) => ids.length === 1 && ids[0] === 'alpha')).toBe(true);
  fixture.user = 'operator-two'; fixture.token = 'token-two';
  let finish!: (value: { data: unknown[]; error: null }) => void;
  fixture.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  view.rerender(<ProposalWorkspace />);
  expect(screen.queryByRole('heading', { name: '合成甲楼' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '打印 / 导出 PDF' })).toBeDisabled();
  await waitFor(() => expect(fixture.read).toHaveBeenCalledTimes(9));
  await act(async () => finish({ data: [{ id: 'alpha', name: '另一个会话的结果' }], error: null }));
  expect(await screen.findByRole('heading', { name: '另一个会话的结果' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '打印 / 导出 PDF' })).toBeEnabled();
});
