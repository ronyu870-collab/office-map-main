'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { formatExact, units } from '@/src/lib/intelligence/query/presentation';
import type { ResearchAnalysis, ResearchPeriod } from '@/src/lib/intelligence/query/researchAnalysisView';
import { metricLabels } from '@/src/lib/intelligence/query/multiMetricView';
import styles from './HomeQuery.module.css';

type SourceAction = (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void;
const periodText = (period: ResearchPeriod['period']) => `${period.year} Q${period.quarter}`;

/** Renders only the deterministic, validated supplement from the saved result.
 * It neither queries data nor calculates new business statistics in the client. */
export function HomeQueryInsights({ research, primaryFindingId, onSource }: { research: ResearchAnalysis; primaryFindingId?: string; onSource: SourceAction }) {
  const [calculationOpen, setCalculationOpen] = React.useState(false);
  const [seriesPage, setSeriesPage] = React.useState(0);
  const findings = research.findings.filter(finding => finding.id !== primaryFindingId);
  const primary = research.findings.find(finding => finding.id === primaryFindingId);
  const metrics = [...new Set(research.series.map(series => series.metric))];
  return <section className={styles.insights} aria-label="分析与样本核查">
    {primary && <Button variant="ghost" onClick={event => onSource(primary.sourceIds, primary.title, event.currentTarget)}>查看结论依据</Button>}
    {metrics.length > 1 ? <>
      {metrics.map(metric => <section key={metric} aria-label={`${metricLabels[metric]}分析`}>
        <FindingList findings={findings.filter(finding => finding.evidence.metric === metric)} onSource={onSource} />
      </section>)}
      <FindingList findings={findings.filter(finding => !metrics.some(metric => finding.evidence.metric === metric))} onSource={onSource} />
    </> : <FindingList findings={findings} onSource={onSource} />}
    <details className={styles.trace} onToggle={event => setCalculationOpen(event.currentTarget.open)}>
      <summary>计算明细、共同样本与异常规则</summary>
      {calculationOpen && <>
        {research.rules.map(rule => <p key={rule.id}>{rule.description}</p>)}
        {research.series.slice(seriesPage * 10, (seriesPage + 1) * 10).map(series => <section className={styles.analysisSeries} key={series.key}>
          <h4>{series.label?.endsWith(` · ${metricLabels[series.metric]}`) ? series.label : `${series.label || '当前范围'} · ${metricLabels[series.metric]}`}</h4>
          <p>全期间共同有效样本 {series.commonEntityIds.length} 栋；分类使用当前楼宇目录。</p>
          <div className={styles.tableScroll} tabIndex={0} aria-label="各期与共同样本计算明细，可横向滚动">
            <table><caption>各期有效样本与全期间共同有效样本（{units[series.unit]}）</caption>
              <thead><tr><th scope="col">季度</th><th scope="col">各期样本值</th><th scope="col">共同样本值</th><th scope="col">各期有效楼宇</th><th scope="col">各期分母（{units[series.perPeriod[0]?.denominatorUnit ?? 'm2']}）</th><th scope="col">逐楼简单平均</th></tr></thead>
              <tbody>{series.perPeriod.map((period, i) => <tr key={periodText(period.period)}>
                <th scope="row">{periodText(period.period)}</th>
                <td className={styles.number}><SourceValue value={period.value} unit={series.unit} sourceIds={period.sourceIds} label={`${periodText(period.period)} 各期有效样本`} onSource={onSource} /></td>
                <td className={styles.number}><SourceValue value={series.commonSample[i]?.value ?? null} unit={series.unit} sourceIds={series.commonSample[i]?.sourceIds ?? []} label={`${periodText(period.period)} 全期间共同样本`} onSource={onSource} /></td>
                <td className={styles.number}>{period.usedCount} 栋</td><td className={styles.number}>{formatExact(period.denominator, period.denominatorUnit)}</td>
                <td className={styles.number}>{period.simpleMean ? formatExact(period.simpleMean, series.unit) : '未知'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {series.anomalyCoverage && !series.anomalyCoverage.complete && <p>本组检测到 {series.anomalyCoverage.detected} 条异常提醒，已列举 {series.anomalyCoverage.returned} 条，另有 {series.anomalyCoverage.omitted} 条因单次结果容量限制未列举；异常提醒不代表数据错误。</p>}
          {series.anomalies.length > 0 && <details className={styles.trace}><summary>查看 {series.anomalies.length} 条异常提醒</summary>
            <AnomalyRecords series={series} onSource={onSource} />
          </details>}
        </section>)}
        {research.series.length > 10 && <div className={styles.actions}>
          <Button variant="ghost" disabled={seriesPage === 0} onClick={() => setSeriesPage(value => value - 1)}>上一组分析对象</Button>
          <Button variant="ghost" disabled={(seriesPage + 1) * 10 >= research.series.length} onClick={() => setSeriesPage(value => value + 1)}>下一组分析对象</Button>
        </div>}
        <ExactEvidence research={research} seriesPage={seriesPage} />
      </>}
    </details>
  </section>;
}

function FindingList({ findings, onSource }: { findings: ResearchAnalysis['findings']; onSource: SourceAction }) {
  const [expanded, setExpanded] = React.useState(false);
  const important = [...findings.filter(finding => finding.kind !== 'method'), ...findings.filter(finding => finding.kind === 'method')];
  const visible = expanded ? important : important.slice(0, 5);
  return <>
    {visible.map(finding => <section key={finding.id} className={styles.finding}>
      <h3>{finding.title}</h3><p>{finding.text}</p>
      {finding.sourceIds.length > 0 && <Button variant="ghost" onClick={event => onSource(finding.sourceIds, finding.title, event.currentTarget)}>查看依据：{finding.title}</Button>}
    </section>)}
    {important.length > 5 && <Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起其他分析' : `查看其余 ${important.length - 5} 项分析`}</Button>}
  </>;
}
function ExactEvidence({ research, seriesPage }: { research: ResearchAnalysis; seriesPage: number }) {
  const [open, setOpen] = React.useState(false);
  return <details className={styles.trace} onToggle={event => setOpen(event.currentTarget.open)}><summary>本组精确计算与检测记录</summary>
    {open && <pre className={styles.auditJson}>{JSON.stringify({ version: research.version, series: research.series.slice(seriesPage * 10, (seriesPage + 1) * 10), rules: research.rules }, null, 2)}</pre>}
  </details>;
}
function SourceValue({ value, unit, sourceIds, label, onSource }: { value: ResearchPeriod['value']; unit: string; sourceIds: readonly string[]; label: string; onSource: SourceAction }) {
  return <button type="button" className={styles.cell} aria-label={`查看来源：${label}`} onClick={event => onSource(sourceIds, label, event.currentTarget)}>{value ? formatExact(value, unit) : '未知：无有效样本'}</button>;
}
function AnomalyRecords({ series, onSource }: { series: ResearchAnalysis['series'][number]; onSource: SourceAction }) {
  const [page, setPage] = React.useState(0);
  const rows = series.anomalies.slice(page * 10, (page + 1) * 10);
  return <>
    {rows.map((record, i) => <div className={styles.finding} key={`${record.rule}/${record.entityId}/${record.period.year}/${record.period.quarter}/${i}`}>
      <p>{record.name} · {periodText(record.period)}：{formatExact(record.value, series.unit)} {units[series.unit]}</p>
      <p>{record.basePeriod && record.baseValue && record.change
        ? `${periodText(record.basePeriod)} 为 ${formatExact(record.baseValue, series.unit)} ${units[series.unit]}；变化 ${formatExact(record.change, record.changeUnit)} ${units[record.changeUnit ?? 'percent']}。检测规则：绝对变化达到 ${record.threshold ? formatExact(record.threshold, record.changeUnit) : '未知'} ${units[record.changeUnit ?? 'percent']}。`
        : `检测规则：1.5×IQR；同组有效样本 ${record.sampleCount} 栋，围栏 ${record.lowerFence ? formatExact(record.lowerFence, series.unit) : '未知'} 至 ${record.upperFence ? formatExact(record.upperFence, series.unit) : '未知'} ${units[series.unit]}。`}</p>
      <Button variant="ghost" onClick={event => onSource(record.sourceIds, `${record.name}异常检测依据`, event.currentTarget)}>查看依据：{record.name}</Button>
    </div>)}
    {series.anomalies.length > 10 && <div className={styles.actions}><Button variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一组提醒</Button><Button variant="ghost" disabled={(page + 1) * 10 >= series.anomalies.length} onClick={() => setPage(value => value + 1)}>下一组提醒</Button></div>}
  </>;
}
