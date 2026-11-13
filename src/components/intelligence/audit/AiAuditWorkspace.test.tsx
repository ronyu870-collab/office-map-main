import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AiAuditSearch, AiAuditWorkspace } from './AiAuditWorkspace';
import { AuditReadError } from '@/src/services/aiAuditClient';
import type { AuditList } from '@/src/lib/intelligence/query/auditConsoleView';

const fixture = vi.hoisted(() => ({ list: vi.fn(), intake: vi.fn(), stream: vi.fn(), session: null as unknown,
  status: 'authenticated', impersonating: false, target: null as string | null }));
vi.mock('@/src/services/aiAuditClient', async importOriginal => ({ ...await importOriginal<typeof import('@/src/services/aiAuditClient')>(),
  aiAuditClient: { list: fixture.list, intake: fixture.intake, stream: fixture.stream } }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ session: fixture.session, status: fixture.status }) }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: fixture.impersonating, targetUserId: fixture.target }) }));
const actorId = '11111111-1111-4111-8111-111111111111', sessionId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444';
const scope = { actorId, sessionId };
const item = { id, requestId, kind: 'intake' as const, at: '2026-11-13T00:00:00Z', actorId, effectiveUserId: actorId,
  entry: 'query_submission' as const, relatedExecutionState: 'succeeded' as const, contentState: 'available' as const, excerpt: 'CBD最高的楼', truncated: false };
const page = (change: Partial<AuditList> = {}): AuditList => ({ status: 'ready', accessId: id, items: [item], scanned: 1,
  unreadable: 0, nextCursor: null, searchComplete: true, totalUnreadable: 0, totalMatches: null, semantics: 'attempts_and_legacy_streams', ...change });
const clickSearch = () => fireEvent.click(screen.getByRole('button', { name: /检索记录|重新检索/ }));
beforeEach(() => {
  fixture.list.mockReset().mockResolvedValue(page()); fixture.intake.mockReset(); fixture.stream.mockReset();
  fixture.session = { role: 'admin', session: { user: { id: actorId } }, user: { id: actorId }, sessionId };
  fixture.status = 'authenticated'; fixture.impersonating = false; fixture.target = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { vi.useRealTimers(); });

test('includes submissions from the current minute in the initial time window', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T12:11:30Z'));
  render(<AiAuditSearch scope={scope} />);
  const end = (screen.getByLabelText('结束时间（北京时间）') as HTMLInputElement).value;
  const timestamp = `${end.length === 16 ? end + ':00' : end}+08:00`;
  expect(Date.parse(timestamp)).toBeGreaterThan(Date.parse('2026-11-13T12:11:29Z'));
  expect(Date.parse(timestamp)).toBeLessThanOrEqual(Date.now());
});

test('preserves input focus, caret and IME across pending, empty and final results', async () => {
  const user = userEvent.setup(); let resolve!: (value: AuditList) => void;
  fixture.list.mockImplementationOnce(() => new Promise<AuditList>(done => { resolve = done; }));
  render(<AiAuditSearch scope={scope} />);
  const input = screen.getByRole('searchbox', { name: '提问关键词' }) as HTMLInputElement;
  await user.click(input); await user.type(input, 'C'); await user.keyboard('{Enter}');
  expect(fixture.list).toHaveBeenCalledTimes(1);
  expect(input).toHaveFocus(); await user.type(input, 'BD');
  input.setSelectionRange(1, 2); await user.keyboard('b');
  expect(input.value).toBe('CbD'); expect(input.selectionStart).toBe(2);
  await act(async () => { resolve(page({ items: [], scanned: 0 })); });
  expect(input).toHaveFocus(); expect(input.selectionStart).toBe(2);
  await user.keyboard('{End}');
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: 'CBD最高' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.submit(input.closest('form')!); expect(fixture.list).toHaveBeenCalledTimes(1);
  fireEvent.compositionEnd(input, { data: '高' });
  fireEvent.input(input, { target: { value: 'CBD最高的楼' } }); fireEvent.submit(input.closest('form')!);
  expect(await screen.findByText('CBD最高的楼')).toBeInTheDocument();
  expect(fixture.list.mock.calls[1][1].keyword).toBe('CBD最高的楼'); expect(input).toHaveFocus();
  await user.clear(input); await user.type(input, 'x'); expect(input).toHaveFocus(); expect(input.value).toBe('x');
});

test('continues an empty candidate batch using the applied filters, not a changed draft', async () => {
  fixture.list.mockResolvedValueOnce(page({ items: [], nextCursor: 'signed-cursor', searchComplete: false, scanned: 50 }));
  render(<AiAuditSearch scope={scope} />); clickSearch();
  expect(await screen.findByText(/本批候选未匹配/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '尚未提交' } });
  fireEvent.click(screen.getByRole('button', { name: '继续检查下一批' }));
  await screen.findByText('CBD最高的楼');
  expect(fixture.list.mock.calls[1][1]).toEqual({ ...fixture.list.mock.calls[0][1], cursor: 'signed-cursor' });
  expect(screen.getByRole('searchbox')).toHaveValue('尚未提交');
  fireEvent.click(screen.getByRole('button', { name: '返回首批' }));
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(3));
  expect(fixture.list.mock.calls[2][1].cursor).toBeUndefined();
});

