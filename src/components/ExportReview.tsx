'use client';

import { Button, Dialog } from '@/src/components/ui';

export function ExportReview({ title, scope, contents, confirmLabel, onClose, onConfirm, busy, error }: {
  title: string;
  scope: string;
  contents: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  error?: string;
}) {
  return <Dialog open title={title} onOpenChange={open => { if (!open && !busy) onClose(); }} dismissible={!busy}
    footer={<><Button disabled={busy} variant="secondary" onClick={onClose}>取消</Button><Button disabled={busy} onClick={onConfirm}>{busy ? '正在准备文件…' : confirmLabel}</Button></>}>
    <dl className="grid gap-3 break-words text-sm">
      <div><dt className="font-medium">范围</dt><dd className="mt-1">{scope}</dd></div>
      <div><dt className="font-medium">内容与格式</dt><dd className="mt-1">{contents}</dd></div>
    </dl>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--cd-color-danger)]">{error}</p>}
  </Dialog>;
}
