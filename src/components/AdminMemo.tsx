'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getAdminMemo,
  updateAdminMemoWithConflictCheck,
  forceUpdateAdminMemo,
} from '@/src/services/adminApi';
import type { AdminMemo as AdminMemoType } from '@/src/services/adminApi';
import type { EditorMode, ConflictData, LocalMemoCache, TaskStats } from '@/src/types/admin-memo';

import { Toolbar } from './admin-memo/Toolbar';
import { MarkdownEditor } from './admin-memo/MarkdownEditor';
import { MarkdownPreview } from './admin-memo/MarkdownPreview';
import { ConflictDialog } from './admin-memo/ConflictDialog';
import { StatusIndicator } from './admin-memo/StatusIndicator';

import { useAutoSave } from '@/src/hooks/useAutoSave';
import { useConflictDetection } from '@/src/hooks/useConflictDetection';
import { useTemplateManager } from '@/src/hooks/useTemplateManager';
import { useSystemIntegration } from '@/src/hooks/useSystemIntegration';
import { useKeyboardShortcuts } from '@/src/hooks/useKeyboardShortcuts';

// localStorage 草稿缓存键
const DRAFT_CACHE_KEY = 'admin_memo_draft';

function saveDraft(content: string, userEmail: string) {
  const cache: LocalMemoCache = {
    content,
    timestamp: new Date().toISOString(),
    userEmail,
  };
  try {
    localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage 不可用时静默失败
  }
}

function loadDraft(): LocalMemoCache | null {
  try {
    const cached = localStorage.getItem(DRAFT_CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached) as LocalMemoCache;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_CACHE_KEY);
  } catch {
    // 静默失败
  }
}

/** 解析 Markdown 中的任务列表统计 */
function parseTaskStats(content: string): TaskStats {
  const lines = content.split('\n');
  let total = 0;
  let completed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- [ ]') || trimmed.startsWith('* [ ]')) {
      total++;
    } else if (
      trimmed.startsWith('- [x]') ||
      trimmed.startsWith('- [X]') ||
      trimmed.startsWith('* [x]') ||
      trimmed.startsWith('* [X]')
    ) {
      total++;
      completed++;
    }
  }

  return { total, completed };
}

/** 切换指定行的任务状态 */
function toggleTaskInContent(content: string, lineIndex: number, checked: boolean): string {
  const lines = content.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return content;

  const line = lines[lineIndex];
  if (checked) {
    lines[lineIndex] = line.replace(/^(\s*[-*]\s*)\[ \]/, '$1[x]');
  } else {
    lines[lineIndex] = line.replace(/^(\s*[-*]\s*)\[x\]/i, '$1[ ]');
  }

  return lines.join('\n');
}

interface AdminMemoProps {
  adminEmail: string;
}

