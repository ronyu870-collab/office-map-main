'use client';

import { useEffect } from 'react';
import { RotateCcw, Eye, Clock, User } from 'lucide-react';
import { useVersions } from '@/src/hooks/useVersions';
import type { MemoVersion } from '@/src/types/memo';
import { EmptyState, ErrorState, IconButton, LoadingState } from '@/src/components/ui';

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
    return <LoadingState rows={0} label="正在加载版本历史" className="py-12" />;
  }

  if (error) {
    return <ErrorState title="版本历史加载失败" description={error} />;
  }

  if (versions.length === 0) {
    return <EmptyState title="暂无版本历史" description="保存新版本后，会在这里显示历史记录。" />;
  }

  return (
    <div className="space-y-2 p-4">
      <h3 className="mb-3 text-[var(--cd-font-size-md)] font-semibold text-[var(--cd-color-text-primary)]">版本历史（共 {versions.length} 个版本）</h3>
      <div className="space-y-2">
        {versions.map((v) => (
          <div
            key={v.id}
            className="group flex items-center justify-between rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--cd-color-surface-alt)]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-surface-alt)] px-1.5 py-0.5 font-mono text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-secondary)]">
                  v{v.version}
                </span>
                <span className="truncate text-[var(--cd-font-size-md)] text-[var(--cd-color-text-primary)]">{v.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-muted)]">
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
              <IconButton
                variant="ghost"
                size="sm"
                label="查看此版本"
                onClick={() => onViewVersion(v)}
              >
                <Eye className="h-4 w-4" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="sm"
                label="恢复此版本"
                onClick={() => handleRestore(v.id)}
                className="hover:bg-[var(--cd-color-brand-soft)] hover:text-[var(--cd-color-brand)]"
              >
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