test('keeps submitted text inert, distinguishes attempt and answer, and returns focus on close', async () => {
  const question = '<img src=x onerror=alert(1)> 请查CBD';
  fixture.intake.mockResolvedValue({ status: 'ready', accessId: id, record: { ...item, document: { content: { payload: { rawRequest: JSON.stringify({ question }) } }, redactionTypes: ['credential'] } } });
  fixture.stream.mockResolvedValue({ status: 'ready', accessId: id, record: null });
  const { container } = render(<AiAuditSearch scope={scope} />); clickSearch();
  const row = await screen.findByRole('button', { name: /CBD最高的楼/ }); fireEvent.click(row);
  expect(await screen.findByText(question)).toBeInTheDocument(); expect(container.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看关联回答与来源' }));
  expect(await screen.findByText(/没有可读取的关联执行记录/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '收起详情' })); expect(row).toHaveFocus(); expect(screen.queryByText(question)).not.toBeInTheDocument();
});

test('clears every visible record after a denied detail read and does not claim a service failure', async () => {
  fixture.intake.mockRejectedValue(new AuditReadError('denied'));
  render(<AiAuditSearch scope={scope} />); clickSearch();
  fireEvent.click(await screen.findByRole('button', { name: /CBD最高的楼/ }));
  expect(await screen.findByText(/当前账号没有可用的审计资格/)).toBeInTheDocument();
  expect(screen.queryByText('CBD最高的楼')).not.toBeInTheDocument();
});

test('discards late results after page hiding and expires a visible page without background reads', async () => {
  let resolve!: (value: AuditList) => void;
  fixture.list.mockImplementationOnce(() => new Promise<AuditList>(done => { resolve = done; }));
  render(<AiAuditSearch scope={scope} />); clickSearch();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
  expect(fixture.list.mock.calls[0][2].aborted).toBe(true);
  await act(async () => { resolve(page()); }); expect(screen.queryByText('CBD最高的楼')).not.toBeInTheDocument();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  vi.useFakeTimers(); clickSearch(); await act(async () => {});
  expect(screen.getByText('CBD最高的楼')).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(60001); });
  expect(screen.queryByText('CBD最高的楼')).not.toBeInTheDocument(); expect(fixture.list).toHaveBeenCalledTimes(2);
});

test('unmounts sensitive state on account, session, logout and simulation changes', async () => {
  const view = render(<AiAuditWorkspace />); clickSearch(); await screen.findByText('CBD最高的楼');
  fixture.session = { role: 'admin', session: { user: { id: requestId } }, user: { id: requestId }, sessionId };
  view.rerender(<AiAuditWorkspace />); expect(screen.queryByText('CBD最高的楼')).not.toBeInTheDocument();
  clickSearch(); await screen.findByText('CBD最高的楼');
  fixture.session = { role: 'admin', session: { user: { id: requestId } }, user: { id: requestId }, sessionId: id };
  view.rerender(<AiAuditWorkspace />); expect(screen.queryByText('CBD最高的楼')).not.toBeInTheDocument();
  fixture.impersonating = true; fixture.target = actorId; view.rerender(<AiAuditWorkspace />);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(); expect(screen.getByText(/模拟身份下不能查看/)).toBeInTheDocument();
  fixture.impersonating = false; fixture.target = null; fixture.status = 'unauthenticated'; fixture.session = null;
  view.rerender(<AiAuditWorkspace />); expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
});

test('hides audit controls and discards visible content immediately after admin demotion', async () => {
  const view = render(<AiAuditWorkspace />); clickSearch(); await screen.findByText('CBD最高的楼');
  for (const role of ['viewer', 'editor']) {
    fixture.session = { role, session: { user: { id: actorId } }, user: { id: actorId }, sessionId };
    view.rerender(<AiAuditWorkspace />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(); expect(screen.queryByText('CBD最高的楼')).not.toBeInTheDocument();
    expect(screen.getByText(/AI 功能仅供 admin 使用/)).toBeInTheDocument();
  }
});

test('rejects invalid ranges locally and states incomplete keyword coverage accurately', async () => {
  fixture.list.mockResolvedValue(page({ items: [], unreadable: 2, totalUnreadable: 4, searchComplete: false }));
  render(<AiAuditSearch scope={scope} />);
  fireEvent.change(screen.getByLabelText('开始时间（北京时间）'), { target: { value: '2026-01-01T00:00' } }); clickSearch();
  expect(fixture.list).not.toHaveBeenCalled(); expect(screen.getByText(/时间跨度最多 31 天/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('结束时间（北京时间）'), { target: { value: '2026-01-02T00:00' } }); clickSearch();
  expect(await screen.findByText(/累计 4 条候选正文/)).toBeInTheDocument(); expect(screen.getByText(/不能确认完全没有匹配/)).toBeInTheDocument();
});
