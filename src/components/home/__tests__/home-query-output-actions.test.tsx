import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAggregateResult } from '@/src/lib/intelligence/query/result';
import { fixture } from '@/src/lib/intelligence/query/__tests__/fixtures';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { renderResultCopy } from '@/src/lib/intelligence/query/resultOutput';
const client = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock('@/src/services/trustedQueryClient', () => ({ trustedQueryClient: client }));
import { HomeQueryResultActions } from '../HomeQueryResultActions';
import { PitchHandoffProvider, readPitchHandoff } from '@/src/components/pitch/PitchHandoffLink';

const scope = { actorId: 'one', effectiveId: 'one', sessionId: 'session', targetId: null };
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const result = resultViewSchema.parse(buildAggregateResult(fixture(), 'rent'));
describe('P2 compact research result actions', () => {
  const clipboard = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } });
    clipboard.mockResolvedValue(undefined);
    client.copy.mockImplementation(async (_scope, input) => ({ text: renderResultCopy(result, input.format), resultId: result.resultId, format: input.format }));
  });
  afterEach(cleanup);
  const open = (internalExport = true) => render(<HomeQueryResultActions result={result} requestId={requestId} scope={scope} internalExport={internalExport} />);
  it('carries the result period into Pitch and omits unsupported multi-quarter comparisons', () => {
    const workspace = (value: typeof result) => <PitchHandoffProvider enabled>
      <HomeQueryResultActions result={value} requestId={requestId} scope={scope} internalExport />
    </PitchHandoffProvider>;
    const view = render(workspace(result));
    fireEvent.click(screen.getByText('更多操作'));
    const link = screen.getByRole('link', { name: '将分析结果加入 Pitch' });
    expect(readPitchHandoff(new URL(link.getAttribute('href')!, window.location.origin).hash)).toEqual({
      source: { kind: 'analysis-result', id: requestId }, period: '2026-Q3',
    });
    view.rerender(workspace({ ...result, operation: 'compare',
      parameters: { base: { year: 2026, quarter: 2 }, current: { year: 2026, quarter: 3 } } }));
    expect(screen.queryByRole('link', { name: '将分析结果加入 Pitch' })).not.toBeInTheDocument();
  });
  it('T08 copies only after backend approval, with period, unit and sample context', async () => {
    open(); fireEvent.click(screen.getByRole('button', { name: '复制结论' }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledOnce());
    expect(client.copy).toHaveBeenCalledWith(scope, { requestId, resultId: result.resultId, action: 'copy', format: 'conclusion' }, expect.any(AbortSignal));
    expect(clipboard.mock.calls[0][0]).toContain('2026Q3'); expect(clipboard.mock.calls[0][0]).toContain('170 元/㎡/月');
    expect(screen.getByRole('status')).toHaveTextContent('已复制');
  });
  it('T18 hides copy for missing export qualification and rejects backend denial without copying', async () => {
    const view = open(false); expect(screen.queryByRole('button', { name: '复制结论' })).not.toBeInTheDocument(); view.unmount();
    open(); client.copy.mockRejectedValue(new Error('无法访问此请求。'));
    fireEvent.click(screen.getByRole('button', { name: '复制结论' }));
    await screen.findByText('无法访问此请求。'); expect(clipboard).not.toHaveBeenCalled();
  });
  it('provides a truthful selectable fallback after browser clipboard failure', async () => {
    open(); clipboard.mockRejectedValue(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: '复制结论' }));
    const fallback = await screen.findByRole('textbox', { name: '可手动复制的分析内容' });
    expect(fallback).toHaveValue(renderResultCopy(result, 'conclusion'));
    expect(screen.getByRole('status')).toHaveTextContent('未完成自动复制');
    fireEvent.click(screen.getByRole('button', { name: '选择全部文字' })); expect(fallback).toHaveFocus();
    expect((fallback as HTMLTextAreaElement).selectionEnd).toBe((fallback as HTMLTextAreaElement).value.length);
  });
  it('T12 ignores a late copy response after switching account', async () => {
    let resolve!: (value: unknown) => void;
    client.copy.mockReturnValue(new Promise(done => { resolve = done; }));
    const view = open(); fireEvent.click(screen.getByRole('button', { name: '复制结论' }));
    view.rerender(<HomeQueryResultActions result={result} requestId={requestId} scope={{ ...scope, actorId: 'two', effectiveId: 'two' }} internalExport />);
    await act(async () => resolve({ text: renderResultCopy(result, 'conclusion'), resultId: result.resultId, format: 'conclusion' }));
    expect(clipboard).not.toHaveBeenCalled(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('generates a bounded summary only on request without querying or exporting', async () => {
    open(false); expect(screen.queryByRole('region', { name: '市场分析摘要' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('更多操作'));
    const button = screen.getByRole('button', { name: '生成分析摘要' }); fireEvent.click(button);
    const summary = screen.getByRole('region', { name: '市场分析摘要' });
    expect(summary).toHaveTextContent('170'); expect(summary).toHaveTextContent('统计口径与来源限制');
    expect(client.copy).not.toHaveBeenCalled(); expect(clipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '收起摘要' })); expect(screen.getByRole('button', { name: '更多操作' })).toHaveFocus();
  });
  it('rejects different-snapshot text even when the returned result ID was copied', async () => {
    open(); client.copy.mockResolvedValue({ text: '新的市场数据', resultId: result.resultId, format: 'conclusion' });
    fireEvent.click(screen.getByRole('button', { name: '复制结论' }));
    await screen.findByText(/复制内容与当前结果不一致/); expect(clipboard).not.toHaveBeenCalled();
  });
  it('closes the active action disclosure before Escape can leave the workspace', () => {
    const leaveWorkspace = vi.fn();
    render(<div onKeyDown={leaveWorkspace}><HomeQueryResultActions result={result} requestId={requestId} scope={scope} internalExport /></div>);
    const trigger = screen.getByText('更多操作');
    fireEvent.click(trigger);
    const action = screen.getByRole('button', { name: '复制关键数字' });
    action.focus();
    fireEvent.keyDown(action, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    expect(leaveWorkspace).not.toHaveBeenCalled();
    expect(client.copy).not.toHaveBeenCalled();
  });
  it('returns to the visible action disclosure if the original copy action was closed', async () => {
    open(); clipboard.mockRejectedValue(new Error('denied'));
    const more = screen.getByText('更多操作');
    fireEvent.click(more);
    const trigger = screen.getByRole('button', { name: '复制关键数字' });
    fireEvent.click(trigger);
    await screen.findByRole('textbox', { name: '可手动复制的分析内容' });
    fireEvent.keyDown(trigger, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '关闭复制内容' }));
    expect(more).toHaveFocus();
  });
});
