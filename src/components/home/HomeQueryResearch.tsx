'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { HomeQueryDetailContent, useQueryDetail } from './HomeQueryDetailPanel';
import { z } from 'zod';
import { HomeQueryFileAttachment } from './HomeQueryFileAttachment';
import { buildArtifactFilename } from '@/src/lib/intelligence/query/artifactFilename';
import { researchTaskSchema, researchFormats } from '@/src/lib/intelligence/research/protocol';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { chartRequestSchema } from '@/src/lib/intelligence/query/chartSpec';
import { buildResultChart, renderChartSvg } from '@/src/lib/intelligence/query/charts';
import { type QueryClientScope } from '@/src/services/trustedQueryClient';
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
  const detail = useQueryDetail();
  const instanceId = React.useId();
  const detailId = `${result.resultId}-${instanceId}-research`;
  const [opened, setOpened] = React.useState<string[]>([]);
  if (!task) return null;
  return <HomeQueryDetailContent id={detailId}><section aria-label="研究工作集">
    {detail && detail.active?.id !== detailId && <Button variant="ghost" onClick={event => detail.open(detailId, '研究成果', event.currentTarget)}>打开研究成果</Button>}
    <p>{task.spec.submarkets.join('、')} · {task.start.year}Q{task.start.quarter} 至 {task.end.year}Q{task.end.quarter}。</p>
    <p>{task.state === 'reviewed' ? '研究步骤已审查，来源和限制随各部分保留。' : '研究尚未完成；可在当前对话中继续已获权步骤，恢复时重新核对权限。'}</p>
    {!!formats.length && <div aria-label="本条回答生成的研究文件">
      {formats.map(format => requestId && scope ? <HomeQueryFileAttachment key={format} scope={scope} requestId={requestId} resultId={result.resultId}
        internalExport={internalExport} filename={buildArtifactFilename(result, format)} format={format}
        description={`${labels[format]} · 内部研究报告`} label={`${labels[format]} 研究附件`} /> : <p key={format}>{labels[format]} 研究文件已准备</p>)}
    </div>}
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
  </section></HomeQueryDetailContent>;
}
