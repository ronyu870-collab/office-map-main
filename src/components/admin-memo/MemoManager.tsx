'use client';

import { useState, useCallback } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { useMemos } from '@/src/hooks/useMemos';
import { MemoList } from './MemoList';
import { MemoEditor } from './MemoEditor';
import { ToastContainer, showToast } from './Toast';

interface MemoManagerProps {
  adminEmail: string;
}

export function MemoManager({ adminEmail }: MemoManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { memos, loading, tags, refresh, createNew, remove, togglePin } = useMemos({
    tag: selectedTag ?? undefined,
    search: search || undefined,
  });

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const id = await createNew('无标题', '', [], adminEmail);
      setSelectedId(id);
      showToast('success', '备忘录已创建');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }, [createNew, adminEmail]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await remove(id);
      if (selectedId === id) setSelectedId(null);
      showToast('success', '备忘录已删除');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '删除失败');
    }
  }, [remove, selectedId]);

  const handleTogglePin = useCallback(async (id: string, isPinned: boolean) => {
    try {
      await togglePin(id, isPinned);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '操作失败');
    }
  }, [togglePin]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        {/* 左侧列表 */}
        <MemoList
          memos={memos}
          tags={tags}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          onTagFilter={setSelectedTag}
          onSearch={setSearch}
          selectedTag={selectedTag}
          creating={creating}
        />

        {/* 右侧编辑区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedId ? (
            <MemoEditor
              key={selectedId}
              memoId={selectedId}
              userEmail={adminEmail}
              allTags={tags}
              onSaved={refresh}
              onDeleted={() => { setSelectedId(null); refresh(); }}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-zinc-400">
              <FileText className="mb-3 h-12 w-12 text-zinc-200" />
              <p className="text-sm">选择一条备忘录或创建新备忘录</p>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                新建备忘录
              </button>
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
