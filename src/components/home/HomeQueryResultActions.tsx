'use client';

import * as React from 'react';
import { Copy, FileText, MoreHorizontal } from 'lucide-react';
import { HomeQueryMenu } from './HomeQueryMenu';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { renderResultCopy, type ResultCopyFormat } from '@/src/lib/intelligence/query/resultOutput';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import styles from './HomeQueryResultActions.module.css';

type Props = { result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean; children?: React.ReactNode; responseActions?: React.ReactNode };

export function HomeQueryResultActions(props: Props) {
  // A new identity/result always disposes clipboard requests and old fallback text.
  return <ResultActions key={JSON.stringify([props.scope, props.requestId, props.result.resultId, props.internalExport])} {...props} />;
}

function ResultActions({ result, requestId, scope, internalExport, children, responseActions }: Props) {
  const copyId = React.useId();
  const root = React.useRef<HTMLDivElement>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [copySucceeded, setCopySucceeded] = React.useState(false);
  const [manualText, setManualText] = React.useState<string | null>(null);
  const active = React.useRef<AbortController | null>(null);
  const manual = React.useRef<HTMLTextAreaElement>(null);
  const summaryRef = React.useRef<HTMLElement>(null);
  const summaryTrigger = React.useRef<HTMLButtonElement>(null);
  const copyTrigger = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => () => active.current?.abort(), []);
  React.useEffect(() => {
    if (!copySucceeded) return;
    const timer = window.setTimeout(() => { setMessage(''); setCopySucceeded(false); }, 3000);
    return () => window.clearTimeout(timer);
  }, [copySucceeded]);
  React.useEffect(() => { if (summary) summaryRef.current?.focus({ preventScroll: true }); }, [summary]);
  React.useEffect(() => {
    const element = root.current;
    if (!element) return;
    const keepSingleDisclosure = (event: Event) => {
      const opened = event.target;
      if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
      element.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(disclosure => {
        if (disclosure !== opened) disclosure.open = false;
      });
    };
    const dismiss = (event: PointerEvent) => { if (!element.contains(event.target as Node)) element.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu => { menu.open = false; }); };
    document.addEventListener('pointerdown', dismiss);
    element.addEventListener('toggle', keepSingleDisclosure, true);
    return () => { document.removeEventListener('pointerdown', dismiss); element.removeEventListener('toggle', keepSingleDisclosure, true); };
  }, []);

  async function copy(format: ResultCopyFormat, trigger: HTMLButtonElement) {
    if (!internalExport || active.current) return;
    copyTrigger.current = trigger;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setCopySucceeded(false); setMessage('正在复制…'); setManualText(null);
    try {
      const output = await trustedQueryClient.copy(scope, { requestId, resultId: result.resultId, action: 'copy', format }, controller.signal);
      if (controller.signal.aborted) return;
      // The original immutable result must be exactly the one being viewed.
      if (output.resultId !== result.resultId || output.text !== renderResultCopy(result, format)) throw new Error('复制内容与当前结果不一致，请重新打开历史快照。');
      try {
        if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(output.text);
        if (!controller.signal.aborted) { setCopySucceeded(true); setMessage(format === 'table' ? '已复制结果表格。' : format === 'figures' ? '已复制关键数字。' : format === 'summary' ? '已复制分析摘要。' : '已复制结论。'); }
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

  function restoreActionFocus(trigger: HTMLButtonElement | null) {
    const disclosure = trigger?.closest('details');
    const destination = disclosure && !disclosure.open ? disclosure.querySelector('summary') : trigger;
    destination?.focus({ preventScroll: true });
  }

  return <div ref={root} className={styles.root} onKeyDown={event => {
    // Close the local disclosure first; Escape must not also close the workspace.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const disclosure = event.target instanceof HTMLElement ? event.target.closest('details[open]') : null;
    if (!(disclosure instanceof HTMLDetailsElement) || !event.currentTarget.contains(disclosure)) return;
    event.preventDefault(); event.stopPropagation(); disclosure.open = false;
    disclosure.querySelector('summary')?.focus({ preventScroll: true });
  }}>
    <div className={styles.toolbar} aria-label="分析结果操作">
      {internalExport && <Button variant="ghost" size="sm" disabled={busy} aria-busy={busy} onClick={event => void copy('conclusion', event.currentTarget)}><Copy size={16} aria-hidden="true" />复制结论</Button>}
      {children}
      <HomeQueryMenu label={<><MoreHorizontal size={16} aria-hidden="true" />更多操作</>}>
          {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={event => void copy('table', event.currentTarget)}>复制结果表格</Button>}
          {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={event => void copy('figures', event.currentTarget)}><Copy size={16} aria-hidden="true" />复制关键数字</Button>}
          <Button variant="ghost" size="sm" onClick={event => { summaryTrigger.current = event.currentTarget; showSummary(); }}><FileText size={16} aria-hidden="true" />生成分析摘要</Button>
          {responseActions}
      </HomeQueryMenu>
    </div>
    {message && <p className={styles.message} role="status">{message}</p>}
    {manualText && <div className={styles.fallback}>
      <label htmlFor={copyId}>可手动复制的分析内容</label>
      <textarea ref={manual} id={copyId} readOnly value={manualText} rows={6} />
      <Button variant="ghost" size="sm" onClick={() => { manual.current?.focus(); manual.current?.select(); }}>选择全部文字</Button>
      <Button variant="ghost" size="sm" onClick={() => { setManualText(null); restoreActionFocus(copyTrigger.current); }}>关闭复制内容</Button>
    </div>}
    {summary && <section className={styles.summary} aria-label="市场分析摘要" tabIndex={-1} ref={summaryRef}>
      <div className={styles.summaryHeading}><h3>市场分析摘要</h3><Button variant="ghost" size="sm" onClick={() => { setSummary(null); restoreActionFocus(summaryTrigger.current); }}>收起摘要</Button></div>
      <p className={styles.message}>根据本次结果整理；保留原期间、口径与未知项。</p>
      <pre>{summary}</pre>
      {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={event => void copy('summary', event.currentTarget)}>复制分析摘要</Button>}
    </section>}
  </div>;
}
