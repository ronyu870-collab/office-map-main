'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Pin, Trash2, Search, Loader2, X } from 'lucide-react';
import { TagFilter } from './TagFilter';
import type { MemoListItem } from '@/src/types/memo';

interface MemoListProps {
  memos: MemoListItem[];
  tags: string[];
  loading: boolean;
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
  memos, tags, loading, selectedId, onSelect, onCreate, onDelete,
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
      <div className="flex w-64 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/30">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
          <h2 className="text-sm font-semibold text-zinc-700">备忘录</h2>
          <button
            onClick={onCreate}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            新建
          </button>
        </div>

        {/* 搜索 */}
        <div className="px-3 pt-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索标题..."
              className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* 标签筛选 */}
        <TagFilter tags={tags} selected={selectedTag} onChange={onTagFilter} />

        {/* 列表 */}
        <div className="flex-1 overflow-auto px-2 py-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : memos.length === 0 ? (
            <div className="py-12 text-center text-xs text-zinc-400">
              {searchInput || selectedTag ? '没有匹配的备忘录' : '暂无备忘录'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {memos.map((memo) => (
                <div
                  key={memo.id}
                  onClick={() => onSelect(memo.id)}
                  className={`group cursor-pointer rounded-lg px-3 py-2.5 transition-colors ${
                    selectedId === memo.id
                      ? 'bg-white shadow-sm ring-1 ring-zinc-200'
                      : 'hover:bg-white/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {memo.is_pinned && <Pin className="h-3 w-3 shrink-0 text-amber-500" />}
                        <span className="truncate text-sm font-medium text-zinc-800">
                          {memo.title || '无标题'}
                        </span>
                      </div>
                      {memo.content_preview && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">
                          {memo.content_preview}
                        </p>
                      )}
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {memo.tags.slice(0, 2).map((t) => (
                          <span key={t} className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                            {t}
                          </span>
                        ))}
                        {memo.tags.length > 2 && (
                          <span className="text-[10px] text-zinc-400">+{memo.tags.length - 2}</span>
                        )}
                        <span className="ml-auto text-[10px] text-zinc-400">
                          {formatTime(memo.updated_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => handlePin(memo.id, memo.is_pinned, e)}
                        className={`rounded p-1 transition-colors ${
                          memo.is_pinned ? 'text-amber-500 hover:text-amber-600' : 'text-zinc-300 hover:text-zinc-500'
                        }`}
                        title={memo.is_pinned ? '取消置顶' : '置顶'}
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(memo, e)}
                        className="rounded p-1 text-zinc-300 transition-colors hover:bg-red-50 hover:text-red-400"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 删除确认对话框 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-800">确认删除</h3>
              <button onClick={() => setDeleteTarget(null)} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-1 text-sm text-zinc-600">
              确定要删除这条备忘录吗？
            </p>
            <p className="mb-4 text-xs text-zinc-400">
              &ldquo;{deleteTarget.title || '无标题'}&rdquo; 及其所有版本历史将被永久删除，此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
