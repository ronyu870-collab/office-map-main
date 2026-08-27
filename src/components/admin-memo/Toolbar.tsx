import type { EditorMode } from '@/src/types/admin-memo';
import { Check, ClipboardPaste, Eye, Loader2, Pencil, Save } from 'lucide-react';
import { Button } from '@/src/components/ui';

interface ToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onSave: () => void;
  onInsertTemplate: () => void;
  saving: boolean;
  lastModified: {
    time: string;
    by: string;
  } | null;
  showSuccess: boolean;
  taskStats?: {
    completed: number;
    total: number;
  };
}

export function Toolbar({
  mode,
  onModeChange,
  onSave,
  onInsertTemplate,
  saving,
  lastModified,
  showSuccess,
  taskStats,
}: ToolbarProps) {
  return (
    <div className="shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-4 py-3 sm:px-6">
      {/* 主行：标题 + 操作按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-[var(--cd-font-size-lg)] font-semibold text-[var(--cd-color-text-primary)]">
              管理员备忘录
            </h2>
            <p className="mt-0.5 text-[var(--cd-font-size-sm)] text-[var(--cd-color-text-secondary)]">
              支持 Markdown 格式，自动保存
            </p>
          </div>

          {/* 待办事项统计 */}
          {taskStats && taskStats.total > 0 && (
            <div className="flex items-center gap-2 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] px-3 py-1.5 text-[var(--cd-font-size-sm)]">
              <span className="font-medium text-[var(--cd-color-brand)]">
                待办: {taskStats.completed}/{taskStats.total}
              </span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--cd-color-border)]">
                <div
                  className="h-full bg-[var(--cd-color-brand)] transition-all duration-300"
                  style={{
                    width: `${Math.round((taskStats.completed / taskStats.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 模式切换按钮 */}
          <div className="flex rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] p-0.5">
            <button
              onClick={() => onModeChange('edit')}
              aria-pressed={mode === 'edit'}
              className={`inline-flex h-[var(--cd-control-height-sm)] items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-3 text-[var(--cd-font-size-sm)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
                mode === 'edit'
                  ? 'bg-[var(--cd-color-surface)] text-[var(--cd-color-brand)] shadow-[var(--cd-shadow-sm)]'
                  : 'text-[var(--cd-color-text-secondary)] hover:text-[var(--cd-color-text-primary)]'
              }`}
            >
              <Pencil size={14} aria-hidden="true" />编辑
            </button>
            <button
              onClick={() => onModeChange('preview')}
              aria-pressed={mode === 'preview'}
              className={`inline-flex h-[var(--cd-control-height-sm)] items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-3 text-[var(--cd-font-size-sm)] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)] ${
                mode === 'preview'
                  ? 'bg-[var(--cd-color-surface)] text-[var(--cd-color-brand)] shadow-[var(--cd-shadow-sm)]'
                  : 'text-[var(--cd-color-text-secondary)] hover:text-[var(--cd-color-text-primary)]'
              }`}
            >
              <Eye size={14} aria-hidden="true" />预览
            </button>
          </div>

          {/* 插入模板按钮 */}
          <Button variant="secondary" size="sm" onClick={onInsertTemplate}>
            <ClipboardPaste size={14} aria-hidden="true" />插入模板
          </Button>

          {/* 最后修改信息（中等屏幕以上显示） */}
          {lastModified && (
            <div className="hidden text-right text-[var(--cd-font-size-xs)] text-[var(--cd-color-text-muted)] sm:block">
              <div>最后修改于</div>
              <div className="mt-0.5">
                {new Date(lastModified.time).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
              <div className="mt-0.5 max-w-[160px] truncate">修改人：{lastModified.by}</div>
            </div>
          )}

          {/* 保存按钮 */}
          <Button onClick={onSave} disabled={saving} size="sm">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      {/* 成功提示 */}
      {showSuccess && (
        <div className="mt-3 flex items-center gap-2 rounded-[var(--cd-radius-md)] border border-[color-mix(in_srgb,var(--cd-color-success)_24%,transparent)] bg-[var(--cd-color-success-soft)] px-3 py-2 text-[var(--cd-font-size-sm)] text-[var(--cd-color-success)]" role="status">
          <Check size={14} aria-hidden="true" />保存成功
        </div>
      )}
    </div>
  );
}
