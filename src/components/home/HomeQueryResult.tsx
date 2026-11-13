'use client';

import * as React from 'react';
import { Button } from '@/src/components/ui/Button';
import { cellText, resultScopeText, resultSummary, units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import { HomeQueryArtifacts } from './HomeQueryArtifacts';
import styles from './HomeQuery.module.css';

export function HomeQueryResult({ result, requestId, scope, delivery, internalExport = false }: { result: QueryResultView; requestId?: string; scope?: QueryClientScope; delivery?: object; internalExport?: boolean }) {
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<{ ids: readonly string[]; label: string } | null>(null);
  const [sourcePage, setSourcePage] = React.useState(0);
  const sourcePanel = React.useRef<HTMLElement>(null);
  const returnFocus = React.useRef<HTMLButtonElement | null>(null);
  const rows = result.table.rows.slice(page * 25, (page + 1) * 25);
  const sourceMap = React.useMemo(() => new Map(result.sources.map(source => [source.id, source])), [result]);
  const sources = selected ? selected.ids.flatMap(id => sourceMap.has(id) ? [sourceMap.get(id)!] : []) : [];
  useQueryPresentationReceipt(scope, delivery, { surface: 'answer_table', page, pageSize: 25, sourceIds: sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => source.id) });
  function showSources(ids: readonly string[], label: string, trigger: HTMLButtonElement) {
    returnFocus.current = trigger; setSelected({ ids: [...new Set(ids)], label }); setSourcePage(0);
  }
  React.useEffect(() => {
    if (!selected) return;
    // This focus change follows an explicit source action, never a query result
    // refresh. Keep the expanded details visible without moving the composer.
    sourcePanel.current?.focus({ preventScroll: true });
    sourcePanel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return <section className={styles.result} aria-label="查询结果">
    <div className={styles.answer}>
      <p className={styles.scope}>{resultScopeText(result)}</p>
      {resultSummary(result).map((line, index) => <p key={line} className={index === 0 ? styles.conclusion : undefined}>{line}</p>)}
    </div>
    {requestId && scope && <HomeQueryArtifacts result={result} requestId={requestId} scope={scope} internalExport={internalExport} onSource={showSources} />}
    {result.table.rows.length > 0 && <>
      <div className={styles.tableScroll} tabIndex={0} aria-label="查询结果表，可横向滚动">
        <table><caption className="sr-only">本次结果的完整表格，分页不改变统计范围</caption><thead><tr>{result.table.columns.map(column =>
          <th key={column.key} scope="col" className={column.unit ? styles.number : undefined}>{column.label}{column.unit ? `（${units[column.unit] ?? column.unit}）` : ''}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.entityId}>{result.table.columns.map(column => {
            const cell = row.cells[column.key];
            const value = cellText(cell, column.unit);
            return <td key={column.key} className={cell.kind === 'number' ? styles.number : undefined}>
              <button type="button" className={styles.cell} aria-label={`查看来源：${column.label} ${value}`}
                onClick={event => showSources(cell.sourceIds, `${column.label}：${value}`, event.currentTarget)}>{value}</button>
            </td>;
          })}</tr>)}</tbody></table>
      </div>
      <div className={styles.tableFooter}><p>第 {page * 25 + 1}–{Math.min((page + 1) * 25, result.table.rows.length)} 条，共 {result.table.rows.length} 条。点选单元格查看来源。</p>
        {result.table.rows.length > 25 && <div className={styles.actions}>
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
          <Button variant="ghost" disabled={(page + 1) * 25 >= result.table.rows.length} onClick={() => setPage(value => value + 1)}>下一页</Button>
        </div>}
      </div>
    </>}
    <div className={styles.limitations}>{result.limitations.map(line => <p key={line}>{line}</p>)}</div>
    <details className={styles.trace}>
      <summary>来源、口径与结果版本</summary>
      <p>结果生成于 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(result.createdAt))}（北京时间）。恢复结果保留原快照，不代表最新数据。</p>
      <dl><dt>结果编号</dt><dd>{result.resultId}</dd><dt>数据版本</dt><dd>{result.dataVersion}</dd><dt>字段口径</dt><dd>{result.registryVersion}</dd></dl>
      <Button variant="secondary" onClick={event => showSources(result.sources.map(source => source.id), '全部获权候选来源（含未参与计算的记录）', event.currentTarget)}>查看全部来源</Button>
    </details>
    {selected && <section ref={sourcePanel} tabIndex={-1} className={styles.sources} aria-label="来源详情">
      <div className={styles.sourceHeading}><h3>{selected.label}</h3><Button variant="ghost" onClick={() => { setSelected(null); returnFocus.current?.focus(); }}>关闭来源</Button></div>
      {!sources.length ? <p>该值没有可关联的来源记录；不能据此给出确定数值。</p> : <>
        {sources.slice(sourcePage * 10, (sourcePage + 1) * 10).map(source => <dl className={styles.source} key={source.id}>
          <dt>数据库位置</dt><dd>{source.table} / {source.recordId} / {source.field}</dd>
          <dt>原始记录值</dt><dd>{source.rawValue === null || source.rawValue === undefined ? '未填写' : typeof source.rawValue === 'string' ? source.rawValue : JSON.stringify(source.rawValue)}</dd>
          <dt>期间与单位</dt><dd>{source.period ? `${source.period.year} 年第 ${source.period.quarter} 季度` : '不属于季度指标'}；{units[source.unit] ?? source.unit}</dd>
          <dt>原始资料</dt><dd>{source.original ? `${source.original.documentId}，版本 ${source.original.version}${source.original.page ? `，第 ${source.original.page} 页` : ''}${source.original.sheet ? `，表 ${source.original.sheet}` : ''}${source.original.row ? `，第 ${source.original.row} 行` : ''}` : '尚未关联原件，仅能溯源到数据库记录。'}</dd>
          <dt>核验状态</dt><dd>{{ database_only: '仅数据库记录', verified_original: '已核验原件', unreviewed: '未核验', historical: '历史来源' }[source.verification]}</dd>
          <dt>业务截至</dt><dd>{source.businessAsOf ?? '未知，不能用入库时间替代。'}</dd>
          <dt>记录版本</dt><dd>{source.recordVersion}</dd>
        </dl>)}
        <div className={styles.tableFooter}><p>来源 {sourcePage * 10 + 1}–{Math.min((sourcePage + 1) * 10, sources.length)}，共 {sources.length} 条</p>
          {sources.length > 10 && <div className={styles.actions}><Button variant="ghost" disabled={!sourcePage} onClick={() => setSourcePage(value => value - 1)}>上一组来源</Button><Button variant="ghost" disabled={(sourcePage + 1) * 10 >= sources.length} onClick={() => setSourcePage(value => value + 1)}>下一组来源</Button></div>}
        </div>
      </>}
    </section>}
  </section>;
}
