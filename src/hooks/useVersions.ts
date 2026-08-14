import { useState, useCallback } from 'react';
import { getMemoVersions, restoreMemoVersion } from '@/src/services/memoApi';
import type { MemoVersion } from '@/src/types/memo';

interface UseVersionsReturn {
  versions: MemoVersion[];
  loading: boolean;
  error: string | null;
  loadVersions: (memoId: string) => Promise<void>;
  restore: (memoId: string, versionId: string, email: string) => Promise<void>;
}

export function useVersions(): UseVersionsReturn {
  const [versions, setVersions] = useState<MemoVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = useCallback(async (memoId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMemoVersions(memoId);
      setVersions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载版本历史失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const restore = useCallback(async (memoId: string, versionId: string, email: string) => {
    await restoreMemoVersion(memoId, versionId, email);
    // 重新加载版本列表
    await loadVersions(memoId);
  }, [loadVersions]);

  return { versions, loading, error, loadVersions, restore };
}
