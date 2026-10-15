'use client';

import { useState, useCallback, useRef } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { useMemos } from '@/src/hooks/useMemos';
import { MemoList } from './MemoList';
import { MemoEditor, type MemoEditorHandle } from './MemoEditor';
import { ToastContainer, showToast } from './Toast';
import { Button, EmptyState } from '@/src/components/ui';

interface MemoManagerProps {
  adminEmail: string;
}

export function MemoManager({ adminEmail }: MemoManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const editorRef = useRef<MemoEditorHandle>(null);
  const changingMemo = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const { memos, loading, tags, refresh, createNew, remove, togglePin } = useMemos({
    tag: selectedTag ?? undefined,
    search: search || undefined,
  });

  const handleSelect = useCallback(async (id: string) => {
    if (id === selectedId || changingMemo.current) return;
    changingMemo.current = true;
    setLeaving(true);
    try {
      if (editorRef.current && !(await editorRef.current.saveBeforeLeave())) return;
      setSelectedId(id);
    } finally {
      changingMemo.current = false;
      setLeaving(false);
    }
  }, [selectedId]);

  const handleCreate = useCallback(async () => {
    if (changingMemo.current) return;
    changingMemo.current = true;
    setLeaving(true);
    setCreating(true);
    try {
      if (editorRef.current && !(await editorRef.current.saveBeforeLeave())) return;
      const id = await createNew('无标题', '', [], adminEmail);
      setSelectedId(id);
      showToast('success', '备忘录已创建');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '创建失败');
    } finally {
      changingMemo.current = false;
      setLeaving(false);
      setCreating(false);
    }
  }, [createNew, adminEmail]);

  const handleDelete = useCallback(async (id: string) => {
    if (changingMemo.current) return;
    changingMemo.current = true;
    setLeaving(true);
    try {
      if (selectedId === id && editorRef.current && !(await editorRef.current.saveBeforeLeave())) return;
      await remove(id);
      if (selectedId === id) setSelectedId(null);
      showToast('success', '备忘录已删除');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '删除失败');
    } finally {
      changingMemo.current = false;
      setLeaving(false);
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
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        {/* 左侧列表 */}
        <MemoList
          memos={memos}
          tags={tags}
          loading={loading}
          selectedId={selectedId}
          onSelect={handleSelect}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          onTagFilter={setSelectedTag}
          onSearch={setSearch}
          selectedTag={selectedTag}
          creating={creating}
        />

        {/* 右侧编辑区 */}
        <div className="flex min-w-0 flex-1 flex-col" inert={leaving}>
          {selectedId ? (
            <MemoEditor
              key={selectedId}
              ref={editorRef}
              memoId={selectedId}
              userEmail={adminEmail}
              allTags={tags}
              onSaved={refresh}
              onDeleted={() => { setSelectedId(null); refresh(); }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                title="选择一条备忘录"
                description="从左侧列表打开现有内容，或创建一条新备忘录。"
                action={
                  <Button onClick={handleCreate} disabled={creating} size="sm">
                    {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    新建备忘录
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
