import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AiAuditSearch, AiAuditWorkspace } from './AiAuditWorkspace';
import { AuditReadError } from '@/src/services/aiAuditClient';
import type { AuditList } from '@/src/lib/intelligence/query/auditConsoleView';

const fixture = vi.hoisted(() => ({ list: vi.fn(), intake: vi.fn(), stream: vi.fn(), exportRecords: vi.fn(), reportExport: vi.fn(), session: null as unknown,
  status: 'authenticated', impersonating: false, target: null as string | null }));
vi.mock('@/src/services/aiAuditClient', async importOriginal => ({ ...await importOriginal<typeof import('@/src/services/aiAuditClient')>(),
  aiAuditClient: { list: fixture.list, intake: fixture.intake, stream: fixture.stream, exportRecords: fixture.exportRecords, reportExport: fixture.reportExport } }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => ({ session: fixture.session, status: fixture.status }) }));
vi.mock('@/src/contexts/ImpersonationContext', () => ({ useImpersonation: () => ({ isImpersonating: fixture.impersonating, targetUserId: fixture.target }) }));
const actorId = '11111111-1111-4111-8111-111111111111', sessionId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444';
const scope = { actorId, sessionId };
const item = { id, requestId, kind: 'intake' as const, at: '2026-11-13T00:00:00Z', actorId, effectiveUserId: actorId,
  actorName: '张明 / Ming Zhang', actorNameTruncated: false, effectiveUserName: '张明 / Ming Zhang', effectiveUserNameTruncated: false,
  entry: 'query_submission' as const, relatedExecutionState: 'succeeded' as const, contentState: 'available' as const, excerpt: 'CBD最高的楼', truncated: false };
const page = (change: Partial<AuditList> = {}): AuditList => ({ status: 'ready', accessId: id, items: [item], scanned: 1,
  directoryAsOf: '2026-11-13T01:00:00Z', identitySemantics: 'current_directory_not_historical', unreadable: 0, nextCursor: null, searchComplete: true, totalUnreadable: 0, totalMatches: null, semantics: 'attempts_and_legacy_streams', ...change });
const clickSearch = () => fireEvent.click(screen.getByRole('button', { name: /检索记录|重新检索/ }));
beforeEach(() => {
  fixture.exportRecords.mockReset(); fixture.reportExport.mockReset().mockResolvedValue(undefined);
  fixture.list.mockReset().mockResolvedValue(page()); fixture.intake.mockReset(); fixture.stream.mockReset();
  fixture.session = { role: 'admin', session: { user: { id: actorId } }, user: { id: actorId }, sessionId };
  fixture.status = 'authenticated'; fixture.impersonating = false; fixture.target = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

test('keeps personnel search focus, caret and IME while results change and binds pagination to applied names', async () => {
  const user = userEvent.setup(); let resolve!: (value: AuditList) => void;
  fixture.list.mockImplementationOnce(() => new Promise<AuditList>(done => { resolve = done; }));
  render(<AiAuditSearch scope={scope} />);
  await user.click(screen.getByText('按人员筛选'));
  const input = screen.getByLabelText('人员姓名') as HTMLInputElement;
  await user.click(input); await user.type(input, 'Zhang'); await user.keyboard('{Enter}');
  expect(fixture.list.mock.calls[0][1].actorSearch).toBe('Zhang');
  expect(input).toHaveFocus(); input.setSelectionRange(1, 3); await user.keyboard('H');
  expect(input.value).toBe('ZHng'); expect(input.selectionStart).toBe(2);
  await act(async () => resolve(page({ items: [], scanned: 50, nextCursor: 'person-cursor', searchComplete: false })));
  expect(input).toHaveFocus(); expect(input.selectionStart).toBe(2);
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '张明' } });
  fireEvent.submit(input.closest('form')!); expect(fixture.list).toHaveBeenCalledTimes(1);
  fireEvent.compositionEnd(input);
  fireEvent.click(screen.getByRole('button', { name: '继续检查下一批' }));
  await screen.findByText('CBD最高的楼');
  expect(fixture.list.mock.calls[1][1].actorSearch).toBe('Zhang'); expect(input.value).toBe('张明');
  await user.click(input); await user.keyboard('{Enter}');
  expect(fixture.list.mock.calls[2][1].actorSearch).toBe('张明');
  fixture.list.mockRejectedValueOnce(new AuditReadError('unavailable'));
  await user.keyboard('{Enter}'); await screen.findByText(/服务暂时不可用/);
  expect(input).toHaveFocus(); await user.clear(input); await user.type(input, '李'); expect(input.value).toBe('李');
});

