import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), recover: vi.fn(), chart: vi.fn(), download: vi.fn(), reportDelivery: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client,
  queryScopeKey: (scope: { actorId: string; effectiveId: string; sessionId: string; targetId: string | null }) => JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]),
}));
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'scope-limit', effectiveId: 'scope-limit', sessionId: 'synthetic-session', targetId: null };
const storageKey = `trusted-query:last:${JSON.stringify([scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId])}`;
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const error = '本次查询范围超过交互容量，请减少子市场、季度或指标后重新提问。';
const failed = { status: 'failed', reason: 'scope_limit', requestId: ids[1], error };
type Submission = { idempotencyKey: string; question: string; conversation: { id: string; parentRequestId?: string } };
async function open() {
  render(<HomeQuery scope={scope} />);
  const input = screen.getByRole('textbox');
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}
function send(input: HTMLElement, question: string) {
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
function expectTerminalLimit(input: HTMLElement) {
  expect(screen.getByRole('status')).toHaveTextContent(error);
  expect(screen.queryByRole('button', { name: '重试本次请求' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '检查状态并恢复结果' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '编辑问题' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '新对话' })).toBeEnabled();
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(input).toBeEnabled();
}

describe('homepage terminal query scope limits', () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetAllMocks();
    client.capabilities.mockResolvedValue({ enabled: true, permissionRevision: 'one', examples: [] });
    client.reportDelivery.mockResolvedValue(true);
  });
  afterEach(cleanup);

  it('does not retry or save an oversized request and preserves a draft typed while it was pending', async () => {
    let resolve!: (value: unknown) => void;
    client.submit.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const input = await open(); send(input, '全部获权楼宇最近四季度净有效租金和空置率');
    fireEvent.change(input, { target: { value: 'CBD 最近两个季度净有效租金' } });
    await act(async () => resolve(failed));
    expectTerminalLimit(input);
    expect(input).toHaveValue('CBD 最近两个季度净有效租金');
    expect(client.submit).toHaveBeenCalledOnce(); expect(client.recover).not.toHaveBeenCalled();
  });

  it('clears a previously stored oversized request after recovery reports its terminal scope limit', async () => {
    sessionStorage.setItem(storageKey, ids[1]); client.recover.mockResolvedValue(failed);
    const input = await open(); fireEvent.change(input, { target: { value: '保留待发送的问题' } });
    fireEvent.click(await screen.findByRole('button', { name: '检查状态并恢复结果' }));
    await screen.findByText(error);
    expectTerminalLimit(input); expect(input).toHaveValue('保留待发送的问题');
    expect(client.recover).toHaveBeenCalledOnce(); expect(client.submit).not.toHaveBeenCalled();
  });

  it('does not invent a scope reason when recovery can confirm only a terminal failed request', async () => {
    sessionStorage.setItem(storageKey, ids[1]); client.recover.mockResolvedValue({ status: 'failed', requestId: ids[1] });
    const input = await open(); fireEvent.change(input, { target: { value: '保留待发送的问题' } });
    fireEvent.click(await screen.findByRole('button', { name: '检查状态并恢复结果' }));
    await screen.findByText('本次请求未生成可恢复的结果，请修改问题后重新提交。');
    expect(screen.queryByRole('button', { name: '重试本次请求' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查状态并恢复结果' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('容量');
    expect(sessionStorage.getItem(storageKey)).toBeNull(); expect(input).toHaveValue('保留待发送的问题');
  });

  it('uses a new request key and the last confirmed parent when the user submits a smaller query', async () => {
    client.submit.mockImplementationOnce(async (_scope, input: Submission) => ({ status: 'ready', requestId: ids[0], conversation: input.conversation,
      result: buildAggregateResult(fixture(), 'rent') }))
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ status: 'clarification', message: '请确认缩小后的季度。' });
    const input = await open(); send(input, '2026Q3 CBD 净有效租金'); await screen.findByRole('region', { name: '查询结果' });
    send(input, '全部获权楼宇最近四季度净有效租金和空置率'); await screen.findByText(error);
    expectTerminalLimit(input);
    send(input, 'CBD 最近两个季度净有效租金'); await screen.findByText('请确认缩小后的季度。');
    const submitted = client.submit.mock.calls.map(call => call[1] as Submission);
    expect(submitted[2].idempotencyKey).not.toBe(submitted[1].idempotencyKey);
    expect(submitted[2].conversation).toEqual({ id: submitted[0].conversation.id, parentRequestId: ids[0] });
    expect(submitted[2].question).toBe('CBD 最近两个季度净有效租金');
  });
});
