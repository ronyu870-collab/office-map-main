'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { renderResultCopy, type ResultCopyFormat } from '@/src/lib/intelligence/query/resultOutput';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import styles from './HomeQueryResultActions.module.css';

type Props = { result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean; children?: React.ReactNode };

export function HomeQueryResultActions(props: Props) {
  // A new identity/result always disposes clipboard requests and old fallback text.
  return <ResultActions key={JSON.stringify([props.scope, props.requestId, props.result.resultId, props.internalExport])} {...props} />;
}

function ResultActions({ result, requestId, scope, internalExport, children }: Props) {
  const [summary, setSummary] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [manualText, setManualText] = React.useState<string | null>(null);
  const active = React.useRef<AbortController | null>(null);
  const manual = React.useRef<HTMLTextAreaElement>(null);
  const summaryRef = React.useRef<HTMLElement>(null);
  const summaryTrigger = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => () => active.current?.abort(), []);
  React.useEffect(() => { if (summary) summaryRef.current?.focus({ preventScroll: true }); }, [summary]);

  async function copy(format: ResultCopyFormat) {
    if (!internalExport || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage('正在核对复制权限…'); setManualText(null);
    try {
      const output = await trustedQueryClient.copy(scope, { requestId, resultId: result.resultId, action: 'copy', format }, controller.signal);
      if (controller.signal.aborted) return;
      // The original immutable result must be exactly the one being viewed.
      if (output.resultId !== result.resultId || output.text !== renderResultCopy(result, format)) throw new Error('复制内容与当前结果不一致，请重新打开历史快照。');
      try {
        if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(output.text);
        if (!controller.signal.aborted) setMessage('已复制，包含数据期间、单位、样本口径与来源限制。');
      } catch {
        if (!controller.signal.aborted) { setManualText(output.text); setMessage('浏览器未完成自动复制。可选择下方文字后手动复制。'); }
      }
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '复制未完成，请重试。');
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function showSummary() {
    try { setSummary(renderResultCopy(result, 'summary')); setMessage(''); }
    catch { setMessage('本次结果过长，暂无法生成摘要。请查看原分析或导出完整数据。'); }
  }

  return <div className={styles.root} onKeyDown={event => {
    // Close the local disclosure first; Escape must not also close the workspace.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const disclosure = event.target instanceof HTMLElement ? event.target.closest('details[open]') : null;
    if (!(disclosure instanceof HTMLDetailsElement) || !event.currentTarget.contains(disclosure)) return;
    event.preventDefault(); event.stopPropagation(); disclosure.open = false;
    disclosure.querySelector('summary')?.focus({ preventScroll: true });
  }}>
    <div className={styles.toolbar} aria-label="分析结果操作">
      {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void copy('conclusion')}>复制结论</Button>}
      {children}
      <details className={styles.menu}>
        <summary>更多操作</summary>
        <div className={styles.menuBody}>
          {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void copy('figures')}>复制关键数字</Button>}
          <Button variant="ghost" size="sm" onClick={event => { summaryTrigger.current = event.currentTarget; showSummary(); }}>生成分析摘要</Button>
        </div>
      </details>
    </div>
    {message && <p className={styles.message} role="status">{message}</p>}
    {manualText && <div className={styles.fallback}>
      <label htmlFor={`query-copy-${result.resultId}`}>可手动复制的分析内容</label>
      <textarea ref={manual} id={`query-copy-${result.resultId}`} readOnly value={manualText} rows={6} />
      <Button variant="ghost" size="sm" onClick={() => { manual.current?.focus(); manual.current?.select(); }}>选择全部文字</Button>
      <Button variant="ghost" size="sm" onClick={() => setManualText(null)}>关闭复制内容</Button>
    </div>}
    {summary && <section className={styles.summary} aria-label="市场分析摘要" tabIndex={-1} ref={summaryRef}>
      <div className={styles.summaryHeading}><h3>市场分析摘要</h3><Button variant="ghost" size="sm" onClick={() => { setSummary(null); summaryTrigger.current?.focus(); }}>收起摘要</Button></div>
      <p className={styles.message}>根据本次结果整理；保留原期间、口径与未知项。</p>
      <pre>{summary}</pre>
      {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void copy('summary')}>复制分析摘要</Button>}
    </section>}
  </div>;
}
