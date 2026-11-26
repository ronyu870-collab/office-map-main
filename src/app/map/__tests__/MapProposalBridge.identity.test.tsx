import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthSessionResult } from '@/src/services/Auth';
import type { RequirementParseResult } from '@/src/lib/intelligence/requirementSchema';
import { beginProposalDraft, getProposalDraftScope, readProposalDraft, removeProposalCandidate } from '@/src/lib/intelligence/proposalDraft';
import { MapProposalBridge } from '../MapProposalBridge';
import { WorkspaceBuildingDetail } from '../components/WorkspaceBuildingDetail';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';

const auth = vi.hoisted(() => ({ status: 'authenticated', session: null as AuthSessionResult | null }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => auth }));
const requirement: RequirementParseResult = {
  parsed: { city: '北京', locations: [], area: { minSqm: null, maxSqm: null }, rent: { minDailyRmbSqm: null, maxDailyRmbSqm: null, basis: 'unspecified' }, moveInMonth: null, grades: [], metro: { preferred: false, maxDistanceMeters: null }, greenCertifications: [], otherPreferences: [], unresolved: [] },
  capabilities: [], meta: { model: 'isolated', durationMs: 0, inputTokens: null, outputTokens: null },
};
const callbacks = { onClose: vi.fn(), onAction: vi.fn(), onDisposeTrend: vi.fn() };
function ui(id = 'stock-a', enabled = true) {
  const detail: Detail = { building: { id, name: `项目${id}`, _dataType: 'existing', location_lng: null, location_lat: null, metrics: [] }, metric: null, photos: [], canEdit: true, isDemo: false, overrides: {} };
  return <><WorkspaceBuildingDetail key={id} detail={detail} {...callbacks} /><MapProposalBridge enabled={enabled} /></>;
}
function scope() { return getProposalDraftScope(auth.session)!; }
beforeEach(() => {
  sessionStorage.clear();
  const user = { id: 'operator', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-24T00:00:00Z' };
  auth.status = 'authenticated';
  auth.session = { user, role: 'admin', displayName: '隔离管理员', sessionId: 'session-one', session: { user, access_token: 'isolated-token', refresh_token: 'isolated-refresh', expires_in: 3600, token_type: 'bearer' } };
});
afterEach(() => vi.restoreAllMocks());

it('adds the current actual detail identity, survives a parent render and ignores an intermediate project', async () => {
  beginProposalDraft(scope(), requirement, []);
  const view = render(ui());
  fireEvent.click(screen.getByRole('button', { name: '加入客户方案' }));
  expect(readProposalDraft(scope())?.items.map(item => item.buildingId)).toEqual(['stock-a']);
  view.rerender(ui());
  expect(screen.getByRole('button', { name: '已加入客户方案' })).toBeDisabled();
  view.rerender(ui('stock-b')); view.rerender(ui('stock-c'));
  fireEvent.click(await screen.findByRole('button', { name: '加入客户方案' }));
  expect(readProposalDraft(scope())?.items.map(item => [item.buildingId, item.buildingName])).toEqual([['stock-a', '项目stock-a'], ['stock-c', '项目stock-c']]);
  expect(document.querySelectorAll('[data-map-proposal-slot] button')).toHaveLength(1);
});

it.each(['effectiveUser', 'realUser', 'role', 'session', 'status', 'logout'])('removes stale proposal actions immediately when %s changes', async field => {
  beginProposalDraft(scope(), requirement, []);
  const view = render(ui());
  const old = screen.getByRole('button', { name: '加入客户方案' });
  const priorScope = scope();
  const next = auth.session!;
  if (field === 'effectiveUser') auth.session = { ...next, user: { ...next.user, id: 'another-effective-user' } };
  if (field === 'realUser') auth.session = { ...next, session: { ...next.session, user: { ...next.session.user, id: 'another-operator' } } };
  if (field === 'role') auth.session = { ...next, role: 'viewer' };
  if (field === 'session') auth.session = { ...next, sessionId: 'session-two' };
  if (field === 'status') auth.status = 'loading';
  if (field === 'logout') { auth.status = 'unauthenticated'; auth.session = null; }
  view.rerender(ui());
  expect(screen.queryByRole('button', { name: '加入客户方案' })).not.toBeInTheDocument();
  expect(old.isConnected).toBe(false);
  old.click();
  if (field === 'role' || field === 'status' || field === 'logout') expect(readProposalDraft(priorScope)?.items).toEqual([]);
  else expect(readProposalDraft(scope())).toBeNull();
  await act(async () => {});
  expect(document.querySelector('[data-map-proposal-slot]')).toHaveAttribute('hidden');
});

it('reacts to a new owned draft and the five-project limit through real storage events', async () => {
  render(ui());
  expect(screen.queryByRole('button', { name: '加入客户方案' })).not.toBeInTheDocument();
  act(() => { beginProposalDraft(scope(), requirement, [], { candidates: Array.from({ length: 5 }, (_, index) => ({ buildingId: `other-${index}`, buildingName: `其他${index}` })) }); });
  expect(screen.getByRole('button', { name: '方案已满 5/5' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '方案已满 5/5' }));
  expect(readProposalDraft(scope())?.items).toHaveLength(5);
  act(() => { removeProposalCandidate(scope(), 'other-0'); });
  fireEvent.click(screen.getByRole('button', { name: '加入客户方案' }));
  expect(readProposalDraft(scope())?.items.at(-1)?.buildingId).toBe('stock-a');
  expect(screen.getByRole('button', { name: '已加入客户方案' })).toBeDisabled();
});

it('cleans observers and event actions on disable/unmount without reviving from later DOM or draft events', async () => {
  beginProposalDraft(scope(), requirement, []);
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const view = render(ui());
  for (let index = 0; index < 12; index++) view.rerender(ui());
  const clicks = add.mock.calls.filter(([event, , capture]) => event === 'click' && capture === true);
  expect(clicks).toHaveLength(1);
  expect(observe.mock.calls.filter(([target]) => target === document.body)).toHaveLength(1);
  expect(document.querySelectorAll('[data-map-proposal-slot] button')).toHaveLength(1);
  view.rerender(ui('stock-a', false));
  expect(remove).toHaveBeenCalledWith('click', clicks[0][1], true);
  expect(disconnect).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-map-proposal-slot]')).toHaveAttribute('hidden');
  act(() => { beginProposalDraft(scope(), requirement, []); });
  expect(screen.queryByRole('button', { name: '加入客户方案' })).not.toBeInTheDocument();
  view.unmount();
  const popup = document.createElement('section');
  popup.className = 'building-popup'; popup.dataset.buildingId = 'late'; popup.innerHTML = '<div data-map-proposal-slot hidden></div>';
  try {
    document.body.append(popup);
    act(() => { beginProposalDraft(scope(), requirement, []); });
    await act(async () => { await Promise.resolve(); });
    expect(popup.querySelector('button')).toBeNull();
    expect(readProposalDraft(scope())?.items).toEqual([]);
  } finally { popup.remove(); }
});
