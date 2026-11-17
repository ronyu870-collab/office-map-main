import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: (s: { actorId: string }) => s.actorId }));
import { HomeQuery } from '../HomeQuery';
const scope = { actorId: 'experience-user', effectiveId: 'experience-user', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const access = { enabled: true, permissionRevision: 'one', examples: ['查询CBD楼宇', 'CBD最新季度净有效租金', '金融街空置率', 'CBD最近四季度租金趋势', '第五个获权示例'] };
function page(displayName?: string, actorId = scope.actorId) {
  return <><label htmlFor="home-query">Colliers AI</label><HomeQuery scope={{ ...scope, actorId, effectiveId: actorId }} displayName={displayName} /></>;
}
async function open(displayName?: string) {
  const view = render(page(displayName));
  const input = screen.getByRole('textbox');
  await waitFor(() => expect(input).toBeEnabled());
  return { ...view, input };
}
function send(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
beforeEach(() => { sessionStorage.clear(); vi.resetAllMocks(); client.capabilities.mockResolvedValue(access); client.reportDelivery.mockResolvedValue(true); });
afterEach(cleanup);
describe('experience 2.0 P0', () => {
  it('greets the verified name, keeps three authorized starters and explains identity on demand without submitting', async () => {
    const { input } = await open('Ron');
    expect(screen.getByRole('heading', { name: '你好，Ron。' })).toBeVisible();
    expect(screen.getByText('今天想研究什么？')).toBeVisible();
    expect(screen.getByText(/我是 Colliers AI，高力国际北京办公楼市场的智能研究助手/)).not.toBeVisible();
    expect(within(screen.getByRole('region', { name: '示例问题' })).getAllByRole('button')).toHaveLength(3);
    expect(client.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '市场租金趋势：CBD最近四季度租金趋势' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '第五个获权示例' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '市场租金趋势：CBD最近四季度租金趋势' }));
    expect(input).toHaveValue('CBD最近四季度租金趋势');
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByText('能力与范围'));
    expect(screen.getByText(/我是 Colliers AI，高力国际北京办公楼市场的智能研究助手/)).toBeVisible();
    expect(await screen.findByRole('button', { name: '第五个获权示例' })).toBeVisible();
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('CBD最近四季度租金趋势');
    expect(client.submit).not.toHaveBeenCalled();
  });
  it('does not advertise or invent an example outside the server-authorized list', async () => {
    client.capabilities.mockResolvedValue({ ...access, examples: ['金融街空置率', '金融街空置率'] });
    const { input } = await open('Ron');
    const starters = within(screen.getByRole('region', { name: '示例问题' }));
    expect(starters.getAllByRole('button')).toHaveLength(1);
    expect(starters.queryByText('市场租金趋势')).not.toBeInTheDocument();
    fireEvent.click(starters.getByRole('button', { name: '金融街空置率' }));
    expect(input).toHaveValue('金融街空置率');
    expect(client.submit).not.toHaveBeenCalled();
  });
  it.each(['person@example.com', '00000000-0000-4000-8000-000000000000', '   ', 'Ron\u202Eevil'])('does not turn an unsafe account identifier into a greeting: %s', async value => {
    await open(value);
    expect(screen.getByRole('heading', { name: '你好。' })).toBeVisible();
    expect(screen.queryByText(value)).not.toBeInTheDocument();
  });
  it('keeps a full Chinese name rather than guessing a first name', async () => {
    await open('欧阳明'); expect(screen.getByRole('heading', { name: '你好，欧阳明。' })).toBeVisible();
  });
  it('renders an audited introduction as a normal answer, never a conditions error', async () => {
    client.submit.mockImplementation(async (_scope, body) => ({ requestId, status: 'clarification', reason: 'assistant_help', message: '你好，我是 Colliers AI。', conversation: body.conversation, options: [] }));
    const { input } = await open('Ron'); send(input, '你好');
    expect(await screen.findByText('你好，我是 Colliers AI。')).toBeVisible();
    expect(client.submit).toHaveBeenCalledOnce();
    expect(screen.getByText('助手介绍')).toBeVisible();
    expect(screen.queryByText('需要补充条件')).not.toBeInTheDocument();
    expect(screen.queryByText('请选择查询口径')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试本次请求' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新查询' })).not.toBeInTheDocument();
  });
  it('keeps short earlier replies readable without opening a disclosure', async () => {
    client.submit.mockImplementation(async (_scope, body) => ({ requestId, status: 'clarification', reason: 'assistant_help', message: `助手回应：${body.question}`, conversation: body.conversation, options: [] }));
    const { input } = await open('Ron'); send(input, '你好');
    await screen.findByText('助手回应：你好'); send(input, '你能做什么');
    await screen.findByText('助手回应：你能做什么');
    const previous = screen.getByRole('article', { name: '此前问答' });
    expect(within(previous).getByText('助手回应：你好')).toBeVisible();
  });
  it('preserves the live composer node, IME protection and next draft through a reply', async () => {
    let finish!: (reply: unknown) => void;
    client.submit.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { input } = await open('Ron'); input.focus();
    fireEvent.change(input, { target: { value: '你好' } });
    fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(client.submit).not.toHaveBeenCalled(); fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '下一条尚未发送的问题' } });
    await act(async () => finish({ requestId, status: 'clarification', reason: 'assistant_help', message: '你好，我是 Colliers AI。' }));
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue('下一条尚未发送的问题');
    expect(input).toHaveFocus();
  });
  it('clears the submitted draft once, preventing a second Enter from resending it', async () => {
    client.submit.mockResolvedValue({ status: 'clarification', reason: 'assistant_help', message: '收到问候' });
    const { input } = await open('Ron'); send(input, '你好');
    await screen.findByText('收到问候'); expect(input).toHaveValue('');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(client.submit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '编辑问题' })); expect(input).toHaveValue('你好');
  });
  it('keeps the saved opaque request recovery available before any current turn', async () => {
    sessionStorage.setItem('trusted-query:last:' + scope.actorId, requestId);
    client.recover.mockResolvedValue({ requestId, status: 'unavailable' });
    await open('Ron');
    fireEvent.click(await screen.findByRole('button', { name: '检查状态并恢复结果' }));
    await waitFor(() => expect(client.recover).toHaveBeenCalledOnce());
    expect(client.recover.mock.calls[0][1]).toBe(requestId);
  });
  it('clears the old greeting and transcript on identity change', async () => {
    client.submit.mockResolvedValue({ status: 'clarification', reason: 'assistant_help', message: '上一账号的回答' });
    const { input, rerender } = await open('Ron'); send(input, '你好'); await screen.findByText('上一账号的回答');
    rerender(page('另一位用户', 'other-user'));
    expect(await screen.findByRole('heading', { name: '你好，另一位用户。' })).toBeVisible();
    expect(screen.queryByText('上一账号的回答')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('does not advertise an enabled assistant before a capability check succeeds', async () => {
    client.capabilities.mockResolvedValue({ enabled: false, examples: [] });
    render(page('Ron'));
    await waitFor(() => expect(client.capabilities).toHaveBeenCalled());
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByRole('heading', { name: '你好，Ron。' })).not.toBeInTheDocument();
  });
});
