'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Pin, Trash2, Search, Loader2 } from 'lucide-react';
import { TagFilter } from './TagFilter';
import type { MemoListItem } from '@/src/types/memo';
import { Button, Dialog, ErrorState, IconButton } from '@/src/components/ui';

interface MemoListProps {
  memos: MemoListItem[];
  tags: string[];
  loading: boolean;
  error?: string | null;
  tagError?: boolean;
  onRetryList?: () => void;
  onRetryTags?: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
  onTagFilter: (tag: string | null) => void;
  onSearch: (query: string) => void;
  selectedTag: string | null;
  creating?: boolean;
}

export function MemoList({
  memos, tags, loading, error, tagError, onRetryList, onRetryTags, selectedId, onSelect, onCreate, onDelete,
  onTogglePin, onTagFilter, onSearch, selectedTag, creating,
}: MemoListProps) {
  const [searchInput, setSearchInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MemoListItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleSearchChange = useCallback((val: string) => {
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(val), 300);
  }, [onSearch]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleDeleteClick = (memo: MemoListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(memo);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const handlePin = (id: string, isPinned: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(id, !isPinned);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <div className="flex w-64 shrink-0 flex-col border-r border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[var(--cd-color-border)] px-3 py-3">
          <h2 className="text-[var(--cd-font-size-md)] font-semibold text-[var(--cd-color-text-primary)]">备忘录</h2>
          <Button onClick={onCreate} disabled={creating} size="sm">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            新建
          </Button>
        </div>

        {/* 搜索 */}
        <div className="px-3 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--cd-color-text-muted)]" aria-hidden="true" />
            <input
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索标题..."
              className="h-[var(--cd-control-height-sm)] w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] pl-8 pr-3 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-primary)] outline-none transition focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-focus)]"
            />
          </div>
        </div>

        {/* 标签筛选 */}
        <TagFilter tags={tags} selected={selectedTag} onChange={onTagFilter} />
        {tagError && (
          <div className="flex items-center justify-between gap-2 px-3 py-1 text-sm" role="status">
            <span>标签加载失败</span>
            <Button size="sm" variant="secondary" onClick={onRetryTags}>重试标签</Button>
          </div>
        )}

        {/* 列表 */}
        <div className="flex-1 overflow-auto px-2 py-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--cd-color-brand)]" />
            </div>
          ) : error ? (
            <ErrorState title="备忘录加载失败" action={<Button size="sm" variant="secondary" onClick={onRetryList}>重试列表</Button>} />
          ) : memos.length === 0 ? (
            <div className="py-12 text-center text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-muted)]">
              {searchInput || selectedTag ? '没有匹配的备忘录' : '暂无备忘录'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {memos.map((memo) => (
                <div
                  key={memo.id}
                  onClick={() => onSelect(memo.id)}
                  className={`group cursor-pointer rounded-[var(--cd-radius-md)] border px-3 py-2.5 transition-colors ${
                    selectedId === memo.id
                      ? 'border-[var(--cd-color-border-strong)] bg-[var(--cd-color-brand-soft)]'
                      : 'border-transparent hover:bg-[var(--cd-color-surface)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {memo.is_pinned && <Pin className="h-3 w-3 shrink-0 text-amber-500" />}
                        <span className="truncate text-[var(--cd-font-size-md)] font-medium text-[var(--cd-color-text-primary)]">
                          {memo.title || '无标题'}
                        </span>
                      </div>
                      {memo.content_preview && (
                        <p className="mt-0.5 line-clamp-2 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)]">
                          {memo.content_preview}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {memo.tags.slice(0, 2).map((t) => (
                          <span key={t} className="rounded-full bg-[var(--cd-color-brand-soft)] px-1.5 py-0.5 text-[var(--cd-font-size-xs)] text-[var(--cd-color-brand)]">
                            {t}
                          </span>
                        ))}
                        {memo.tags.length > 2 && (
                          <span className="text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-muted)]">+{memo.tags.length - 2}</span>
                        )}
                        <span className="ml-auto text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-muted)]">
                          {formatTime(memo.updated_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label={memo.is_pinned ? '取消置顶' : '置顶'}
                        onClick={(e) => handlePin(memo.id, memo.is_pinned, e)}
                        className={`!h-7 !w-7 ${
                          memo.is_pinned ? 'text-[var(--cd-color-warning)]' : 'text-[var(--cd-color-text-muted)]'
                        }`}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        label="删除"
                        onClick={(e) => handleDeleteClick(memo, e)}
                        className="!h-7 !w-7 text-[var(--cd-color-text-muted)] hover:bg-[var(--cd-color-danger-soft)] hover:text-[var(--cd-color-danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认对话框 */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="确认删除"
        description="确定要删除这条备忘录吗？"
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" onClick={confirmDelete}>删除</Button></>}
      >
        <p className="text-[var(--cd-font-size-md)] text-[var(--cd-color-text-secondary)]">“{deleteTarget?.title || '无标题'}”及其所有版本历史将被永久删除，此操作不可撤销。</p>
      </Dialog>
    </>
  );
}
