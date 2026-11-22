'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { resultBuildingRows } from '@/src/lib/intelligence/query/buildingCards';
import { queryMapHref } from '@/src/lib/intelligence/query/buildingNavigation';
import { tableCellText, tableRowIndexes, type TableSort } from '@/src/lib/intelligence/query/tableView';
import { units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryDownload } from './useQueryDownload';
import styles from './HomeQueryDataTable.module.css';

type Props = { result: QueryResultView; requestId?: string; scope?: QueryClientScope; internalExport: boolean;
  onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void; onPage?: (page: number) => void };
const PAGE_SIZE = 25;
export const HomeQueryDataTable = React.memo(function HomeQueryDataTable(props: Props) {
  return <DataTable key={props.result.resultId} {...props} />;
});
function DataTable({ result, requestId, scope, internalExport, onSource, onPage }: Props) {
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<TableSort>(null);
  const [page, setPage] = React.useState(0);
  const [filter, setFilter] = React.useState<{ key: string; value: string } | null>(null);
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
  const [hiddenColumns, setHiddenColumns] = React.useState<ReadonlySet<string>>(new Set());
  const allSelected = React.useRef<HTMLInputElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const columns = result.table.columns.filter(column => !hiddenColumns.has(column.key));
  const deferredSearch = React.useDeferredValue(search);
  const indexes = React.useMemo(() => tableRowIndexes(result, deferredSearch, filter, sort), [result, deferredSearch, filter, sort]);
  const buildings = React.useMemo(() => new Set(resultBuildingRows(result).map(building => building.id)), [result]);
  const filterOptions = React.useMemo(() => result.table.columns.filter(column => ['submarket', 'grade', 'district'].includes(column.key)).map(column => ({
    ...column, values: [...new Set(result.table.rows.map(row => tableCellText(row.cells[column.key], column.key, column.unit)))].sort(),
  })), [result]);
  const selectedInView = indexes.filter(index => selected.has(index)).length;
  React.useEffect(() => { if (allSelected.current) allSelected.current.indeterminate = selectedInView > 0 && selectedInView < indexes.length; }, [indexes.length, selectedInView]);
  // Menus are per table, without per-row listeners. Escape closes locally.
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) root.current?.querySelectorAll('details[open]').forEach(node => (node as HTMLDetailsElement).open = false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  function changePage(next: number) { setPage(next); onPage?.(next); }
  const canSelect = ['list', 'rank'].includes(result.operation) && !result.parameters.agentReport && !result.parameters.researchTask;
  const pageCount = Math.max(1, Math.ceil(indexes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = indexes.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return <div ref={root} className={styles.root} onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    const menu = event.target instanceof HTMLElement ? event.target.closest('details[open]') : null;
    if (menu instanceof HTMLDetailsElement) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary')?.focus(); }
  }}>
    <div className={styles.toolbar} aria-label="结果表格工具栏">
      <label className={styles.search}><Search size={16} aria-hidden="true" /><span className="sr-only">搜索本次结果</span>
        <input value={search} type="search" placeholder="搜索本次结果" onChange={event => { setSearch(event.target.value); changePage(0); }} /></label>
      {filterOptions.length > 0 && <label><span className="sr-only">筛选本次结果</span><select aria-label="筛选本次结果" value={filter ? JSON.stringify(filter) : ''} onChange={event => {
        setFilter(event.target.value ? JSON.parse(event.target.value) : null); changePage(0);
      }}><option value="">全部分类</option>{filterOptions.map(column => <optgroup label={column.label} key={column.key}>{column.values.map(value =>
        <option key={value} value={JSON.stringify({ key: column.key, value })}>{column.label}：{value}</option>)}</optgroup>)}</select></label>}
      <details className={styles.menu}><summary>显示字段</summary><div className={styles.menuBody}>{result.table.columns.map(column => <label key={column.key}>
        <input type="checkbox" checked={!hiddenColumns.has(column.key)} disabled={!hiddenColumns.has(column.key) && columns.length === 1}
          onChange={() => setHiddenColumns(current => { const next = new Set(current); if (next.has(column.key)) next.delete(column.key); else next.add(column.key); return next; })} />{column.label}</label>)}</div></details>
      {canSelect && requestId && <Link className={styles.mapLink} href={queryMapHref(requestId)} prefetch={false}>在地图中查看</Link>}
      {requestId && scope && internalExport && canSelect && <TableExport result={result} requestId={requestId} scope={scope} filtered={indexes} selected={selected} />}
    </div>
    {(search || filter || selected.size > 0) && <div className={styles.selection} role="status">
      <span>筛选 {indexes.length} / {result.table.rows.length} 条{selected.size > 0 ? `，已选 ${selected.size} 条` : ''}</span>
      {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>}
    </div>}
    <div className={styles.scroll} role="region" tabIndex={0} aria-label="查询结果表，可横向滚动">
      <table><caption className="sr-only">本次结果的完整表格，分页不改变统计范围</caption>
        <thead><tr>{canSelect && <th className={styles.check}><label className={styles.checkTarget}><input ref={allSelected} type="checkbox" aria-label="全选筛选结果" checked={indexes.length > 0 && selectedInView === indexes.length} disabled={!indexes.length}
          onChange={event => setSelected(current => { const next = new Set(current); indexes.forEach(index => event.target.checked ? next.add(index) : next.delete(index)); return next; })} /></label></th>}
          {columns.map(column => <th scope="col" key={column.key} aria-sort={sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" onClick={() => { setSort({ key: column.key, direction: sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc' }); changePage(0); }}>
              {column.label}{column.unit ? `（${units[column.unit] ?? column.unit}）` : ''}
              {sort?.key === column.key && (sort.direction === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />)}</button>
          </th>)}</tr></thead>
        <tbody>{shown.map(index => {
          const row = result.table.rows[index];
          const rowName = row.cells.name?.kind === 'text' ? row.cells.name.value : `第 ${index + 1} 条`;
          return <tr key={index} data-selected={selected.has(index)}>
            {canSelect && <td className={styles.check}><label className={styles.checkTarget}><input type="checkbox" aria-label={`选择${rowName}`} checked={selected.has(index)}
              onChange={() => setSelected(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })} /></label></td>}
            {columns.map(column => { const cell = row.cells[column.key]; const value = tableCellText(cell, column.key, column.unit);
              return <td key={column.key} className={cell.kind === 'number' ? styles.number : undefined} title={value}>
                {column.key === 'name' && requestId && buildings.has(row.entityId)
                  ? <Link className={styles.buildingLink} href={queryMapHref(requestId, row.entityId, true)} prefetch={false}>{value}</Link>
                  : <button type="button" className={styles.cell} aria-label={`查看来源：${column.label} ${value}`} onClick={event => onSource(cell.sourceIds, `${column.label}：${value}`, event.currentTarget)}>{value}</button>}
              </td>; })}
          </tr>;
        })}{!shown.length && <tr><td colSpan={columns.length + (canSelect ? 1 : 0)}>没有匹配的记录，可清除搜索或筛选。</td></tr>}</tbody>
      </table>
    </div>
    <div className={styles.footer}><span>第 {indexes.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, indexes.length)} 条，共 {indexes.length} 条</span>
      {indexes.length > PAGE_SIZE && <div><Button variant="ghost" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>上一页</Button>
        <Button variant="ghost" disabled={currentPage + 1 >= pageCount} onClick={() => changePage(currentPage + 1)}>下一页</Button></div>}</div>
    {selected.size > 3000 && <p role="status">单次范围导出最多 3,000 条；可减少选择或导出全部正式结果。</p>}
    <p className={styles.scope}>搜索、排序与筛选作用于本次返回的 {result.table.rows.length} 条记录。</p>
  </div>;
}
function TableExport({ result, requestId, scope, filtered, selected }: { result: QueryResultView; requestId: string; scope: QueryClientScope; filtered: number[]; selected: ReadonlySet<number> }) {
  const { busy, message, download } = useQueryDownload(scope, requestId, result.resultId);
  return <div className={styles.export}><details className={styles.menu}><summary>导出表格</summary><div className={styles.menuBody}>
    {(['xlsx', 'csv_zip'] as const).map(format => <React.Fragment key={format}>
      <Button variant="ghost" disabled={busy} onClick={() => void download({ format })}>{format === 'xlsx' ? 'Excel' : 'CSV 与来源'} · 全部结果</Button>
      <Button variant="ghost" disabled={busy || !filtered.length || filtered.length > 3000} onClick={() => void download({ format, selection: { kind: 'filtered', rowIndexes: filtered } })}>{format === 'xlsx' ? 'Excel' : 'CSV'} · 当前筛选 {filtered.length} 条</Button>
      <Button variant="ghost" disabled={busy || !selected.size || selected.size > 3000} onClick={() => void download({ format, selection: { kind: 'selected', rowIndexes: [...selected].sort((a, b) => a - b) } })}>{format === 'xlsx' ? 'Excel' : 'CSV'} · 已选 {selected.size} 条</Button>
    </React.Fragment>)}
  </div></details>{message && <span role="status">{message}</span>}</div>;
}
