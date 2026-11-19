import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { buildResultChart } from '@/src/lib/intelligence/query/charts';
import { resultSummary, resultViewSchema } from '@/src/lib/intelligence/query/presentation';

const client = vi.hoisted(() => ({ capabilities: vi.fn(), submit: vi.fn(), chart: vi.fn(), reportDelivery: vi.fn() }));
const modules = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve, started: vi.fn() };
  };
  return { markdown: deferred(), actions: deferred() };
});
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client, queryScopeKey: () => 'lazy-feedback-owner' }));
// Next's App Router aliases next/dynamic to this implementation in production.
// Use its actual React.lazy/Suspense behavior, rather than a synchronous stub or
// the Pages Router loader that Node resolves for next/dynamic by default.
vi.mock('next/dynamic', async () => ({ default: (await import('next/dist/shared/lib/app-dynamic')).default }));
vi.mock('../HomeQueryMarkdown', async importOriginal => {
  modules.markdown.started();
  await modules.markdown.promise;
  return importOriginal<typeof import('../HomeQueryMarkdown')>();
});
vi.mock('../HomeQueryAssistantActions', async importOriginal => {
  modules.actions.started();
  await modules.actions.promise;
  return importOriginal<typeof import('../HomeQueryAssistantActions')>();
});
import { HomeQuery } from '../HomeQuery';

const scope = { actorId: 'owner', effectiveId: 'owner', sessionId: 'session', targetId: null };
const requestIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function send(input: HTMLElement, question: string) {
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('lazy answer modules keep the shared conversation responsive', () => {
  it('commits usable send/stop controls before delayed Markdown and copy modules resolve, then renders both normally', async () => {
    sessionStorage.clear();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('reduced-motion'), media: query,
      onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
    client.capabilities.mockResolvedValue({ enabled: true, examples: [], permissionRevision: 'one', internalExport: true });
    client.reportDelivery.mockResolvedValue(true);
    client.chart.mockImplementation(async (_scope, _requestId, result, chart) => buildResultChart(result, chart));
    const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
    client.submit.mockImplementationOnce(async (_scope, body) => ({ requestId: requestIds[0], status: 'ready', result,
      conversation: body.conversation }));
    render(<React.Suspense fallback={<p data-testid="workspace-fallback">正在加载整个工作空间</p>}>
      <HomeQuery scope={scope} />
    </React.Suspense>);
    const input = screen.getByRole('textbox', { name: '向 Colliers AI 提问' });
    await waitFor(() => expect(input).toBeEnabled());
    send(input, '季度租金');
    await screen.findByRole('region', { name: '查询结果' });
    expect(modules.markdown.started).not.toHaveBeenCalled();

    const nextReply = deferred<unknown>();
    client.submit.mockReturnValueOnce(nextReply.promise);
    send(input, '共同有效样本呢');
    await waitFor(() => expect(modules.markdown.started).toHaveBeenCalledOnce());
    // The module promise is still unresolved. Feedback and cancellation must
    // already be committed; no wall-clock allowance can conceal a suspension.
    expect(screen.queryByTestId('workspace-fallback')).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: '停止等待' });
    expect(stop).toBeVisible(); expect(stop).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '向 Colliers AI 提问' })).toBe(input);
    expect(input).toBeEnabled();
    fireEvent.click(stop);
    expect((client.submit.mock.calls[1][2] as AbortSignal).aborted).toBe(true);
    expect(screen.getByText(/已停止等待/)).toBeVisible();
    await act(async () => { modules.markdown.resolve(); await vi.dynamicImportSettled(); });
    expect(await screen.findByText(resultSummary(result)[0])).toBeVisible();
    await act(async () => nextReply.resolve({ requestId: requestIds[1], status: 'ready', result }));

    client.submit.mockImplementationOnce(async (_scope, body) => ({ requestId: requestIds[2], status: 'assistant',
      message: '**文字研究回答**', conversation: body.conversation }));
    send(input, '解释研究口径');
    await waitFor(() => expect(modules.actions.started).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('workspace-fallback')).not.toBeInTheDocument();
    expect((await screen.findByText('文字研究回答')).tagName).toBe('STRONG');
    expect(screen.queryByRole('button', { name: '复制回答' })).not.toBeInTheDocument();
    const followUp = deferred<unknown>();
    client.submit.mockReturnValueOnce(followUp.promise);
    send(input, '继续说明');
    expect(screen.getByRole('button', { name: '停止等待' })).toBeVisible();
    expect(client.submit).toHaveBeenCalledTimes(4);
    expect(screen.queryByTestId('workspace-fallback')).not.toBeInTheDocument();
    await act(async () => { modules.actions.resolve(); await vi.dynamicImportSettled(); });
    expect(await screen.findByRole('button', { name: '复制回答' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '停止等待' }));
    expect((client.submit.mock.calls[3][2] as AbortSignal).aborted).toBe(true);
    await act(async () => followUp.resolve({ status: 'assistant', message: '迟到的回答' }));
    expect(screen.queryByText('迟到的回答')).not.toBeInTheDocument();
  });
});
