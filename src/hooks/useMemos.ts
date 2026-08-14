import { useState, useEffect, useCallback } from 'react';
import { listMemos, createMemo, deleteMemo, toggleMemoPin, getAllTags } from '@/src/services/memoApi';
import type { MemoListItem } from '@/src/types/memo';

interface UseMemosOptions {
  tag?: string;
  search?: string;
}

interface UseMemosReturn {
  memos: MemoListItem[];
  loading: boolean;
  error: string | null;
  tags: string[];
  refresh: () => Promise<void>;
  createNew: (title: string, content: string, tags: string[], email: string) => Promise<string>;
  remove: (id: string) => Promise<void>;
  togglePin: (id: string, isPinned: boolean) => Promise<void>;
}

export function useMemos(options?: UseMemosOptions): UseMemosReturn {
  const [memos, setMemos] = useState<MemoListItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memoList, tagList] = await Promise.all([
        listMemos(options),
        getAllTags(),
      ]);
      setMemos(memoList);
      setTags(tagList);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [options?.tag, options?.search]);

  useEffect(() => { refresh(); }, [refresh]);

  const createNew = useCallback(async (title: string, content: string, tagList: string[], email: string) => {
    const memo = await createMemo(title, content, tagList, email);
    await refresh();
    return memo.id;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteMemo(id);
    await refresh();
  }, [refresh]);

  const togglePinFn = useCallback(async (id: string, isPinned: boolean) => {
    await toggleMemoPin(id, isPinned);
    await refresh();
  }, [refresh]);

  return { memos, loading, error, tags, refresh, createNew, remove: remove, togglePin: togglePinFn };
}
