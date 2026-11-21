'use client';

import * as React from 'react';
import { z } from 'zod';
import { Button } from '@/src/components/ui/Button';
import { researchTaskSchema, researchFormats } from '@/src/lib/intelligence/research/protocol';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { chartRequestSchema } from '@/src/lib/intelligence/query/chartSpec';
import { buildResultChart, renderChartSvg } from '@/src/lib/intelligence/query/charts';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import styles from './HomeQuery.module.css';

const sectionsSchema = z.array(z.object({ result: resultViewSchema, chart: chartRequestSchema.nullable() })).max(8);
const labels = { pdf: 'PDF', xlsx: 'Excel', docx: 'Word', pptx: 'PowerPoint' };
export function HomeQueryResearch({ result, requestId, scope, internalExport, renderResult }: {
  result: QueryResultView; requestId?: string; scope?: QueryClientScope; internalExport: boolean;
  renderResult: (result: QueryResultView) => React.ReactNode;
}) {
  const task = researchTaskSchema.safeParse(result.parameters.researchTask).data;
  const sections = sectionsSchema.safeParse(result.parameters.researchSections).data ?? [];
  const formats = z.array(z.enum(researchFormats)).safeParse(result.parameters.researchDeliverables).data ?? [];
  const [opened, setOpened] = React.useState<string[]>([]);
  const [message, setMessage] = React.useState(''), [busy, setBusy] = React.useState(false);
  const active = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { active.current?.abort(); }, [result.resultId, requestId, scope?.actorId, scope?.effectiveId, scope?.sessionId, scope?.targetId]);
  if (!task) return null;
  async function download(format: typeof researchFormats[number]) {
    if (!requestId || !scope || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setMessage('正在重新核对权限并取得研究文件…');
    try {
      const file = await trustedQueryClient.download(scope, { requestId, resultId: result.resultId, action: 'export', format }, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      void trustedQueryClient.reportDelivery(scope, file, 'browser_download_dispatched');
      setMessage('浏览器已发起下载；尚未确认文件已实际保存。仅供内部研究。');
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '下载未完成，请重试。'); }
    finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }
  return <section aria-label="研究工作集">
    <p>{task.spec.submarkets.join('、')} · {task.start.year}Q{task.start.quarter} 至 {task.end.year}Q{task.end.quarter}。</p>
    <p>{task.state === 'reviewed' ? '研究步骤已审查，来源和限制随各部分保留。' : '研究尚未完成；可在当前对话中继续已获权步骤，恢复时重新核对权限。'}</p>
    {!!formats.length && <div className={styles.actions} aria-label="本条回答生成的研究文件">
      <span>服务器已生成内部研究文件：</span>
      {formats.map(format => internalExport && requestId && scope
        ? <Button key={format} variant="ghost" disabled={busy} onClick={() => void download(format)}>下载 {labels[format]}</Button>
        : <span key={format}>{labels[format]}</span>)}
    </div>}
    <p role="status">{message}</p>
    {sections.map(section => {
      const step = task.steps.find(s => s.resultId === section.result.resultId);
      const expanded = opened.includes(section.result.resultId);
      let svg: string | null = null;
      if (expanded && section.chart) { try { svg = renderChartSvg(buildResultChart(section.result, section.chart)); } catch { /* Complete table remains available. */ } }
      return <details key={section.result.resultId} onToggle={event => {
        const open = event.currentTarget.open;
        setOpened(previous => open ? [...new Set([...previous, section.result.resultId])] : previous.filter(id => id !== section.result.resultId));
      }}>
        <summary>{step?.title ?? '正式研究结果'}</summary>
        {expanded && <>
          {svg && <div role="img" aria-label={`${step?.title ?? '研究结果'}图表`} className={styles.tableScroll} dangerouslySetInnerHTML={{ __html: svg }} />}
          {renderResult(section.result)}
        </>}
      </details>;
    })}
  </section>;
}
