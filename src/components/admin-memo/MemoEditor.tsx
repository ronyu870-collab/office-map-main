'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Eye, Edit3, History, Loader2 } from 'lucide-react';
import { getMemo, updateMemoContent, saveMemoWithVersion } from '@/src/services/memoApi';
import { useAutoSave } from '@/src/hooks/useAutoSave';
import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';
import { TagInput } from './TagInput';
import { VersionHistory } from './VersionHistory';
import { ImageUploadButton } from './ImageUploadButton';
import { showToast } from './Toast';
import type { Memo, MemoVersion } from '@/src/types/memo';

type EditorMode = 'edit' | 'preview' | 'history';

interface MemoEditorProps {
  memoId: string;
  userEmail: string;
  allTags: string[];
  onSaved: () => void;
  onDeleted: () => void;
}

export function MemoEditor({ memoId, userEmail, allTags, onSaved, onDeleted }: MemoEditorProps) {
  const [memo, setMemo] = useState<Memo | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [mode, setMode] = useState<EditorMode>('preview');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [viewingVersion, setViewingVersion] = useState<MemoVersion | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMode('preview');
    setViewingVersion(null);
    setSaveStatus('idle');
    getMemo(memoId)
      .then((m) => {
        if (cancelled) return;
        setMemo(m);
        setTitle(m.title);
        setContent(m.content);
        setTags(m.tags);
      })
      .catch((err) => {
        if (!cancelled) showToast('error', err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [memoId]);

  const autoSave = useCallback(
    async (val: string) => {
      if (!memo) return;
      await updateMemoContent(memo.id, { content: val }, userEmail);
    },
    [memo, userEmail]
  );

  const { isSaving, lastSaved } = useAutoSave({
    content,
    onSave: autoSave,
    delay: 3000,
    enabled: mode === 'edit' && !!memo,
  });

  const handleManualSave = useCallback(async () => {
    if (!memo) return;
    setSaveStatus('saving');
    try {
      await saveMemoWithVersion(memo.id, { title, content, tags }, userEmail);
      setSaveStatus('saved');
      showToast('success', '版本已保存');
      onSaved();
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setSaveStatus('error');
      showToast('error', err instanceof Error ? err.message : '保存失败');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [memo, title, content, tags, userEmail, onSaved]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleManualSave]);

  const handleImageInsert = useCallback((markdown: string) => {
    setContent((prev) => prev + '\n' + markdown + '\n');
  }, []);

  const handleVersionRestore = useCallback(async () => {
    const m = await getMemo(memoId);
    setMemo(m);
    setTitle(m.title);
    setContent(m.content);
    setTags(m.tags);
    setMode('preview');
    setViewingVersion(null);
    showToast('success', '已恢复到历史版本');
    onSaved();
  }, [memoId, onSaved]);

  const handleViewVersion = useCallback((v: MemoVersion) => {
    setViewingVersion(v);
    setMode('preview');
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!memo) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-zinc-400">
        <p className="text-sm">备忘录不存在或加载失败</p>
      </div>
    );
  }

  const displayContent = viewingVersion ? viewingVersion.content : content;
  const displayTitle = viewingVersion ? viewingVersion.title : title;
  const displayTags = viewingVersion ? viewingVersion.tags : tags;
  const isViewingOld = !!viewingVersion;

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setMode('edit'); setViewingVersion(null); }}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              mode === 'edit' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" />
            编辑
          </button>
          <button
            onClick={() => { setMode('preview'); setViewingVersion(null); }}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              mode === 'preview' && !isViewingOld ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button
            onClick={() => { setMode('history'); setViewingVersion(null); }}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              mode === 'history' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            历史
          </button>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'edit' && !isViewingOld && (
            <>
              <ImageUploadButton onInsert={handleImageInsert} />
              <div className="h-4 w-px bg-zinc-200" />
              {/* 保存状态点 */}
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    saveStatus === 'saving' || isSaving
                      ? 'bg-amber-400'
                      : saveStatus === 'saved'
                        ? 'bg-emerald-400'
                        : saveStatus === 'error'
                          ? 'bg-red-400'
                          : 'bg-zinc-300'
                  }`}
                />
                {saveStatus === 'saving' || isSaving
                  ? '保存中'
                  : saveStatus === 'saved'
                    ? '已保存'
                    : lastSaved
                      ? lastSaved.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                      : ''}
              </span>
              <button
                onClick={handleManualSave}
                disabled={saveStatus === 'saving'}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                保存版本
              </button>
            </>
          )}
        </div>
      </div>

      {/* 版本查看提示 */}
      {isViewingOld && (
        <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          <span>正在查看版本 v{viewingVersion.version}（{new Date(viewingVersion.snapshot_at).toLocaleString('zh-CN')}）</span>
          <button
            onClick={() => { setViewingVersion(null); setMode('preview'); }}
            className="rounded bg-amber-100 px-2 py-0.5 font-medium hover:bg-amber-200"
          >
            返回当前版本
          </button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto">
        {mode === 'history' ? (
          <VersionHistory
            memoId={memoId}
            userEmail={userEmail}
            onRestore={handleVersionRestore}
            onViewVersion={handleViewVersion}
          />
        ) : mode === 'edit' && !isViewingOld ? (
          <div className="flex h-full flex-col">
            <div className="space-y-2 border-b border-zinc-100 px-4 py-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入标题..."
                maxLength={100}
                className="w-full bg-transparent text-lg font-medium text-zinc-800 outline-none placeholder:text-zinc-300"
              />
              <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
            </div>
            <div className="flex-1 overflow-hidden">
              <MarkdownEditor value={content} onChange={setContent} />
            </div>
          </div>
        ) : (
          /* 预览模式（含版本查看） */
          <div className="px-6 py-5">
            {displayTitle && (
              <h1 className="mb-2 text-xl font-semibold text-zinc-900">{displayTitle}</h1>
            )}
            {displayTags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {displayTags.map((t) => (
                  <span key={t} className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="prose prose-sm max-w-none">
              <MarkdownPreview content={displayContent} />
            </div>
            {!displayContent && (
              <div className="py-12 text-center text-sm text-zinc-400">
                内容为空，点击&ldquo;编辑&rdquo;开始编写
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
