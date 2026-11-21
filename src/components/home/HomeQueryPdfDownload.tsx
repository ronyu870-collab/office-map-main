'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { reportDescriptorSchema } from '@/src/lib/intelligence/query/reportProtocol';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import styles from './HomeQuery.module.css';

/** Visible with the answer even when a large result table is collapsed. */
export function HomeQueryPdfDownload({ descriptor, requestId, resultId, scope, internalExport }: {
  descriptor: unknown; requestId: string; resultId: string; scope: QueryClientScope; internalExport: boolean;
}) {
  const prepared = reportDescriptorSchema.safeParse(descriptor).data;
  const active = React.useRef<AbortController | null>(null);
  const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
  React.useEffect(() => () => { active.current?.abort(); }, [requestId, resultId, scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);
  if (!prepared) return null;
  async function download() {
    if (!prepared || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage('正在重新核对导出权限并取得文件…');
    try {
      const file = await trustedQueryClient.download(scope, { requestId, resultId, action: 'export', format: prepared.format }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      void trustedQueryClient.reportDelivery(scope, file, 'browser_download_dispatched');
      setMessage('浏览器已发起下载；尚未确认文件已实际保存。仅供内部分析。');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '下载未完成，请重试。');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (active.current === controller) active.current = null;
    }
  }
  return <div aria-label="本条回答生成的 PDF 报告">
    <div className={styles.actions}>
      <span>服务器已生成内部研究 PDF（{prepared.sectionCount} 个研究部分）</span>
      {internalExport && <Button variant="ghost" disabled={busy} onClick={() => void download()}>
        下载 PDF 研究报告
      </Button>}
    </div>
    <p role="status" className={styles.notice}>{message}</p>
  </div>;
}
