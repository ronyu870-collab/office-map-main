'use client';

import * as React from 'react';
import { Check, Copy, FileText, MoreHorizontal } from 'lucide-react';
import { HomeQueryMenu, queryActionFocus } from './HomeQueryMenu';
import { PitchHandoffLink, readPitchAnalysisPeriods, usePitchAnalysisReplay } from '@/src/components/pitch/PitchHandoffLink';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { renderResultCopy, type ResultCopyFormat } from '@/src/lib/intelligence/query/resultOutput';
import { planSchema } from '@/src/lib/intelligence/query/plan';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import styles from './HomeQueryResultActions.module.css';

type Props = { result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean; children?: React.ReactNode; responseActions?: React.ReactNode };

export function HomeQueryResultActions(props: Props) {
  // A new identity/result always disposes clipboard requests and old fallback text.
  return <ResultActions key={JSON.stringify([props.scope, props.requestId, props.result.resultId, props.internalExport])} {...props} />;
}

function ResultActions({ result, requestId, scope, internalExport, children, responseActions }: Props) {
  const analysisReplay = usePitchAnalysisReplay();
  const archivedPlan = analysisReplay ? planSchema.safeParse(result.parameters.executedPlan) : undefined;
  const replayedPlan = archivedPlan?.success && archivedPlan.data.operation === result.operation ? archivedPlan.data : undefined;
  const replayUnsupported = result.parameters.dataDomain || result.parameters.exportPlans;
  const legacyPeriod = readPitchAnalysisPeriods({ period: result.parameters.period }).end;
  const replayable = analysisReplay && !replayUnsupported && (!!replayedPlan ||
    result.parameters.executedPlan === undefined && (result.operation === 'list' || result.operation === 'aggregate'));
  const pitchPeriod = replayable ? readPitchAnalysisPeriods(replayedPlan ?? result.parameters).end : legacyPeriod;
  const canHandoff = internalExport && !replayUnsupported && (replayable || !analysisReplay &&
    (result.operation === 'list' || (result.operation === 'aggregate' || result.operation === 'compare') && !!pitchPeriod));
  const copyId = React.useId();
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

  return <div className={styles.root}>
    <div className={styles.toolbar} aria-label="分析结果操作">
      {internalExport && <Button variant="ghost" size="sm" loading={busy} loadingLabel="复制中…" onClick={event => void copy('conclusion', event.currentTarget)}>{copySucceeded ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}复制结论</Button>}
      {children}
      <HomeQueryMenu label={<><MoreHorizontal size={16} aria-hidden="true" />更多操作</>}>
          {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={event => void copy('table', event.currentTarget)}>复制结果表格</Button>}
          {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={event => void copy('figures', event.currentTarget)}><Copy size={16} aria-hidden="true" />复制关键数字</Button>}
          <Button variant="ghost" size="sm" onClick={event => { summaryTrigger.current = event.currentTarget; showSummary(); }}><FileText size={16} aria-hidden="true" />生成分析摘要</Button>
          {canHandoff && <PitchHandoffLink source={{ kind: 'analysis-result', id: requestId,
            ...(replayable ? { resultId: result.resultId } : {}) }} period={pitchPeriod}
            className={styles.handoffAction} label={pitchPeriod ? "将分析结果加入 Pitch" : "将分析中的楼宇加入 Pitch"} />}
          {responseActions}
      </HomeQueryMenu>
    </div>
    {message && <p className={styles.message} role="status">{message}</p>}
    {manualText && <div className={styles.fallback}>
      <label htmlFor={copyId}>可手动复制的分析内容</label>
      <textarea ref={manual} id={copyId} readOnly value={manualText} rows={6} />
      <Button variant="ghost" size="sm" onClick={() => { manual.current?.focus(); manual.current?.select(); }}>选择全部文字</Button>
      <Button variant="ghost" size="sm" onClick={() => { setManualText(null); queryActionFocus(copyTrigger.current); }}>关闭复制内容</Button>
    </div>}
    {summary && <section className={styles.summary} aria-label="市场分析摘要" tabIndex={-1} ref={summaryRef}>
      <div className={styles.summaryHeading}><h3>市场分析摘要</h3><Button variant="ghost" size="sm" onClick={() => { setSummary(null); queryActionFocus(summaryTrigger.current); }}>收起摘要</Button></div>
      <p className={styles.message}>根据本次结果整理；保留原期间、口径与未知项。</p>
      <pre>{summary}</pre>
      {internalExport && <Button variant="ghost" size="sm" disabled={busy} onClick={event => void copy('summary', event.currentTarget)}>复制分析摘要</Button>}
    </section>}
  </div>;
}
