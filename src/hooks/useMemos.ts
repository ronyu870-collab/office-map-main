import { useState, useEffect, useCallback } from 'react';
import { listMemos, createMemo, deleteMemo, toggleMemoPin, getAllTags } from '@/src/services/memoApi';
import type { MemoListItem } from '@/src/types/memo';

interface UseMemosOptions {
  tag?: string;
  search?: string;
}

interface MemoListResult extends UseMemosOptions {
  version: number;
  memos: MemoListItem[];
  error: string | null;
}

export function useMemos({ tag, search }: UseMemosOptions = {}) {
  const [list, setList] = useState<MemoListResult | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagError, setTagError] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [tagVersion, setTagVersion] = useState(0);

  const refreshList = useCallback(() => setListVersion(version => version + 1), []);
  const refreshTags = useCallback(() => {
    setTagError(false);
    setTagVersion(version => version + 1);
  }, []);
  const refresh = useCallback(() => { refreshList(); refreshTags(); }, [refreshList, refreshTags]);

  useEffect(() => {
    const controller = new AbortController();
    const scope = { tag, search, version: listVersion };
    void listMemos({ tag, search }, controller.signal).then(
      memos => {
        if (!controller.signal.aborted) setList({ ...scope, memos, error: null });
      },
      error => {
        if (!controller.signal.aborted) setList({ ...scope, memos: [], error: error instanceof Error ? error.message : '加载失败' });
      },
    );
    return () => controller.abort();
  }, [tag, search, listVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void getAllTags(controller.signal).then(
      values => { if (!controller.signal.aborted) setTags(values); },
      () => { if (!controller.signal.aborted) setTagError(true); },
    );
    return () => controller.abort();
  }, [tagVersion]);

  const createNew = useCallback(async (title: string, content: string, tagList: string[], email: string) => {
    const memo = await createMemo(title, content, tagList, email);
    refresh();
    return memo.id;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteMemo(id);
    refresh();
  }, [refresh]);

  const togglePin = useCallback(async (id: string, isPinned: boolean) => {
    await toggleMemoPin(id, isPinned);
    refreshList();
  }, [refreshList]);

  const current = list?.version === listVersion && list.tag === tag && list.search === search ? list : null;
  return {
    memos: current?.memos ?? [],
    loading: !current,
    error: current?.error ?? null,
    tags, tagError, refresh, refreshList, refreshTags, createNew, remove, togglePin,
  };
}
