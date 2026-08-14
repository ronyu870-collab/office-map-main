import type { EditorMode } from '@/src/types/admin-memo';

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
    <div className="shrink-0 border-b border-zinc-100 bg-white px-6 py-4">
      {/* 主行：标题 + 操作按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-zinc-900">
              管理员备忘录
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              支持 Markdown 格式，自动保存
            </p>
          </div>

          {/* 待办事项统计 */}
          {taskStats && taskStats.total > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs">
              <span className="font-medium text-blue-700">
                待办: {taskStats.completed}/{taskStats.total}
              </span>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-blue-200">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
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
          <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1">
            <button
              onClick={() => onModeChange('edit')}
              aria-pressed={mode === 'edit'}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'edit'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              ✏️ 编辑
            </button>
            <button
              onClick={() => onModeChange('preview')}
              aria-pressed={mode === 'preview'}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === 'preview'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              👁 预览
            </button>
          </div>

          {/* 插入模板按钮 */}
          <button
            onClick={onInsertTemplate}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            📋 插入模板
          </button>

          {/* 最后修改信息（中等屏幕以上显示） */}
          {lastModified && (
            <div className="hidden text-right text-xs text-zinc-400 sm:block">
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
              <div className="mt-0.5 truncate max-w-[120px]">BY {lastModified.by}</div>
            </div>
          )}

          {/* 保存按钮 */}
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-[#003e7e] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#002a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 成功提示 */}
      {showSuccess && (
        <div className="mt-3 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          ✓ 保存成功
        </div>
      )}
    </div>
  );
}