test('keeps names as text, distinguishes duplicate accounts and narrows by immutable ID rather than name', async () => {
  const secondId = '55555555-5555-4555-8555-555555555555';
  const name = '<img src=x onerror=alert(1)> / 同名';
  fixture.list.mockResolvedValue(page({ items: [{ ...item, actorName: name }, { ...item, id: secondId, actorId: secondId, actorName: name }], scanned: 2 }));
  render(<AiAuditSearch scope={scope} />); clickSearch(); await screen.findAllByText(/同名/);
  expect(document.querySelector('img')).toBeNull(); expect(screen.getByText(/不是历史身份快照/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `仅看此账号 ${secondId}` }));
  await waitFor(() => expect(fixture.list).toHaveBeenCalledTimes(2));
  expect(fixture.list.mock.calls[1][1]).toMatchObject({ actorId: secondId, actorSearch: undefined, cursor: undefined });
  expect(screen.getByLabelText('操作账号 UUID')).toHaveValue(secondId);
});

test('does not invent names for unresolved identities and discloses shortened directory labels', async () => {
  fixture.list.mockResolvedValue(page({ items: [{ ...item, actorName: null }, { ...item, id: sessionId, actorName: '长姓名', actorNameTruncated: true }], scanned: 2 }));
  render(<AiAuditSearch scope={scope} />); clickSearch();
  expect(await screen.findByText(/姓名未知或目录未匹配/)).toBeInTheDocument();
  expect(screen.getByText(/长姓名…（名称已缩短）/)).toBeInTheDocument();
});

test('exports only currently matched page records and separately reports browser dispatch', async () => {
  const file={blob:new Blob(['{}']),filename:'ai-audit-test.json',receiptToken:'synthetic'};
  fixture.exportRecords.mockResolvedValue(file);
  const create=vi.fn(()=> 'blob:synthetic'),revoke=vi.fn();
  vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<AiAuditSearch scope={scope} />);clickSearch();await screen.findByText('CBD最高的楼');
  fireEvent.click(screen.getByText('导出审计记录'));fireEvent.click(screen.getByRole('button',{name:'导出本页 1 条（JSON）'}));
  expect(await screen.findByText(/浏览器已发起审计文件下载/)).toBeInTheDocument();
  expect(fixture.exportRecords).toHaveBeenCalledWith(scope,[{kind:'intake',id}],expect.any(AbortSignal));
  expect(click).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledWith(file.blob);
  expect(fixture.reportExport).toHaveBeenCalledWith(scope,file,expect.any(AbortSignal));
});

test('does not dispatch denied or stale exports and explains an unconfirmed client report accurately', async () => {
  const file={blob:new Blob(['{}']),filename:'ai-audit-test.json',receiptToken:'synthetic'};
  const create=vi.fn(()=> 'blob:synthetic');vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=vi.fn();});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<AiAuditSearch scope={scope} />);clickSearch();await screen.findByText('CBD最高的楼');
  fixture.exportRecords.mockRejectedValueOnce(new AuditReadError('export_denied'));
  fireEvent.click(screen.getByRole('button',{name:'导出本页 1 条（JSON）'}));await screen.findByText(/没有可用的独立审计导出资格/);expect(click).not.toHaveBeenCalled();
  clickSearch();await screen.findByText('CBD最高的楼');
  fixture.exportRecords.mockResolvedValueOnce(file);fixture.reportExport.mockRejectedValueOnce(new AuditReadError('unavailable'));
  fireEvent.click(screen.getByRole('button',{name:'导出本页 1 条（JSON）'}));await screen.findByText(/客户端报告未确认/);expect(click).toHaveBeenCalledTimes(1);
  let resolve!:(value:typeof file)=>void;fixture.exportRecords.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  fireEvent.click(screen.getByRole('button',{name:'导出本页 1 条（JSON）'}));
  fireEvent(window,new Event('pagehide'));await act(async()=>resolve(file));expect(click).toHaveBeenCalledTimes(1);
});