export function AdminMemo({ adminEmail }: AdminMemoProps) {
  // 数据状态
  const [memo, setMemo] = useState<AdminMemoType | null>(null);
  const [content, setContent] = useState('');
  const [initialTimestamp, setInitialTimestamp] = useState<string | null>(null);

  // UI 状态
  const [mode, setMode] = useState<EditorMode>('preview');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // 冲突状态
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [showConflictDialog, setShowConflictDialog] = useState(false);

  // 系统集成
  const { systemTasks } = useSystemIntegration();

  // 模板管理
  const { insertTemplate } = useTemplateManager();

  // 网络状态监听
  useEffect(() => {
    function handleOnline() { setIsOffline(false); }
    function handleOffline() { setIsOffline(true); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 加载备忘录
  const loadMemo = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getAdminMemo();
      setMemo(data);
      setInitialTimestamp(data.updated_at);

      // 检查是否有未保存的草稿
      const draft = loadDraft();
      if (draft && draft.userEmail === adminEmail) {
        // 草稿比服务器版本更新，提示恢复
        const draftTime = new Date(draft.timestamp).getTime();
        const serverTime = new Date(data.updated_at).getTime();
        if (draftTime > serverTime) {
          setContent(draft.content);
        } else {
          setContent(data.content);
          clearDraft();
        }
      } else {
        setContent(data.content);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      console.error('[AdminMemo] 加载备忘录失败:', err);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [adminEmail]);

  useEffect(() => {
    loadMemo();
  }, [loadMemo]);

  // 保存函数（带冲突检测）
  // 注意：isOffline 检查由 useAutoSave 的 enabled 控制，这里不重复检查
  const performSave = useCallback(
    async (contentToSave: string) => {
      if (!adminEmail) return;

      setSaving(true);
      try {
        const result = await updateAdminMemoWithConflictCheck(
          contentToSave,
          adminEmail,
          initialTimestamp ?? ''
        );

        if (result.conflict?.detected) {
          setConflictData({
            serverUpdatedAt: result.conflict.serverUpdatedAt,
            serverUpdatedBy: result.conflict.serverUpdatedBy,
            localContent: contentToSave,
          });
          setShowConflictDialog(true);
        } else {
          setMemo(result.memo);
          setInitialTimestamp(result.memo.updated_at);
          clearDraft();
          setShowSuccess(true);
          setTimeout(() => setShowSuccess(false), 2000);
        }
      } catch (err) {
        console.error('[AdminMemo] 保存备忘录失败:', err);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [adminEmail, initialTimestamp]  // 移除 isOffline 依赖
  );

  // 自动保存
  const { isSaving: isAutoSaving, lastSaved, error: autoSaveError, forceSave } = useAutoSave({
    content,
    onSave: performSave,
    delay: 3000,
    enabled: mode === 'edit' && !isOffline,
  });

  // 冲突检测
  const { checkConflict } = useConflictDetection({
    initialTimestamp,
    onConflict: (data) => {
      setConflictData({ ...data, localContent: content });
      setShowConflictDialog(true);
    },
  });

  // 手动保存
  const handleSave = useCallback(async () => {
    if (!adminEmail) return;

    // 先检查冲突
    const hasConflict = await checkConflict();
    if (!hasConflict) {
      await forceSave();
    }
  }, [adminEmail, checkConflict, forceSave]);

  // 内容变更时保存草稿
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      saveDraft(newContent, adminEmail);
    },
    [adminEmail]
  );

  // 任务列表切换
  const handleTaskToggle = useCallback(
    (lineIndex: number, checked: boolean) => {
      const newContent = toggleTaskInContent(content, lineIndex, checked);
      handleContentChange(newContent);
    },
    [content, handleContentChange]
  );

  // 插入模板
  const handleInsertTemplate = useCallback(() => {
    const templateContent = insertTemplate('full');
    handleContentChange(templateContent);
    setMode('edit');
  }, [insertTemplate, handleContentChange]);

  // 冲突处理：查看最新版本
  const handleViewLatest = useCallback(async () => {
    setShowConflictDialog(false);
    setConflictData(null);
    await loadMemo();
    setMode('preview');
  }, [loadMemo]);

  // 冲突处理：强制覆盖
  const handleForceOverwrite = useCallback(async () => {
    if (!adminEmail || !conflictData) return;

    setSaving(true);
    try {
      const updated = await forceUpdateAdminMemo(conflictData.localContent, adminEmail);
      setMemo(updated);
      setInitialTimestamp(updated.updated_at);
      clearDraft();
      setShowConflictDialog(false);
      setConflictData(null);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (err) {
      console.error('Force overwrite failed:', err);
    } finally {
      setSaving(false);
    }
  }, [adminEmail, conflictData]);

  // 键盘快捷键
  useKeyboardShortcuts({
    onSave: handleSave,
    onToggleEdit: () => setMode('edit'),
    onTogglePreview: () => setMode('preview'),
    enabled: !loading,
  });

  // 计算待办事项统计
  const taskStats = parseTaskStats(content);

  // 加载状态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
          <span className="text-sm text-zinc-500">加载中...</span>
        </div>
      </div>
    );
  }

  // 加载错误状态
  if (loadError) {
    const isPermissionError =
      loadError.includes('权限不足') ||
      loadError.includes('permission') ||
      loadError.includes('unauthorized') ||
      loadError.includes('forbidden');

    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <span className="text-2xl">{isPermissionError ? '🔒' : '⚠️'}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-900">
              {isPermissionError ? '权限不足' : '加载失败'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {isPermissionError ? '请检查登录状态后重试' : loadError}
            </p>
          </div>
          <button
            onClick={loadMemo}
            className="rounded-lg bg-[#003e7e] px-4 py-2 text-sm font-medium text-white hover:bg-[#002a5c]"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const isSavingAny = saving || isAutoSaving;

  return (
    <div className="flex h-full flex-col w-full">
      {/* 工具栏 */}
      <Toolbar
        mode={mode}
        onModeChange={setMode}
        onSave={handleSave}
        onInsertTemplate={handleInsertTemplate}
        saving={isSavingAny}
        lastModified={memo ? { time: memo.updated_at, by: memo.updated_by } : null}
        showSuccess={showSuccess}
        taskStats={taskStats.total > 0 ? taskStats : undefined}
      />

      {/* 离线/错误状态栏 */}
      {(isOffline || autoSaveError) && (
        <div className="shrink-0 border-b border-zinc-100 bg-white px-6 py-2">
          <StatusIndicator
            isSaving={isAutoSaving}
            lastSaved={lastSaved}
            error={autoSaveError}
            isOffline={isOffline}
          />
        </div>
      )}

      {/* 编辑/预览区域 */}
      <div className="flex-1 overflow-hidden bg-zinc-50 p-6">
        {mode === 'edit' ? (
          <MarkdownEditor
            value={content}
            onChange={handleContentChange}
            disabled={isSavingAny}
          />
        ) : (
          <MarkdownPreview
            content={content}
            onTaskToggle={handleTaskToggle}
            systemTasks={systemTasks}
          />
        )}
      </div>

      {/* 冲突对话框 */}
      {conflictData && (
        <ConflictDialog
          open={showConflictDialog}
          serverUpdatedAt={conflictData.serverUpdatedAt}
          serverUpdatedBy={conflictData.serverUpdatedBy}
          onViewLatest={handleViewLatest}
          onForceOverwrite={handleForceOverwrite}
          onCancel={() => setShowConflictDialog(false)}
        />
      )}
    </div>
  );
}
