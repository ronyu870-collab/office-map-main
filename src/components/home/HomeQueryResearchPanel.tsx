'use client';

import * as React from 'react';
import { ArrowUpRight, Database, X } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { IconButton } from '@/src/components/ui/IconButton';
import { resultScopeText, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { resultBuildingRows } from '@/src/lib/intelligence/query/buildingCards';
import { researchAnalysisSchema } from '@/src/lib/intelligence/query/researchAnalysisView';
import { SourceOverview } from './HomeQueryResult';
import styles from './HomeQueryResearchPanel.module.css';

const tableNames: Record<string, string> = {
  buildings: '楼宇目录', building_brochure_data: '楼书参数', building_metrics: '季度指标',
};

/** Reads only the already-authorized result. This companion never opens another
 * data connection, changes a query, or substitutes current values for a snapshot. */
export function HomeQueryResearchPanel({ result, onClose, onViewSources }: { result: QueryResultView; onClose?: () => void; onViewSources?: () => void }) {
  const information = React.useMemo(() => {
    const names = [...new Set(resultBuildingRows(result).map(row => row.name))];
    const tables = new Map<string, Set<string>>();
    for (const source of result.sources) {
      const records = tables.get(source.table) ?? new Set<string>();
      records.add(source.recordId); tables.set(source.table, records);
    }
    const research = researchAnalysisSchema.safeParse(result.parameters.researchAnalysis);
    const knownSources = new Set(result.sources.map(source => source.id));
    return { names, tables: [...tables].map(([table, records]) => ({ table, count: records.size })),
      research: research.success && research.data.findings.every(finding => finding.sourceIds.every(id => knownSources.has(id))) ? research.data : null };
  }, [result]);
  return <aside className={styles.panel} aria-label="研究资料与口径">
    <div className={styles.heading}><h3>研究资料</h3>{onClose && <IconButton variant="ghost" label="关闭研究资料" onClick={onClose}><X size={16} aria-hidden="true" /></IconButton>}</div>
    <div className={styles.content}>
    <section className={styles.section} aria-label="当前分析范围"><h4>当前分析范围</h4><p>{resultScopeText(result)}</p></section>
    <section className={styles.section} aria-label="来源概览"><h4>来源概览</h4>
      {information.tables.length ? <ul className={styles.sources}>{information.tables.map(item => <li key={item.table}><Database size={16} aria-hidden="true" /><span>{tableNames[item.table] ?? '其他获权来源'}</span><span>{item.count} 条</span></li>)}</ul> : <p>本次结果没有可展示的来源记录。</p>}
      <p className={styles.note}>候选来源含未参与计算的记录；具体数值的计算依据可在回答中逐项查看。</p>
      {onViewSources && <Button variant="ghost" size="sm" className={styles.sourceAction} onClick={onViewSources}>查看来源明细<ArrowUpRight size={16} aria-hidden="true" /></Button>}
    </section>
    <section className={styles.section} aria-label="统计口径"><h4>数据与统计口径</h4><SourceOverview result={result} research={information.research} /></section>
    {information.names.length > 0 && <section className={styles.section} aria-label="相关楼宇"><h4>相关楼宇</h4>
      <ul className={styles.buildings}>{information.names.slice(0, 8).map(name => <li key={name}>{name}</li>)}</ul>
      {information.names.length > 8 && <p className={styles.note}>另有 {information.names.length - 8} 栋，完整项目见回答中的楼宇与明细。</p>}
    </section>}
    <section className={styles.section} aria-label="结果时间"><h4>结果时间</h4>
      <time dateTime={result.createdAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.createdAt))}（北京时间）</time>
      <p className={styles.note}>这是查询快照的保存时间，不等于业务截至日期。历史结果不代表最新市场数据。</p>
    </section>
    {!!result.limitations.length && <section className={styles.section} aria-label="使用限制"><h4>使用限制</h4>{result.limitations.map(line => <p key={line}>{line}</p>)}</section>}
    </div>
  </aside>;
}
