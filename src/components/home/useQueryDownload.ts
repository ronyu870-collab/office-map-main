'use client';

import * as React from 'react';
import type { ArtifactInput } from '@/src/lib/intelligence/query/artifacts';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';

export type DownloadState = 'ready' | 'preparing' | 'dispatched' | 'failed';
/** No model calls or query execution. Each explicit click goes through the
 * existing live authorization and snapshot recovery endpoint. */
export function useQueryDownload(scope: QueryClientScope, requestId: string, resultId: string) {
  const active = React.useRef<AbortController | null>(null);
  const [state, setState] = React.useState<DownloadState>('ready');
  const [message, setMessage] = React.useState('');
  React.useEffect(() => () => active.current?.abort(), [scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId, requestId, resultId]);
  async function download(options: Omit<Extract<ArtifactInput, { action: 'export' }>, 'requestId' | 'resultId' | 'action'>) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setState('preparing'); setMessage('正在准备下载…');
    try {
      const file = await trustedQueryClient.download(scope, { requestId, resultId, action: 'export', ...options }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      void trustedQueryClient.reportDelivery(scope, file, 'browser_download_dispatched');
      setState('dispatched'); setMessage('已发起下载');
    } catch {
      if (!controller.signal.aborted) { setState('failed'); setMessage('文件暂不可用或下载失败，请重试。'); }
    } finally { if (active.current === controller) active.current = null; }
  }
  return { state, message, busy: state === 'preparing', download };
}
