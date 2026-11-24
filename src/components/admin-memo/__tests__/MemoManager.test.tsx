import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoManager } from '../MemoManager';

const api = vi.hoisted(() => ({ getMemo: vi.fn(), updateMemoContent: vi.fn(), saveMemoWithVersion: vi.fn(), createNew: vi.fn(), refresh: vi.fn() }));
vi.mock('@/src/services/memoApi', () => api);
vi.mock('@/src/hooks/useMemos', () => ({ useMemos: () => ({ memos: [], loading: false, tags: [], refresh: api.refresh, createNew: api.createNew, remove: vi.fn(), togglePin: vi.fn() }) }));
vi.mock('../MemoList', () => ({ MemoList: ({ onSelect, onCreate }: { onSelect: (id: string) => void; onCreate: () => void }) => <div><button onClick={() => onSelect('a')}>打开甲</button><button onClick={() => onSelect('b')}>打开乙</button><button onClick={onCreate}>新建</button></div> }));
vi.mock('../MarkdownEditor', () => ({ MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="备忘录正文" value={value} onChange={event => onChange(event.target.value)} /> }));
vi.mock('../MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock('../ImageUploadButton', () => ({ ImageUploadButton: () => null }));
vi.mock('../TagInput', () => ({ TagInput: ({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) => <input aria-label="标签" value={tags.join(',')} onChange={event => onChange(event.target.value.split(','))} /> }));
vi.mock('../VersionHistory', () => ({ VersionHistory: () => <div>历史记录</div> }));
vi.mock('../Toast', () => ({ ToastContainer: () => null, showToast: vi.fn() }));

async function openEditor() {
  render(<MemoManager adminEmail="admin@example.test" />);
  await act(async () => {
    fireEvent.click(screen.getByText('打开甲'));
    await vi.dynamicImportSettled();
  });
  fireEvent.click(screen.getByText('编辑'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.getMemo.mockImplementation(async (id: string) => ({ id, title: id === 'a' ? '甲标题' : '乙标题', content: id === 'a' ? '甲正文' : '乙正文', tags: [] }));
  api.updateMemoContent.mockResolvedValue({});
  api.saveMemoWithVersion.mockResolvedValue({});
  api.createNew.mockResolvedValue('new');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('memo navigation and save feedback', () => {
  it('keeps an unavailable memo distinct from a failed request and can open another memo', async () => {
    api.getMemo.mockResolvedValueOnce(null);
    render(<MemoManager adminEmail="admin@example.test" />);
    await act(async () => {
      fireEvent.click(screen.getByText('打开甲'));
      await vi.dynamicImportSettled();
    });
    expect(screen.getByText('备忘录不可用')).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试读取正文' })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('打开乙')); });
    expect(screen.getByText('乙正文')).toBeVisible();
  });

  it('saves body, title and tags before switching within the debounce window', async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText('备忘录正文'), { target: { value: '最新正文' } });
    fireEvent.change(screen.getByPlaceholderText('输入标题...'), { target: { value: '最新标题' } });
    fireEvent.change(screen.getByLabelText('标签'), { target: { value: '待办' } });
    await act(async () => { fireEvent.click(screen.getByText('打开乙')); });
    expect(api.updateMemoContent).toHaveBeenCalledWith('a', { title: '最新标题', content: '最新正文', tags: ['待办'] }, 'admin@example.test');
    expect(screen.getByText('乙正文')).toBeInTheDocument();
    expect(api.saveMemoWithVersion).not.toHaveBeenCalled();
  });

  it('blocks switching and creation on failure, retains input, and offers a working retry', async () => {
    await openEditor();
    api.updateMemoContent.mockRejectedValue(new Error('offline'));
    fireEvent.change(screen.getByLabelText('备忘录正文'), { target: { value: '未保存内容' } });
    await act(async () => { fireEvent.click(screen.getByText('打开乙')); });
    expect(screen.getByRole('alert')).toHaveTextContent('当前输入仍保留');
    expect(screen.getByLabelText('备忘录正文')).toHaveValue('未保存内容');
    expect(api.getMemo).not.toHaveBeenCalledWith('b', expect.any(AbortSignal));
    await act(async () => { fireEvent.click(screen.getByText('新建')); });
    expect(api.createNew).not.toHaveBeenCalled();
    api.updateMemoContent.mockResolvedValue({});
    await act(async () => { fireEvent.click(screen.getByText('重试保存')); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('打开乙')); });
    expect(screen.getByText('乙正文')).toBeInTheDocument();
  });

  it('shows a background autosave failure without requiring a manual save', async () => {
    await openEditor();
    api.updateMemoContent.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(screen.getByLabelText('备忘录正文'), { target: { value: '断网时的输入' } });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByLabelText('备忘录正文')).toHaveValue('断网时的输入');
    await act(async () => { fireEvent.click(screen.getByText('重试保存')); });
    const savedUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
  });

  it('flushes before preview and keeps manual history snapshots explicit', async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText('备忘录正文'), { target: { value: '预览前保存' } });
    await act(async () => { fireEvent.click(screen.getByText('预览')); });
    expect(api.updateMemoContent).toHaveBeenCalledTimes(1);
    expect(screen.getByText('预览前保存')).toBeInTheDocument();
    fireEvent.click(screen.getByText('编辑'));
    await act(async () => { fireEvent.click(screen.getByText('保存版本')); });
    expect(api.saveMemoWithVersion).toHaveBeenCalledTimes(1);
  });
});
