'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { copyAssistantResponse } from '@/src/services/assistantCopyClient';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import styles from './HomeQueryAssistantActions.module.css';

type Props = { scope: QueryClientScope; requestId: string; conversationId: string; message: string; internalExport: boolean };

export function HomeQueryAssistantActions(props: Props) {
  return <AssistantActions key={JSON.stringify([props.scope, props.requestId, props.conversationId, props.internalExport])} {...props} />;
}

function AssistantActions({ scope, requestId, conversationId, message, internalExport }: Props) {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [manualText, setManualText] = React.useState<string | null>(null);
  const active = React.useRef<AbortController | null>(null);
  const manual = React.useRef<HTMLTextAreaElement>(null);
  const copyButton = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();
  React.useEffect(() => () => active.current?.abort(), []);

  async function copy() {
    if (!internalExport || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setCopied(false); setManualText(null); setStatus('正在复制…');
    try {
      const output = await copyAssistantResponse(scope, { requestId, conversationId }, controller.signal);
      if (controller.signal.aborted) return;
      if (output.text !== message) throw new Error('复制内容与当前回答不一致，请重新打开对话。');
      try {
        if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(output.text);
        if (!controller.signal.aborted) { setCopied(true); setStatus('已复制回答'); }
      } catch {
        if (!controller.signal.aborted) { setManualText(output.text); setStatus('自动复制未完成，可选择下方文字手动复制。'); }
      }
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : '复制未完成，请重试。');
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  if (!internalExport) return null;
  return <div className={styles.root}>
    <Button ref={copyButton} variant="ghost" size="sm" className={styles.copy} disabled={busy} onClick={() => void copy()}>
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {busy ? '复制中…' : '复制回答'}
    </Button>
    {status && <p role="status" className={styles.status}>{status}</p>}
    {manualText !== null && <div className={styles.fallback}>
      <label htmlFor={id}>可手动复制的回答</label>
      <textarea id={id} ref={manual} readOnly value={manualText} rows={5} />
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={() => { manual.current?.focus(); manual.current?.select(); }}>选择全部文字</Button>
        <Button variant="ghost" size="sm" onClick={() => { setManualText(null); copyButton.current?.focus({ preventScroll: true }); }}>关闭复制内容</Button>
      </div>
    </div>}
  </div>;
}
