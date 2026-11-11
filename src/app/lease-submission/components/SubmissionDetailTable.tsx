'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, FileText, Maximize2, Minimize2, ChevronDown, Edit2, History } from 'lucide-react';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { MaskedCell } from '@/src/components/demo';
import { useIsDemo } from '@/src/components/demo/DemoProvider';
import { Button } from '@/src/components/ui/Button';
import { useResponsiveColumns, calculateColumnWidths, type ColumnDef } from '@/src/hooks/useResponsiveColumns';
import { AdminLeaseExportButton } from './AdminLeaseExportButton';
import { LeaseTransactionHistoryDrawer } from './LeaseTransactionHistoryDrawer';
import { LeaseColumnMenu } from './LeaseColumnMenu';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';
import { LEASE_TABLE_FIELDS, isLeaseFilterActive, leaseFilterOptions, leaseFilterSummary, queryLeaseTable, type LeaseColumnKey, type LeaseColumnFilter, type LeaseFilterOption, type LeaseTableFilters, type LeaseTableSort } from '../leaseTableQuery';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SubmissionDetailTableProps {
  submissions: LeaseTransaction[];
  title: string;
  highlightUserId?: string | null;
  /** 仅管理员传入 true；普通成员始终以只读方式查看团队汇总。 */
  canManageTeamRecords?: boolean;
  onEdit?: (record: LeaseTransaction) => void;
  onViewBuilding?: (record: LeaseTransaction, trigger: HTMLButtonElement) => void;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function fmt(val: string | null | undefined): string {
  return val?.trim() || '-';
}

function fmtNum(val: number | null | undefined, unit = ''): string {
  if (val === null || val === undefined) return '-';
  return `${val.toLocaleString('zh-CN')}${unit}`;
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ─── 列定义 ───────────────────────────────────────────────────────────────────

const TABLE_COLUMNS: ColumnDef[] = [
  // ── 企业信息 ──
  { key: 'company', label: '公司名称', width: 'flex', minWidth: 184, maxWidth: 280, flexWeight: 2.5 },
  // 这是低覆盖率的辅助字段：保留其位置与可查阅性，但不为大量空值预留主列宽度。
  { key: 'suspectedCompanyFullname', label: '疑似全称', width: 88 },
  { key: 'enterpriseType', label: '企业类型', width: 80 },
  // ── 行业/需求 ──
  { key: 'industry', label: '行业分类', width: 112 },
  { key: 'demandType', label: '需求类型', width: 80 },
  // ── 成交楼宇/位置 ──
  { key: 'building', label: '成交楼宇', width: 'flex', minWidth: 136, maxWidth: 220, flexWeight: 1.5 },
  { key: 'subMarket', label: '子市场', width: 72 },
  { key: 'district', label: '行政区', width: 72 },
  { key: 'grade', label: '级别', width: 56 },
  // ── 租金/面积 ──
  { key: 'area', label: '成交面积', width: 88, align: 'right' },
  { key: 'faceRent', label: '表面租金', width: 88, align: 'right' },
  { key: 'effectiveRent', label: '有效租金', width: 92, align: 'right' },
  // ── 时间/提交人 ──
  { key: 'year', label: '成交年份', width: 80 },
  { key: 'quarter', label: '成交季度', width: 80 },
  { key: 'submitter', label: '提交人', width: 104 },
];

const tableRule = 'border-[var(--cd-color-border)]/55';
const startsColumnGroup = (key: string) => key === 'area' || key === 'year';
const toolbarActions = 'ml-auto items-start gap-1 [&_button]:min-w-[6.5rem] [&_button]:whitespace-nowrap [&_button]:text-[length:var(--cd-font-size-sm)] [&_button]:text-[var(--cd-color-text-secondary)] [&_button>svg]:size-3.5 [&_button>svg]:shrink-0 max-sm:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_button]:min-h-11';
const pressedAction = 'aria-pressed:bg-[var(--cd-color-brand-soft)] aria-pressed:text-[var(--cd-color-brand)]';
const filterChip = 'inline-flex min-h-8 max-w-full items-center gap-1 rounded-[var(--cd-radius-md)] px-2 text-left text-xs font-medium hover:underline focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11';

// ─── 即时 Tooltip（Portal 渲染到 body，不受表格 overflow 裁剪）────────────

function QuickTooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  if (!text || text === '-') return <>{children}</>;

  const show = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-block max-w-full"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children}
      </div>
      {pos && createPortal(
        <div
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: 'translate(-50%, -100%)',
            zIndex: 99999,
          }}
          className="whitespace-nowrap rounded bg-zinc-900 px-2.5 py-1 text-[12px] text-white shadow-lg pointer-events-none"
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── 单元格渲染 ──────────────────────────────────────────────────────────────

const renderCell = (key: string, row: LeaseTransaction): React.ReactNode => {
  switch (key) {
    // ── 企业信息 ──
    case 'company': {
      const val = fmt(row.company);
      return (
        <QuickTooltip text={val}>
          <span className="font-semibold text-zinc-900 text-[13px] truncate block">
            <MaskedCell masked>{val}</MaskedCell>
          </span>
        </QuickTooltip>
      );
    }
    case 'suspectedCompanyFullname': {
      const val = fmt(row.suspected_company_fullname);
      if (val === '-') {
        return <span className="block text-[13px] text-zinc-300" aria-label="未填写疑似全称">—</span>;
      }
      return (
        <QuickTooltip text={val}>
          <span className="text-zinc-600 text-[13px] truncate block">
            <MaskedCell masked>{val}</MaskedCell>
          </span>
        </QuickTooltip>
      );
    }
    case 'enterpriseType': {
      const val = fmt(row.enterprise_type);
      return <QuickTooltip text={val}><span className="text-zinc-600 text-[13px] truncate block">{val}</span></QuickTooltip>;
    }
    // ── 行业/需求 ──
    case 'industry': {
      const val = fmt(row.industry);
      return <QuickTooltip text={val}><span className="text-zinc-600 text-[13px] truncate block">{val}</span></QuickTooltip>;
    }
    case 'demandType':
      return <span className="text-zinc-600 text-[13px]">{fmt(row.demand_type)}</span>;
    // ── 成交楼宇/位置 ──
    case 'building': {
      const val = fmt(row.new_building);
      return (
        <QuickTooltip text={val}>
          <span className="block truncate text-[13px] text-zinc-800"><MaskedCell masked>{val}</MaskedCell></span>
        </QuickTooltip>
      );
    }
    case 'subMarket': {
      const val = fmt(row.sub_market);
      return <QuickTooltip text={val}><span className="text-zinc-600 text-[13px] truncate block">{val}</span></QuickTooltip>;
    }
    case 'district': {
      const val = fmt(row.district);
      return <QuickTooltip text={val}><span className="text-zinc-600 text-[13px] truncate block">{val}</span></QuickTooltip>;
    }
    case 'grade':
      return <span className="text-zinc-600 text-[13px]">{fmt(row.building_grade)}</span>;
    // ── 租金/面积 ──
    case 'area':
      return <span className="tabular-nums text-zinc-800 text-[13px]">{fmtNum(row.area_sqm)}</span>;
    case 'faceRent':
      return <span className="tabular-nums text-zinc-600 text-[13px]">{formatLeaseRent(row.face_rent)}</span>;
    case 'effectiveRent':
      return <span className="tabular-nums font-semibold text-[#003e7e] text-[13px]">{formatLeaseRent(row.effective_rent)}</span>;
    // ── 时间/提交人 ──
    case 'year':
      return <span className="tabular-nums text-zinc-600 text-[13px]">{row.transaction_year > 0 ? row.transaction_year : '—'}</span>;
    case 'quarter':
      return <span className="text-zinc-600 text-[13px]">{fmt(row.transaction_quarter)}</span>;
    case 'submitter': {
      const val = fmt(row.submitter_name);
      return <QuickTooltip text={val}><span className="block truncate text-[13px] text-zinc-700">{val}</span></QuickTooltip>;
    }
    default:
      return null;
  }
};

// ─── 详情字段（展开后显示）───────────────────────────────────────────────────

interface DetailField {
  label: string;
  render: (row: LeaseTransaction) => string;
}

const DETAIL_FIELDS: DetailField[] = [
  { label: '疑似全称', render: (r) => fmt(r.suspected_company_fullname) },
  { label: '细分行业', render: (r) => fmt(r.sub_industry) },
  { label: '楼座/楼层', render: (r) => {
    const fi = r.floor_info?.trim();
    const fl = r.floor?.trim();
    return fi && fl ? `${fi} ${fl}层` : fi || fl ? `${fi || ''}${fl ? fl + '层' : ''}` : '-';
  }},
  { label: '旧址', render: (r) => fmt(r.old_address) },
  { label: '旧址子市场', render: (r) => fmt(r.old_sub_market) },
  { label: '旧址楼宇级别', render: (r) => fmt(r.old_building_grade) },
  { label: '租期(月)', render: (r) => fmtNum(r.lease_term_months) },
  { label: '装修期(月)', render: (r) => fmtNum(r.fit_out_months) },
  { label: '免租期(月)', render: (r) => fmtNum(r.rent_free_months) },
  { label: '面积变化', render: (r) => fmt(r.relocation_area_change) },
  { label: '原行政区', render: (r) => fmt(r.old_district) },
  { label: '备注', render: (r) => fmt(r.remarks) },
  { label: '提交人', render: (r) => fmt(r.submitter_name) },
  { label: '提交时间', render: (r) => fmtDate(r.created_at) },
];

// ─── 主组件 ───────────────────────────────────────────────────────────────────

type TableScrollEdge = 'none' | 'more' | 'end';

function TableScrollHint({ scrollRef, tableRef }: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  tableRef: React.RefObject<HTMLTableElement | null>;
}) {
  const [edge, setEdge] = React.useState<TableScrollEdge>('none');

  React.useEffect(() => {
    const scroller = scrollRef.current;
    const table = tableRef.current;
    if (!scroller || !table) return;
    let previous: TableScrollEdge = 'none';
    const update = () => {
      const overflowWidth = scroller.scrollWidth - scroller.clientWidth;
      // CSS pixels from scrollWidth/clientWidth are rounded; scrollLeft can be fractional.
      const next = !scroller.clientWidth || overflowWidth <= 1 ? 'none'
        : overflowWidth - scroller.scrollLeft <= 1 ? 'end' : 'more';
      if (next === previous) return;
      previous = next;
      setEdge(next);
    };
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    observer?.observe(table);
    if (!observer) window.addEventListener('resize', update);
    scroller.addEventListener('scroll', update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', update);
      scroller.removeEventListener('scroll', update);
    };
  }, [scrollRef, tableRef]);

  if (edge === 'none') return null;
  // Keep the hint's height when reaching the edge so scrolling doesn't move the table.
  return (
    <p aria-hidden={edge === 'end' || undefined} className={`mt-2 flex items-center justify-end gap-1.5 text-xs text-[var(--cd-color-text-secondary)] sm:hidden ${edge === 'end' ? 'invisible' : ''}`}>
      横向滑动查看更多列 <ArrowRight size={12} aria-hidden="true" />
    </p>
  );
}

export function SubmissionDetailTable({
  submissions,
  title,
  highlightUserId,
  canManageTeamRecords = false,
  onEdit,
  onViewBuilding,
}: SubmissionDetailTableProps) {
  const isDemo = useIsDemo();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyRecord, setHistoryRecord] = React.useState<LeaseTransaction | null>(null);
  const detailsId = React.useId();
  const PAGE_SIZE = 20;
  const ACTION_COLUMN_WIDTH = 76;

  // 响应式列可见性
  const { visibleColumns, containerWidth } = useResponsiveColumns({
    columns: TABLE_COLUMNS,
    containerRef,
    defaultWidth: 1440,
    immediateRecalcTrigger: isFullscreen,
  });

  // 表格最小宽度：所有可用列的最小宽度之和（保证列不会被挤到比最小值还窄）
  const tableMinWidth = React.useMemo(() => {
    let total = 48; // 序号列
    for (const col of visibleColumns) {
      if (col.width === 'flex') total += col.minWidth || 80;
      else total += col.width || 80;
    }
    if (editMode) total += ACTION_COLUMN_WIDTH;
    return total;
  }, [visibleColumns, editMode]);

  // 计算列宽（像素值，用于 <colgroup>）
  // 基于 hook 跟踪的容器宽度分配弹性列空间，但列宽不低于 minWidth
  const columnWidths = React.useMemo(() => {
    const usable = Math.max(containerWidth - 48 - (editMode ? ACTION_COLUMN_WIDTH : 0), tableMinWidth - 48 - (editMode ? ACTION_COLUMN_WIDTH : 0));
    return calculateColumnWidths(visibleColumns, usable);
  }, [visibleColumns, editMode, containerWidth, tableMinWidth, ACTION_COLUMN_WIDTH]);

  // Escape 键退出全屏
  React.useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // 全屏时禁止 body 滚动
  React.useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isFullscreen]);

  const [filters, setFilters] = React.useState<LeaseTableFilters>({});
  const [sort, setSort] = React.useState<LeaseTableSort>(null);
  const [activeMenu, setActiveMenu] = React.useState<LeaseColumnKey | null>(null);
  const options = React.useMemo(() => {
    const needed = new Set<LeaseColumnKey>();
    if (activeMenu && LEASE_TABLE_FIELDS[activeMenu].type !== 'number') needed.add(activeMenu);
    for (const [key, filter] of Object.entries(filters) as [LeaseColumnKey, LeaseColumnFilter][]) {
      if (filter.values?.length) needed.add(key);
    }
    const result: Partial<Record<LeaseColumnKey, LeaseFilterOption[]>> = {};
    for (const key of needed) result[key] = leaseFilterOptions(submissions, key);
    return result;
  }, [activeMenu, filters, submissions]);
  const filteredSubmissions = React.useMemo(() => queryLeaseTable(submissions, filters, sort), [submissions, filters, sort]);

  React.useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [filteredSubmissions]);

  const updateFilter = (key: LeaseColumnKey, filter: LeaseColumnFilter) => {
    setFilters((previous) => {
      const next = { ...previous };
      if (isLeaseFilterActive(filter)) next[key] = filter;
      else delete next[key];
      return next;
    });
  };
  const totalPages = Math.ceil(filteredSubmissions.length / PAGE_SIZE);
  const safePage = Math.max(1, Math.min(currentPage, totalPages));
  const pagedData = filteredSubmissions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageNumbers = React.useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '...')[] = [1];
    if (safePage > 3) pages.push('...');
    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pages.push(i);
    if (safePage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [safePage, totalPages]);
  const toggleExpand = (id: string) => setExpandedId((previous) => previous === id ? null : id);
  const activeFilters = (Object.entries(filters) as [LeaseColumnKey, LeaseColumnFilter][]).filter(([, filter]) => isLeaseFilterActive(filter));
  const activeFilterCount = activeFilters.length;
  const hasQuery = activeFilterCount > 0 || sort !== null;
  const renderColumnMenu = (key: LeaseColumnKey) => {
    return <LeaseColumnMenu columnKey={key} filter={filters[key]} sort={sort} options={options[key] ?? []} open={activeMenu === key} onOpenChange={(open) => setActiveMenu(open ? key : null)} onFilter={(filter) => updateFilter(key, filter)} onSort={setSort} />;
  };

  // 总列数（用于 colSpan）
  const totalColSpan = visibleColumns.length + 1 + (editMode ? 1 : 0); // +1 for expand/序号, +1 for edit

  // ─── 容器样式 ───

  const outerClass = isFullscreen
    ? 'fixed inset-0 z-50 bg-zinc-50 flex flex-col min-w-0'
    : 'rounded-lg border border-zinc-200 bg-white flex flex-col min-w-0 max-h-[75vh]';

  return (
    <>
      <div className={outerClass}>
      {/* ── 工具栏 ── */}
      <div className={`shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-3 sm:px-5 ${isFullscreen ? '' : 'rounded-t-lg'}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText aria-hidden="true" className="shrink-0 text-[var(--cd-color-brand)]" size={16} />
            <div>
              <h3 className="text-base font-semibold text-[var(--cd-color-text-primary)] [overflow-wrap:anywhere]">{title}</h3>
              <p className="text-xs text-[var(--cd-color-text-secondary)]">
                共 {filteredSubmissions.length} 条
                {activeFilterCount > 0 && <span className="ml-1 text-[var(--cd-color-brand)]">· 已筛选 {activeFilterCount} 项</span>}
              </p>
            </div>
          </div>
          <div
            role="group"
            aria-label="成交表格操作"
            className={`${toolbarActions} ${canManageTeamRecords ? 'grid w-full grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end max-sm:[&_button]:justify-start' : 'flex'}`}
          >
            {canManageTeamRecords && onEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditMode(v => !v)}
                aria-pressed={editMode}
                className={pressedAction}
              >
                <Edit2 aria-hidden="true" />
                {editMode ? '完成管理' : '管理记录'}
              </Button>
            )}
            {canManageTeamRecords && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setHistoryRecord(null); setHistoryOpen(true); }}
                title="查看成交变更记录"
              >
                <History aria-hidden="true" />
                变更记录
              </Button>
            )}
            {canManageTeamRecords && <AdminLeaseExportButton />}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
              aria-label={isFullscreen ? '退出全屏显示' : '全屏显示团队成交汇总'}
            >
              {isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              {isFullscreen ? '退出全屏' : '全屏'}
            </Button>
          </div>
        </div>
        {hasQuery && <div role="group" aria-label="已应用的筛选和排序" className={`mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2 ${tableRule}`}>
          <div className="flex min-w-0 max-w-full flex-auto flex-wrap items-center gap-1.5">
            {activeFilters.map(([key, filter]) => {
              const summary = `${LEASE_TABLE_FIELDS[key].label}：${leaseFilterSummary(key, filter, options[key] ?? [])}`;
              return (
                <button key={key} type="button" title={summary} aria-label={`清除${summary}`} onClick={() => updateFilter(key, {})} className={`${filterChip} bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]`}>
                  <span className="min-w-0 truncate sm:max-w-64">{summary}</span><span aria-hidden="true">×</span>
                </button>
              );
            })}
            {sort && <button type="button" onClick={() => setSort(null)} className={`${filterChip} bg-[var(--cd-color-surface-alt)] text-[var(--cd-color-text-secondary)]`}>{LEASE_TABLE_FIELDS[sort.key].label} · {sort.direction === 'asc' ? '升序' : '降序'} ×</button>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilters({}); setSort(null); setActiveMenu(null); }}
            className="ml-auto whitespace-nowrap text-[length:var(--cd-font-size-sm)] [color:var(--cd-color-text-secondary)] max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11"
          >
            重置筛选和排序
          </Button>
        </div>}
        {pagedData.length > 0 && <TableScrollHint scrollRef={containerRef} tableRef={tableRef} />}
      </div>

      {/* ── 表格（填满剩余高度，内部独立滚动）── */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto"
      >
        <table ref={tableRef} className="w-full border-collapse table-fixed" style={{ minWidth: tableMinWidth }}>
          {/* 列宽定义 */}
          <colgroup>
            <col style={{ width: 48 }} />
            {columnWidths.map((w, i) => (
              <col key={visibleColumns[i]?.key ?? i} style={{ width: w }} />
            ))}
            {editMode && <col style={{ width: ACTION_COLUMN_WIDTH }} />}
          </colgroup>

          {/* 表头（sticky） */}
          <thead>
            <tr className="sticky top-0 z-10">
              <th className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-1 py-2.5 text-center text-xs font-semibold text-[var(--cd-color-text-secondary)]">
                序号
              </th>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className={`truncate border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-2 py-2.5 text-xs ${startsColumnGroup(col.key) ? 'border-l' : ''} ${col.align === 'right' ? '[&>button]:justify-end' : ''}`}
                  style={{ textAlign: col.align || 'left' }}
                  aria-sort={sort?.key === col.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                >
                  {renderColumnMenu(col.key as LeaseColumnKey)}
                </th>
              ))}
              {editMode && (
                <th className="border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-1 py-2.5 text-center text-xs font-semibold text-[var(--cd-color-text-secondary)]">
                  操作
                </th>
              )}
            </tr>
          </thead>

          {/* 数据行 */}
          <tbody>
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={totalColSpan} className="px-4 py-8 text-center">
                  <p className="text-[13px] text-zinc-500">{activeFilterCount > 0 ? '没有符合筛选条件的成交记录' : '暂无成交记录'}</p>
                </td>
              </tr>
            ) : (
              pagedData.map((row, idx) => {
                const rowNum = (safePage - 1) * PAGE_SIZE + idx + 1;
                const isHighlighted = highlightUserId && row.submitter_id === highlightUserId;
                const isExpanded = expandedId === (row.id ?? `${idx}`);
                const buildingName = row.new_building?.trim();
                const buildingAction = buildingName && onViewBuilding && !isDemo ? {
                  type: 'button' as const,
                  'aria-haspopup': 'dialog' as const,
                  'aria-label': `查看${buildingName}的成交记录`,
                  onClick(event: React.MouseEvent<HTMLButtonElement>) {
                    event.stopPropagation();
                    onViewBuilding(row, event.currentTarget);
                  },
                } : null;
                const rowBg = isHighlighted
                  ? 'bg-[var(--cd-color-brand)]/5 hover:bg-[var(--cd-color-brand-soft)]'
                  : 'bg-[var(--cd-color-surface)] hover:bg-[var(--cd-color-surface-alt)]';

                return (
                  <React.Fragment key={row.id ?? `${idx}`}>
                    {/* 主信息行 */}
                    <tr className={`cursor-pointer transition-colors ${rowBg}`} onClick={() => toggleExpand(row.id ?? `${idx}`)}>
                      <td className={`border-b px-1 py-3 text-center ${tableRule}`}>
                        <span className="text-xs text-zinc-400 tabular-nums">{rowNum}</span>
                      </td>
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`border-b px-2 py-3 ${tableRule} ${startsColumnGroup(col.key) ? 'border-l' : ''}`}
                          style={{ textAlign: col.align || 'left' }}
                        >
                          {col.key === 'company' ? (
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">{renderCell(col.key, row)}</div>
                              <button
                                type="button"
                                aria-label={`${isExpanded ? '收起' : '展开'}第${rowNum}条成交详情`}
                                aria-expanded={isExpanded}
                                aria-controls={isExpanded ? `${detailsId}-${rowNum}` : undefined}
                                onClick={(event) => { event.stopPropagation(); toggleExpand(row.id ?? `${idx}`); }}
                                className={`flex size-7 shrink-0 items-center justify-center rounded transition-colors hover:bg-zinc-100 hover:text-[#003e7e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e] [@media(pointer:coarse)]:size-11 ${isExpanded ? 'bg-[#003e7e]/5 text-[#003e7e]' : 'text-zinc-400'}`}
                              >
                                <ChevronDown size={14} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                          ) : col.key === 'building' && buildingAction ? (
                            <button
                              {...buildingAction}
                              title={buildingName}
                              className="block min-h-7 w-full cursor-pointer truncate rounded-sm text-left text-[13px] text-[var(--cd-color-brand)] underline decoration-current/30 underline-offset-[3px] hover:decoration-current focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] [@media(pointer:coarse)]:min-h-11"
                            >
                              {buildingName}
                            </button>
                          ) : renderCell(col.key, row)}
                        </td>
                      ))}
                      {editMode && (
                        <td className={`border-b px-1 py-3 text-center ${tableRule}`}>
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); setHistoryRecord(row); setHistoryOpen(true); }}
                              aria-label={`查看${fmt(row.company)}的变更记录`}
                              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-[#003e7e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                              title="查看变更记录"
                            >
                              <History size={14} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onEdit?.(row); }}
                              aria-label={`编辑${fmt(row.company)}的成交记录`}
                              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-blue-50 hover:text-[#003e7e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                              title="编辑此记录"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {/* 展开详情行 */}
                    {isExpanded && (
                      <tr className="bg-[var(--cd-color-surface-alt)]">
                        <td colSpan={totalColSpan} className={`border-b px-5 py-4 ${tableRule}`}>
                          <div id={`${detailsId}-${rowNum}`} className="ml-12 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-8 gap-y-3.5">
                            {buildingAction && (
                              <div className="min-w-0 max-w-[calc(100vw-6rem)]">
                                <button
                                  {...buildingAction}
                                  className="group inline-flex min-w-11 max-w-full cursor-pointer flex-col items-start rounded-sm text-left focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11"
                                >
                                  <span className="mb-0.5 text-xs text-zinc-500">成交楼宇</span>
                                  <span className="max-w-full text-[13px] text-[var(--cd-color-brand)] underline decoration-current/30 underline-offset-[3px] [overflow-wrap:anywhere] group-hover:decoration-current">{buildingName}</span>
                                </button>
                              </div>
                            )}
                            {DETAIL_FIELDS.map((field) => {
                              const value = field.render(row);
                              return (
                                <div key={field.label}>
                                  <div className="text-[11px] text-zinc-400 mb-0.5">{field.label}</div>
                                  <div className="text-[13px] text-zinc-700">{value}</div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 分页 ── */}
      {totalPages > 1 && (
        <div className={`flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-zinc-200 bg-zinc-50/60 px-3 py-2 sm:px-5 sm:py-3 ${isFullscreen ? '' : 'rounded-b-2xl'}`}>
          <p className="text-xs text-zinc-400">
            显示 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredSubmissions.length)} 条，共 {filteredSubmissions.length} 条
          </p>
          <div role="group" aria-label="成交记录分页" className="flex flex-wrap items-center gap-1">
            {pageNumbers.map((p, i) =>
              p === '...' ? (
                <span key={`dots-${i}`} className="px-1 text-xs text-zinc-400">…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  aria-current={safePage === p ? 'page' : undefined}
                  onClick={() => setCurrentPage(p as number)}
                  className={`h-7 min-w-[30px] rounded-md text-xs font-medium transition-colors max-sm:min-h-11 max-sm:min-w-11 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 ${
                    safePage === p
                      ? 'bg-[#003e7e] text-white'
                      : 'text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}
      </div>
      {canManageTeamRecords && (
        <LeaseTransactionHistoryDrawer
          open={historyOpen}
          record={historyRecord}
          onClose={() => { setHistoryOpen(false); setHistoryRecord(null); }}
        />
      )}
    </>
  );
}

