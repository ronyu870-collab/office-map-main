'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { resultMapEligible, resultTablePolicy } from '@/src/lib/intelligence/query/resultEligibility';
import { resultAvailability } from '@/src/lib/intelligence/query/resultAvailability';
import { resultBuildingRows } from '@/src/lib/intelligence/query/buildingCards';
import { queryMapHref } from '@/src/lib/intelligence/query/buildingNavigation';
import { tableCellText, tableRowIndexes, restoredResultTableView, type TableSort, type TableFilter } from '@/src/lib/intelligence/query/tableView';
import { units, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { HomeQueryMenu } from './HomeQueryMenu';
import { HomeQueryDetailContent, useQueryDetail } from './HomeQueryDetailPanel';
import { useQueryDownload } from './useQueryDownload';
import styles from './HomeQueryDataTable.module.css';

type Props = { result: QueryResultView; requestId?: string; scope?: QueryClientScope; internalExport: boolean;
  onSource: (ids: readonly string[], label: string, trigger: HTMLButtonElement) => void; onPage?: (page: number) => void; preview?: boolean; statusShown?: boolean };
export const HomeQueryDataTable = React.memo(function HomeQueryDataTable(props: Props) {
  return <DataTable key={props.result.resultId} {...props} />;
});
function DataTable({ result, requestId, scope, internalExport, onSource, onPage, preview = false, statusShown = false }: Props) {
  const [search, setSearch] = React.useState('');
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [initialView] = React.useState(() => restoredResultTableView(result));
  const [sort, setSort] = React.useState<TableSort>(initialView.sort);
  const [page, setPage] = React.useState(initialView.page);
  const [filters, setFilters] = React.useState<readonly TableFilter[]>(initialView.filters);
  const detail = useQueryDetail();
  const instanceId = React.useId();
  const detailId = `${result.resultId}-${instanceId}-table`;
  const expanded = detail?.active?.id === detailId;
  const PAGE_SIZE = preview && !expanded && !result.parameters.agentTableView ? 8 : 25;
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
  const [hiddenColumns, setHiddenColumns] = React.useState<ReadonlySet<string>>(new Set());
  const allSelected = React.useRef<HTMLInputElement>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const scrollPosition = React.useRef({ top: 0, left: 0 });
  React.useLayoutEffect(() => {
    const scroller = root.current?.querySelector('[data-table-scroll]');
    if (scroller) { scroller.scrollTop = scrollPosition.current.top; scroller.scrollLeft = scrollPosition.current.left; }
  }, [expanded]);
  const allColumns = result.table.columns.filter(column => !hiddenColumns.has(column.key));
  const deferredSearch = React.useDeferredValue(search);
  const indexes = React.useMemo(() => tableRowIndexes(result, deferredSearch, filters, sort), [result, deferredSearch, filters, sort]);
  const buildings = React.useMemo(() => new Set(resultBuildingRows(result).map(building => building.id)), [result]);
  const filterOptions = React.useMemo(() => result.table.columns.filter(column => ['submarket', 'grade', 'district'].includes(column.key)).map(column => ({
    ...column, values: [...new Set(result.table.rows.map(row => tableCellText(row.cells[column.key], column.key, column.unit)))].sort(),
  })), [result]);
  const selectedInView = indexes.filter(index => selected.has(index)).length;
  React.useEffect(() => { if (allSelected.current) allSelected.current.indeterminate = selectedInView > 0 && selectedInView < indexes.length; }, [indexes.length, selectedInView]);
  function changePage(next: number) { setPage(next); onPage?.(next); }
  const availability = resultAvailability(result);
  const policy = resultTablePolicy(result, expanded);
  const fullControls = !availability && (policy.controls || toolsOpen || selected.size > 0 || filters.length > 0 || hiddenColumns.size > 0 || !!search);
  const compactTrend = !fullControls && !expanded && result.operation === 'trend' && result.table.rows.length <= 10
    && !result.parameters.metrics && !result.parameters.agentTableView;
  // Only omit a duplicated count, never a differently scoped count. Full
  // controls restore every original column; export uses the original result.
  const duplicateCount = result.table.rows.every(row => row.cells.usedCount?.kind === 'number' && row.cells.availableCount?.kind === 'number'
    && row.cells.usedCount.value.numeric === row.cells.availableCount.value.numeric);
  const columns = compactTrend && duplicateCount ? allColumns.filter(column => column.key !== 'availableCount') : allColumns;
  const canSelect = fullControls && ['list', 'rank'].includes(result.operation) && !result.parameters.agentReport && !result.parameters.researchTask;
  const canExport = ['list', 'rank'].includes(result.operation) && !result.parameters.agentReport && !result.parameters.researchTask;
  const mapEligible = resultMapEligible(result);
  const pageCount = Math.max(1, Math.ceil(indexes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = indexes.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  if (availability) {
    const rawTable = <div className={styles.scroll}><table><thead><tr>{result.table.columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{result.table.rows.map(row => <tr key={row.entityId}>{result.table.columns.map(column => <td key={column.key}><button type="button" className={styles.cell} onClick={event => onSource(row.cells[column.key].sourceIds, column.label, event.currentTarget)}>{tableCellText(row.cells[column.key], column.key, column.unit)}</button></td>)}</tr>)}</tbody></table></div>;
    return statusShown ? <div className={styles.root}>{rawTable}</div> : <section aria-label="查询结果状态" className={styles.root}><p>{availability.title}</p><p className={styles.scope}>{availability.description}</p><details><summary>查看原始结果</summary>{rawTable}</details></section>;
  }

  return <HomeQueryDetailContent id={detailId}><div ref={root} data-expanded={expanded} data-nested-scroll={policy.nestedScroll} data-selectable={canSelect} data-reading={!fullControls && !expanded && result.table.rows.length <= 10} className={styles.root}>
    <div className={styles.toolbar} aria-label="结果表格工具栏">
      {fullControls && <label className={styles.search}><Search size={16} aria-hidden="true" /><span className="sr-only">搜索本次结果</span>
        <input value={search} type="search" placeholder={`搜索已返回的 ${result.table.rows.length} 条记录`} onChange={event => { setSearch(event.target.value); changePage(0); }} /></label>}
      {fullControls && filterOptions.length > 0 && <HomeQueryMenu label={<>筛选{filters.length ? ` · ${filters.length}` : ''}</>}>
        {filterOptions.map(column => <label key={column.key}>{column.label}<select aria-label={`筛选${column.label}`} value={filters.find(item => item.key === column.key)?.value ?? ''} onChange={event => {
          const value = event.target.value;
          setFilters(current => [...current.filter(item => item.key !== column.key), ...(value ? [{ key: column.key, value }] : [])]); changePage(0);
        }}><option value="">全部{column.label}</option>{column.values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
      </HomeQueryMenu>}
      <div className={styles.primaryActions}>
      {detail && !expanded && <button type="button" onClick={event => detail.open(detailId, '数据工作区', event.currentTarget)}>展开表格</button>}
      {!policy.controls && <button type="button" aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}>表格工具</button>}
      {fullControls && <HomeQueryMenu label="显示字段">{result.table.columns.map(column => <label key={column.key}>
        <input type="checkbox" checked={!hiddenColumns.has(column.key)} disabled={!hiddenColumns.has(column.key) && columns.length === 1}
          onChange={() => setHiddenColumns(current => { const next = new Set(current); if (next.has(column.key)) next.delete(column.key); else next.add(column.key); return next; })} />{column.label}</label>)}</HomeQueryMenu>}
      {mapEligible && requestId && <Link className={styles.mapLink} href={queryMapHref(requestId, undefined, false, result.resultId)} prefetch={false}>在地图中查看</Link>}
      {requestId && scope && internalExport && canExport && <TableExport result={result} requestId={requestId} scope={scope} filtered={indexes} selected={selected} hasFilter={!!search || filters.length > 0} />}
      </div>
    </div>
    {(search || filters.length > 0 || selected.size > 0 || sort) && <div className={styles.selection} role="status">
      <span>筛选 {indexes.length} / {result.table.rows.length} 条{selected.size > 0 ? `，已选 ${selected.size} 条（筛选内 ${selectedInView} 条${selected.size > selectedInView ? `，筛选外 ${selected.size - selectedInView} 条` : ''}）` : ''}</span>
      {!!search && <button type="button" onClick={() => { setSearch(''); changePage(0); }}>清除搜索</button>}
      {filters.map((filter, index) => {
        const column = result.table.columns.find(column => column.key === filter.key);
        const label = filter.operator && column?.unit
          ? `${column.label} ${{ gte: '≥', lte: '≤', eq: '=' }[filter.operator]} ${filter.value} ${units[column.unit] ?? column.unit}` : filter.value;
        return <button key={`${filter.key}:${filter.operator}:${index}`} type="button" aria-label={`移除筛选：${label}`} onClick={() => { setFilters(current => current.filter((_, i) => i !== index)); changePage(0); }}>{label} ×</button>;
      })}
      {sort && <button type="button" onClick={() => { setSort(null); changePage(0); }}>恢复原始顺序</button>}
      {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>}
    </div>}
    <div className={styles.scroll} data-table-scroll onScroll={event => { scrollPosition.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }; }} role="region" tabIndex={0} aria-label="查询结果表，可横向滚动">
      <table><caption className="sr-only">本次结果的完整表格，分页不改变统计范围</caption>
        <thead><tr>{canSelect && <th className={styles.check}><label className={styles.checkTarget}><input ref={allSelected} type="checkbox" aria-label="全选筛选结果" checked={indexes.length > 0 && selectedInView === indexes.length} disabled={!indexes.length}
          onChange={event => setSelected(current => { const next = new Set(current); indexes.forEach(index => event.target.checked ? next.add(index) : next.delete(index)); return next; })} /></label></th>}
          {columns.map(column => <th scope="col" key={column.key} className={`${column.key === 'name' ? styles.name : ''} ${column.unit ? styles.number : ''}`} aria-sort={sort?.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" onClick={() => { setSort(sort?.key === column.key && sort.direction === 'desc' ? null : { key: column.key, direction: sort?.key === column.key ? 'desc' : 'asc' }); changePage(0); }}>
              {column.key === 'usedCount' ? (compactTrend && duplicateCount ? '有效样本' : '参与计算') : column.key === 'availableCount' ? '有效样本' : column.key === 'coverage' ? '样本覆盖' : column.label}{column.unit ? `（${units[column.unit] ?? column.unit}）` : ''}
              {sort?.key === column.key && (sort.direction === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />)}</button>
          </th>)}</tr></thead>
        <tbody>{shown.map(index => {
          const row = result.table.rows[index];
          const rowName = row.cells.name?.kind === 'text' ? row.cells.name.value : `第 ${index + 1} 条`;
          return <tr key={index} data-selected={selected.has(index)}>
            {canSelect && <td className={styles.check}><label className={styles.checkTarget}><input type="checkbox" aria-label={`选择${rowName}`} checked={selected.has(index)}
              onChange={() => setSelected(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })} /></label></td>}
            {columns.map(column => { const cell = row.cells[column.key]; const value = tableCellText(cell, column.key, column.unit);
              return <td key={column.key} className={`${cell.kind === 'number' ? styles.number : ''} ${column.key === 'name' ? styles.name : ''}`} title={value}>
                {column.key === 'name' && requestId && buildings.has(row.entityId)
                  ? <Link className={styles.buildingLink} href={queryMapHref(requestId, row.entityId, true, result.resultId)} prefetch={false}>{value}</Link>
                  : <button type="button" className={styles.cell} aria-label={`查看来源：${column.label} ${value}`} onClick={event => onSource(cell.sourceIds, `${column.label}：${value}`, event.currentTarget)}>{value}</button>}
              </td>; })}
          </tr>;
        })}{!shown.length && <tr><td colSpan={columns.length + (canSelect ? 1 : 0)}>没有匹配的记录，可清除搜索或筛选。</td></tr>}</tbody>
      </table>
    </div>
    {indexes.length > PAGE_SIZE && <div className={styles.footer}><span>第 {indexes.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, indexes.length)} 条，共 {indexes.length} 条</span>
      {indexes.length > PAGE_SIZE && <div><Button variant="ghost" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>上一页</Button>
        <Button variant="ghost" disabled={currentPage + 1 >= pageCount} onClick={() => changePage(currentPage + 1)}>下一页</Button></div>}</div>}
    {selected.size > 3000 && <p role="status">单次范围导出最多 3,000 条；可减少选择或导出全部正式结果。</p>}
  </div></HomeQueryDetailContent>;
}
function TableExport({ result, requestId, scope, filtered, selected, hasFilter }: { result: QueryResultView; requestId: string; scope: QueryClientScope; filtered: number[]; selected: ReadonlySet<number>; hasFilter: boolean }) {
  const { busy, message, download } = useQueryDownload(scope, requestId, result.resultId);
  const [range, setRange] = React.useState<'all' | 'filtered' | 'selected'>('all');
  const count = range === 'selected' ? selected.size : range === 'filtered' ? filtered.length : result.table.rows.length;
  return <div className={styles.export}><HomeQueryMenu label="导出表格" onOpen={() => setRange(selected.size ? 'selected' : hasFilter ? 'filtered' : 'all')}>
    <label>导出范围<select aria-label="导出范围" value={range} disabled={busy} onChange={event => setRange(event.target.value as typeof range)}>
      <option value="all">全部结果 · {result.table.rows.length} 条</option><option value="filtered">当前筛选 · {filtered.length} 条</option><option value="selected" disabled={!selected.size}>已选项目 · {selected.size} 条</option>
    </select></label>
    <p>导出包含全部获权字段，不受显示字段设置影响。</p>
    {range === 'selected' && selected.size > filtered.filter(index => selected.has(index)).length && <p>包含筛选外已选记录。</p>}
    {(['xlsx', 'csv_zip'] as const).map(format => <Button key={format} variant="ghost" disabled={busy || !count || (range !== 'all' && count > 3000)} onClick={() => void download({ format,
      ...(range === 'all' ? {} : { selection: { kind: range, rowIndexes: range === 'selected' ? [...selected].sort((a, b) => a - b) : filtered } }),
    })}>{format === 'xlsx' ? 'Excel' : 'CSV 与来源'}</Button>)}
  </HomeQueryMenu>{message && <span role="status">{message}</span>}</div>;
}
