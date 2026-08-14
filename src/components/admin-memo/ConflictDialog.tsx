interface ConflictDialogProps {
  open: boolean;
  serverUpdatedAt: string;
  serverUpdatedBy: string;
  onViewLatest: () => void;
  onForceOverwrite: () => void;
  onCancel: () => void;
}

export function ConflictDialog({
  open,
  serverUpdatedAt,
  serverUpdatedBy,
  onViewLatest,
  onForceOverwrite,
  onCancel,
}: ConflictDialogProps) {
  if (!open) return null;

  return (
    /* 遮罩层 */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-start gap-3 border-b border-zinc-100 px-6 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <span className="text-xl">⚠️</span>
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900">检测到编辑冲突</h3>
            <p className="mt-1 text-sm text-zinc-500">
              备忘录已被其他管理员修改，您的更改可能会覆盖最新内容。
            </p>
          </div>
        </div>

        {/* 冲突详情 */}
        <div className="px-6 py-4">
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-600">最后修改人</span>
              <span className="font-medium text-zinc-900">{serverUpdatedBy}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-zinc-600">修改时间</span>
              <span className="font-medium text-zinc-900">
                {new Date(serverUpdatedAt).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col gap-2 px-6 pb-6">
          <button
            onClick={onViewLatest}
            className="w-full rounded-lg bg-[#003e7e] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#002a5c]"
          >
            查看最新版本（放弃我的修改）
          </button>
          <button
            onClick={onForceOverwrite}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
          >
            强制覆盖（用我的版本替换）
          </button>
          <button
            onClick={onCancel}
            className="w-full rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            取消，继续编辑
          </button>
        </div>
      </div>
    </div>
  );
}
