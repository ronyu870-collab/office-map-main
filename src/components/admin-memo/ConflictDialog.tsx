import { Button, Dialog } from '@/src/components/ui';

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
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}
      title="检测到编辑冲突"
      description="备忘录已被其他管理员修改，您的更改可能会覆盖最新内容。"
      size="sm"
      footer={<><Button variant="secondary" onClick={onCancel}>取消，继续编辑</Button><Button variant="danger" onClick={onForceOverwrite}>强制覆盖</Button><Button onClick={onViewLatest}>查看最新版本</Button></>}
    >
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
    </Dialog>
  );
}
