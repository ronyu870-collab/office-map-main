'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Building2, FileText, Maximize2, Minimize2, ChevronRight, Edit2, History } from 'lucide-react';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { MaskedCell } from '@/src/components/demo';
import { useResponsiveColumns, calculateColumnWidths, type ColumnDef } from '@/src/hooks/useResponsiveColumns';
import { AdminLeaseExportButton } from './AdminLeaseExportButton';
import { LeaseTransactionHistoryDrawer } from './LeaseTransactionHistoryDrawer';
import { LeaseColumnMenu } from './LeaseColumnMenu';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';
import { LEASE_TABLE_FIELDS, isLeaseFilterActive, leaseFilterOptions, leaseFilterSummary, queryLeaseTable, type LeaseColumnKey, type LeaseColumnFilter, type LeaseTableFilters, type LeaseTableSort } from '../leaseTableQuery';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SubmissionDetailTableProps {
  submissions: LeaseTransaction[];
  title: string;
  highlightUserId?: string | null;
  /** 仅管理员传入 true；普通成员始终以只读方式查看团队汇总。 */
  canManageTeamRecords?: boolean;
  onEdit?: (record: LeaseTransaction) => void;
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
  { key: 'company', label: '公司名称', width: 'flex', minWidth: 110, maxWidth: 240, flexWeight: 2.5 },
  // 这是低覆盖率的辅助字段：保留其位置与可查阅性，但不为大量空值预留主列宽度。
  { key: 'suspectedCompanyFullname', label: '疑似全称', width: 'flex', minWidth: 88, maxWidth: 124, flexWeight: 0.65 },
  { key: 'enterpriseType', label: '企业类型', width: 88 },
  // ── 行业/需求 ──
  { key: 'industry', label: '行业分类', width: 100 },
  { key: 'demandType', label: '需求类型', width: 88 },
  // ── 成交楼宇/位置 ──
  { key: 'building', label: '成交楼宇', width: 'flex', minWidth: 90, maxWidth: 200, flexWeight: 1 },
  { key: 'subMarket', label: '子市场', width: 80 },
  { key: 'district', label: '行政区', width: 76 },
  { key: 'grade', label: '级别', width: 68 },
  // ── 租金/面积 ──
  { key: 'area', label: '成交面积', width: 88, align: 'right' },
  { key: 'faceRent', label: '表面租金', width: 88, align: 'right' },
  { key: 'effectiveRent', label: '有效租金', width: 92, align: 'right' },
  // ── 时间/提交人 ──
  { key: 'year', label: '成交年份', width: 88 },
  { key: 'quarter', label: '成交季度', width: 84 },
  { key: 'submitter', label: '提交人', width: 80 },
];

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
          <div className="flex items-center gap-1.5">
            <Building2 size={13} className="shrink-0 text-zinc-400" />
            <span className="text-zinc-800 text-[13px] truncate"><MaskedCell masked>{val}</MaskedCell></span>
          </div>
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
    case 'submitter':
      return <span className="text-zinc-700 text-[13px]">{fmt(row.submitter_name)}</span>;
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
  { label: '提交时间', render: (r) => fmtDate(r.created_at) },
];

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function SubmissionDetailTable({
  submissions,
  title,
  highlightUserId,
  canManageTeamRecords = false,
  onEdit,
}: SubmissionDetailTableProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [editMode, setEditMode] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyRecord, setHistoryRecord] = React.useState<LeaseTransaction | null>(null);
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
  const [activeMenu, setActiveMenu] = React.useState<string | null>(null);
  const options = React.useMemo(() => Object.fromEntries(
    (Object.keys(LEASE_TABLE_FIELDS) as LeaseColumnKey[]).map((key) => [key, leaseFilterOptions(submissions, key)]),
  ), [submissions]);
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
  const renderColumnMenu = (key: LeaseColumnKey) => {
    return <LeaseColumnMenu columnKey={key} filter={filters[key]} sort={sort} options={options[key]} open={activeMenu === key} onOpenChange={(open) => setActiveMenu(open ? key : null)} onFilter={(filter) => updateFilter(key, filter)} onSort={setSort} />;
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
      <div className={`shrink-0 border-b border-zinc-200 bg-white px-5 py-3 ${isFullscreen ? '' : 'rounded-t-2xl'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex shrink-0 items-center gap-2.5">
            <FileText className="text-[#003e7e]" size={17} />
            <div>
              <h3 className="text-[15px] font-semibold text-zinc-900">{title}</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                共 {filteredSubmissions.length} 条
                {activeFilterCount > 0 && <span className="text-[#003e7e] ml-1">· 已筛选 {activeFilterCount} 项</span>}
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
            {(activeFilterCount > 0 || sort) && (
              <button
                onClick={() => { setFilters({}); setSort(null); setActiveMenu(null); }}
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                重置筛选和排序
              </button>
            )}
            {canManageTeamRecords && onEdit && (
              <button
                onClick={() => setEditMode(v => !v)}
                aria-pressed={editMode}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  editMode
                    ? 'bg-[#003e7e] text-white'
                    : 'text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                <Edit2 size={13} />
                {editMode ? '完成管理' : '管理记录'}
              </button>
            )}
            {canManageTeamRecords && (
              <button
                type="button"
                onClick={() => { setHistoryRecord(null); setHistoryOpen(true); }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100"
                title="查看成交变更记录"
              >
                <History size={13} />
                变更记录
              </button>
            )}
            {canManageTeamRecords && <AdminLeaseExportButton />}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              aria-label={isFullscreen ? '退出全屏显示' : '全屏显示团队成交汇总'}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-500 hover:bg-zinc-100 transition-colors"
              title={isFullscreen ? '退出全屏' : '全屏显示'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>
        {(activeFilterCount > 0 || sort) && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {activeFilters.map(([key, filter]) => {
            const summary = `${LEASE_TABLE_FIELDS[key].label}：${leaseFilterSummary(key, filter, options[key])}`;
            return <button key={key} type="button" title={summary} aria-label={`清除${summary}`} onClick={() => updateFilter(key, {})} className="max-w-64 truncate rounded border border-blue-100 bg-blue-50 px-2 py-1 text-[#003e7e]">{summary} ×</button>;
          })}
          {sort && <button type="button" onClick={() => setSort(null)} className="rounded bg-zinc-100 px-2 py-1 text-zinc-500">{LEASE_TABLE_FIELDS[sort.key].label} · {sort.direction === 'asc' ? '升序' : '降序'} ×</button>}
        </div>}
      </div>

      {/* ── 表格（填满剩余高度，内部独立滚动）── */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto"
      >
        <table className="w-full border-collapse table-fixed" style={{ minWidth: tableMinWidth }}>
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
              <th className="border-b border-r border-zinc-200 bg-zinc-50 px-1 py-2.5 text-center text-xs font-semibold text-zinc-500">
                序号
              </th>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="border-b border-r border-zinc-200 bg-zinc-50 px-2 py-2.5 text-xs font-semibold tracking-wide text-zinc-500 truncate"
                  style={{ textAlign: col.align || 'left' }}
                  aria-sort={sort?.key === col.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                >
                  {renderColumnMenu(col.key as LeaseColumnKey)}
                </th>
              ))}
              {editMode && (
                <th className="border-b border-zinc-200 bg-zinc-50 px-1 py-2.5 text-center text-xs font-semibold text-zinc-500">
                  操作
                </th>
              )}
            </tr>
          </thead>

          {/* 数据行 */}
          <tbody>
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={totalColSpan} className="px-4 py-20 text-center">
                  <FileText className="mx-auto text-zinc-300 mb-4" size={48} />
                  <p className="text-sm font-medium text-zinc-400">{activeFilterCount > 0 ? '没有符合筛选条件的成交记录' : '暂无成交记录'}</p>
                </td>
              </tr>
            ) : (
              pagedData.map((row, idx) => {
                const rowNum = (safePage - 1) * PAGE_SIZE + idx + 1;
                const isHighlighted = highlightUserId && row.submitter_id === highlightUserId;
                const isExpanded = expandedId === (row.id ?? `${idx}`);
                const isEven = idx % 2 === 0;
                const rowBg = isHighlighted
                  ? 'bg-[#003e7e]/[0.04] hover:bg-[#003e7e]/[0.08]'
                  : isEven
                  ? 'bg-white hover:bg-zinc-50'
                  : 'bg-zinc-50/40 hover:bg-zinc-50';

                return (
                  <React.Fragment key={row.id ?? `${idx}`}>
                    {/* 主信息行 */}
                    <tr className={`cursor-pointer transition-colors ${rowBg}`} onClick={() => toggleExpand(row.id ?? `${idx}`)}>
                      <td className="border-b border-r border-zinc-100 px-1 py-3 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <ChevronRight size={13} className={`text-zinc-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
                          <span className="text-xs text-zinc-400 tabular-nums">{rowNum}</span>
                        </div>
                      </td>
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          className="border-b border-r border-zinc-100 px-2 py-3"
                          style={{ textAlign: col.align || 'left' }}
                  aria-sort={sort?.key === col.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                        >
                          {renderCell(col.key, row)}
                        </td>
                      ))}
                      {editMode && (
                        <td className="border-b border-zinc-100 px-1 py-3 text-center">
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
                      <tr className={isHighlighted ? 'bg-[#003e7e]/[0.02]' : isEven ? 'bg-zinc-50/50' : 'bg-zinc-50/30'}>
                        <td colSpan={totalColSpan} className="px-5 py-4 border-b border-zinc-100">
                          <div className="ml-12 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-x-8 gap-y-3.5">
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
        <div className={`shrink-0 flex items-center justify-between border-t border-zinc-200 bg-zinc-50/60 px-5 py-3 ${isFullscreen ? '' : 'rounded-b-2xl'}`}>
          <p className="text-xs text-zinc-400">
            显示 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredSubmissions.length)} 条，共 {filteredSubmissions.length} 条
          </p>
          <div className="flex items-center gap-1">
            {pageNumbers.map((p, i) =>
              p === '...' ? (
                <span key={`dots-${i}`} className="px-1 text-xs text-zinc-400">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setCurrentPage(p as number)}
                  className={`min-w-[30px] h-7 rounded-md text-xs font-medium transition-colors ${
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

