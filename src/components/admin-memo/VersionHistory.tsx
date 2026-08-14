'use client';

import { useEffect } from 'react';
import { RotateCcw, Eye, Clock, User } from 'lucide-react';
import { useVersions } from '@/src/hooks/useVersions';
import type { MemoVersion } from '@/src/types/memo';

interface VersionHistoryProps {
  memoId: string;
  userEmail: string;
  onRestore: () => void;
  onViewVersion: (version: MemoVersion) => void;
}

export function VersionHistory({ memoId, userEmail, onRestore, onViewVersion }: VersionHistoryProps) {
  const { versions, loading, error, loadVersions, restore } = useVersions();

  useEffect(() => {
    loadVersions(memoId);
  }, [memoId, loadVersions]);

  const handleRestore = async (versionId: string) => {
    if (!confirm('确定要恢复到此版本吗？当前内容将被覆盖，并创建新的版本快照。')) return;
    try {
      await restore(memoId, versionId, userEmail);
      onRestore();
    } catch (err) {
      alert(err instanceof Error ? err.message : '恢复失败');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-sm text-zinc-400">加载中...</div>;
  }

  if (error) {
    return <div className="py-12 text-center text-sm text-red-500">{error}</div>;
  }

  if (versions.length === 0) {
    return <div className="py-12 text-center text-sm text-zinc-400">暂无版本历史</div>;
  }

  return (
    <div className="space-y-2 p-4">
      <h3 className="mb-3 text-sm font-medium text-zinc-700">版本历史（共 {versions.length} 个版本）</h3>
      <div className="space-y-2">
        {versions.map((v) => (
          <div
            key={v.id}
            className="group flex items-center justify-between rounded-lg border border-zinc-100 bg-white px-3 py-2.5 transition-colors hover:border-zinc-200 hover:bg-zinc-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-600">
                  v{v.version}
                </span>
                <span className="truncate text-sm text-zinc-800">{v.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(v.snapshot_at).toLocaleString('zh-CN')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {v.snapshot_by}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => onViewVersion(v)}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                title="查看此版本"
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                onClick={() => handleRestore(v.id)}
                className="rounded p-1.5 text-zinc-400 hover:bg-blue-50 hover:text-blue-600"
                title="恢复此版本"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
