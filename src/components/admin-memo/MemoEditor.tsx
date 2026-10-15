'use client';

import { useState, useEffect, useCallback, useImperativeHandle, useRef, type Ref } from 'react';
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
import { Button, EmptyState, LoadingState } from '@/src/components/ui';

type EditorMode = 'edit' | 'preview' | 'history';

export interface MemoEditorHandle {
  saveBeforeLeave: () => Promise<boolean>;
}

interface MemoEditorProps {
  ref?: Ref<MemoEditorHandle>;
  memoId: string;
  userEmail: string;
  allTags: string[];
  onSaved: () => void;
  onDeleted: () => void;
}

export function MemoEditor({ ref, memoId, userEmail, allTags, onSaved }: MemoEditorProps) {
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

  const manualSaving = useRef(false);
  const draft = JSON.stringify({ title, content, tags });
  const savedDraft = memo ? JSON.stringify({ title: memo.title, content: memo.content, tags: memo.tags }) : undefined;

  const autoSave = useCallback(
    async (val: string) => {
      if (!memo) return;
      await updateMemoContent(memo.id, JSON.parse(val) as Pick<Memo, 'title' | 'content' | 'tags'>, userEmail);
    },
    [memo, userEmail]
  );

  const { isSaving, lastSaved, error, forceSave, hasUnsavedChanges } = useAutoSave({
    content: draft,
    savedContent: savedDraft,
    onSave: autoSave,
    delay: 3000,
    enabled: !!memo,
  });

  useImperativeHandle(ref, () => ({
    saveBeforeLeave: async () => !memo || forceSave(),
  }), [memo, forceSave]);

  useEffect(() => {
    if (!memo || (!hasUnsavedChanges && !isSaving)) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [memo, hasUnsavedChanges, isSaving]);

  const handleManualSave = useCallback(async () => {
    if (!memo || manualSaving.current) return;
    manualSaving.current = true;
    setSaveStatus('saving');
    const saved = await forceSave(async (snapshot) => {
      await saveMemoWithVersion(memo.id, JSON.parse(snapshot) as Pick<Memo, 'title' | 'content' | 'tags'>, userEmail);
    });
    manualSaving.current = false;
    setSaveStatus(saved ? 'saved' : 'error');
    if (saved) {
      showToast('success', '版本已保存');
      onSaved();
    }
  }, [memo, userEmail, onSaved, forceSave]);

  const changeMode = async (nextMode: EditorMode) => {
    if (nextMode !== 'edit' && memo && !(await forceSave())) return;
    setMode(nextMode);
    setViewingVersion(null);
  };

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
    return <LoadingState rows={0} label="正在加载备忘录" className="h-full" />;
  }

  if (!memo) {
    return <EmptyState title="无法打开备忘录" description="该备忘录不存在，或当前内容加载失败。" />;
  }

  const displayContent = viewingVersion ? viewingVersion.content : content;
  const displayTitle = viewingVersion ? viewingVersion.title : title;
  const displayTags = viewingVersion ? viewingVersion.tags : tags;
  const isViewingOld = !!viewingVersion;

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-[var(--cd-color-border)] px-4 py-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { void changeMode('edit'); }}
            className={`inline-flex h-[var(--cd-control-height-sm)] items-center gap-1 rounded-[var(--cd-radius-md)] px-2.5 text-[var(--cd-font-size-sm)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
              mode === 'edit' ? 'bg-[var(--cd-color-brand)] text-white' : 'text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]'
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" />
            编辑
          </button>
          <button
            onClick={() => { void changeMode('preview'); }}
            className={`inline-flex h-[var(--cd-control-height-sm)] items-center gap-1 rounded-[var(--cd-radius-md)] px-2.5 text-[var(--cd-font-size-sm)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
              mode === 'preview' && !isViewingOld ? 'bg-[var(--cd-color-brand)] text-white' : 'text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            预览
          </button>
          <button
            onClick={() => { void changeMode('history'); }}
            className={`inline-flex h-[var(--cd-control-height-sm)] items-center gap-1 rounded-[var(--cd-radius-md)] px-2.5 text-[var(--cd-font-size-sm)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
              mode === 'history' ? 'bg-[var(--cd-color-brand)] text-white' : 'text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)]'
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
              <div className="h-4 w-px bg-[var(--cd-color-border)]" />
              {/* 保存状态点 */}
              <span className="inline-flex items-center gap-1.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-muted)]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    saveStatus === 'saving' || isSaving
                      ? 'bg-[var(--cd-color-warning)]'
                      : error
                        ? 'bg-[var(--cd-color-danger)]'
                        : saveStatus === 'saved'
                        ? 'bg-[var(--cd-color-success)]'
                        : saveStatus === 'error'
                          ? 'bg-[var(--cd-color-danger)]'
                          : 'bg-[var(--cd-color-border-strong)]'
                  }`}
                />
                {saveStatus === 'saving' || isSaving
                  ? '保存中'
                  : error
                    ? '保存失败'
                    : hasUnsavedChanges
                      ? '待保存'
                      : saveStatus === 'saved'
                    ? '已保存'
                    : lastSaved
                      ? lastSaved.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                      : ''}
              </span>
              <Button onClick={handleManualSave} disabled={saveStatus === 'saving'} size="sm">
                <Save className="h-3.5 w-3.5" />
                保存版本
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-[var(--cd-color-danger)] bg-[var(--cd-color-danger-soft)] px-4 py-2 text-sm text-[var(--cd-color-danger)]">
          <span>保存失败，当前输入仍保留。请重试，保存成功后再切换。</span>
          <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => { void (saveStatus === 'error' ? handleManualSave() : forceSave()); }}>重试保存</Button>
        </div>
      )}

      {/* 版本查看提示 */}
      {isViewingOld && (
        <div className="flex items-center justify-between border-b border-[var(--cd-color-warning)] bg-[var(--cd-color-warning-soft)] px-4 py-2 text-[var(--cd-font-size-sm)] text-[var(--cd-color-warning)]">
          <span>正在查看版本 v{viewingVersion.version}（{new Date(viewingVersion.snapshot_at).toLocaleString('zh-CN')}）</span>
          <button
            onClick={() => { setViewingVersion(null); setMode('preview'); }}
            className="rounded-[var(--cd-radius-sm)] border border-[var(--cd-color-warning)] bg-[var(--cd-color-surface)] px-2 py-1 font-medium transition hover:bg-[var(--cd-color-warning-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-warning)]"
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
            <div className="space-y-2 border-b border-[var(--cd-color-border)] px-4 py-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入标题..."
                maxLength={100}
                className="w-full bg-transparent text-[var(--cd-font-size-lg)] font-semibold text-[var(--cd-color-text-primary)] outline-none placeholder:text-[var(--cd-color-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"
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
              <h1 className="mb-2 text-[var(--cd-font-size-xl)] font-semibold text-[var(--cd-color-text-primary)]">{displayTitle}</h1>
            )}
            {displayTags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {displayTags.map((t) => (
                  <span key={t} className="rounded-full bg-[var(--cd-color-brand-soft)] px-2.5 py-0.5 text-[var(--cd-font-size-xs)] font-medium text-[var(--cd-color-brand)]">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="prose prose-sm max-w-none">
              <MarkdownPreview content={displayContent} />
            </div>
            {!displayContent && (
              <div className="py-12 text-center text-[var(--cd-font-size-md)] text-[var(--cd-color-text-muted)]">
                内容为空，点击&ldquo;编辑&rdquo;开始编写
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
