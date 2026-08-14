'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Building2, FileText, Maximize2, Minimize2, ChevronDown, ChevronRight, Edit2 } from 'lucide-react';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { MaskedCell } from '@/src/components/demo';
import { useResponsiveColumns, calculateColumnWidths, type ColumnDef } from '@/src/hooks/useResponsiveColumns';

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
  { key: 'suspectedCompanyFullname', label: '疑似全称', width: 'flex', minWidth: 72, maxWidth: 124, flexWeight: 0.65 },
  { key: 'enterpriseType', label: '企业类型', width: 76 },
  // ── 行业/需求 ──
  { key: 'industry', label: '行业分类', width: 100 },
  { key: 'demandType', label: '需求类型', width: 76 },
  // ── 成交楼宇/位置 ──
  { key: 'building', label: '成交楼宇', width: 'flex', minWidth: 90, maxWidth: 200, flexWeight: 1 },
  { key: 'subMarket', label: '子市场', width: 80 },
  { key: 'district', label: '行政区', width: 76 },
  { key: 'grade', label: '级别', width: 60 },
  // ── 租金/面积 ──
  { key: 'area', label: '成交面积', width: 88, align: 'right' },
  { key: 'faceRent', label: '表面租金', width: 88, align: 'right' },
  { key: 'effectiveRent', label: '有效租金', width: 92, align: 'right' },
  // ── 时间/提交人 ──
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
      return <span className="tabular-nums text-zinc-600 text-[13px]">{fmtNum(row.face_rent)}</span>;
    case 'effectiveRent':
      return <span className="tabular-nums font-semibold text-[#003e7e] text-[13px]">{fmtNum(row.effective_rent)}</span>;
    // ── 时间/提交人 ──
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
  const PAGE_SIZE = 20;

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
    if (editMode) total += 48;
    return total;
  }, [visibleColumns, editMode]);

  // 计算列宽（像素值，用于 <colgroup>）
  // 基于 hook 跟踪的容器宽度分配弹性列空间，但列宽不低于 minWidth
  const columnWidths = React.useMemo(() => {
    const usable = Math.max(containerWidth - 48 - (editMode ? 48 : 0), tableMinWidth - 48 - (editMode ? 48 : 0));
    return calculateColumnWidths(visibleColumns, usable);
  }, [visibleColumns, editMode, containerWidth, tableMinWidth]);

  // Escape 键退出全屏
  React.useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
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

  // 多列筛选
  const [filters, setFilters] = React.useState({
    company: '',
    demandType: '',
    newBuilding: '',
    subMarket: '',
    grade: '',
    submitter: '',
  });
  const [activeDropdown, setActiveDropdown] = React.useState<string | null>(null);
  const [dropdownSearch, setDropdownSearch] = React.useState('');
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const dropdownBtnRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [dropdownPos, setDropdownPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // 点击外部关闭下拉
  React.useEffect(() => {
    if (!activeDropdown) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (document.querySelector('[data-filter-dropdown]')?.contains(target)) return;
      setActiveDropdown(null);
      setDropdownSearch('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeDropdown]);

  // 各列唯一值
  const uniqueValues = React.useMemo(() => {
    const vals: Record<string, Set<string>> = {
      company: new Set(), demandType: new Set(), newBuilding: new Set(),
      subMarket: new Set(), grade: new Set(),
    };
    const submitterMap = new Map<string, string>();
    for (const s of submissions) {
      if (s.company?.trim()) vals.company.add(s.company.trim());
      if (s.demand_type?.trim()) vals.demandType.add(s.demand_type.trim());
      if (s.new_building?.trim()) vals.newBuilding.add(s.new_building.trim());
      if (s.sub_market?.trim()) vals.subMarket.add(s.sub_market.trim());
      if (s.building_grade?.trim()) vals.grade.add(s.building_grade.trim());
      if (s.submitter_active !== false && s.submitter_id && s.submitter_name?.trim()) {
        submitterMap.set(s.submitter_id, s.submitter_name.trim());
      }
    }
    const submitterEntries = [...submitterMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return {
      company: [...vals.company].sort(),
      demandType: [...vals.demandType].sort(),
      newBuilding: [...vals.newBuilding].sort(),
      subMarket: [...vals.subMarket].sort(),
      grade: [...vals.grade].sort(),
      submitter: submitterEntries,
    };
  }, [submissions]);

  // 过滤数据
  const filteredSubmissions = React.useMemo(() => {
    return submissions.filter((s) => {
      if (filters.company && !s.company?.toLowerCase().includes(filters.company.toLowerCase())) return false;
      if (filters.demandType && s.demand_type?.trim() !== filters.demandType) return false;
      if (filters.newBuilding && !s.new_building?.toLowerCase().includes(filters.newBuilding.toLowerCase())) return false;
      if (filters.subMarket && s.sub_market?.trim() !== filters.subMarket) return false;
      if (filters.grade && s.building_grade?.trim() !== filters.grade) return false;
      if (filters.submitter && s.submitter_id !== filters.submitter) return false;
      return true;
    });
  }, [submissions, filters]);

  // 重置分页
  React.useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [filteredSubmissions]);

  const totalPages = Math.ceil(filteredSubmissions.length / PAGE_SIZE);
  const pagedData = filteredSubmissions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // 生成页码
  const pageNumbers = React.useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '...')[] = [1];
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  }, [currentPage, totalPages]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // ─── 筛选下拉 ───

  const FILTER_CONFIGS = [
    { key: 'company', label: '公司名称', match: 'fuzzy' as const },
    { key: 'demandType', label: '需求类型', match: 'exact' as const },
    { key: 'newBuilding', label: '成交楼宇', match: 'fuzzy' as const },
    { key: 'subMarket', label: '子市场', match: 'exact' as const },
    { key: 'grade', label: '级别', match: 'exact' as const },
    { key: 'submitter', label: '提交人', match: 'submitter_id' as const },
  ];

  const openDropdown = (key: string, btnEl: HTMLButtonElement | null) => {
    if (activeDropdown === key) { setActiveDropdown(null); setDropdownSearch(''); return; }
    if (btnEl) {
      const rect = btnEl.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setDropdownSearch('');
    setActiveDropdown(key);
  };

  const selectFilter = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setActiveDropdown(null);
    setDropdownSearch('');
  };

  const clearFilter = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFilters(prev => ({ ...prev, [key]: '' }));
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  // 总列数（用于 colSpan）
  const totalColSpan = visibleColumns.length + 1 + (editMode ? 1 : 0); // +1 for expand/序号, +1 for edit

  // ─── 容器样式 ───

  const outerClass = isFullscreen
    ? 'fixed inset-0 z-50 bg-zinc-50 flex flex-col min-w-0'
    : 'rounded-2xl border border-zinc-200/60 bg-white shadow-sm flex flex-col min-w-0 max-h-[75vh]';

  return (
    <div className={outerClass}>
      {/* ── 工具栏 ── */}
      <div className={`shrink-0 border-b border-zinc-200 bg-white px-5 py-3 ${isFullscreen ? '' : 'rounded-t-2xl'}`}>
        <div className={`flex flex-col gap-2.5 ${isFullscreen ? '2xl:flex-row 2xl:items-center 2xl:gap-5' : ''}`}>
          <div className="flex shrink-0 items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <FileText className="text-[#003e7e]" size={17} />
            <div>
              <h3 className="text-[15px] font-semibold text-zinc-900">{title}</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                共 {filteredSubmissions.length} 条
                {activeFilterCount > 0 && <span className="text-[#003e7e] ml-1">· 已筛选 {activeFilterCount} 项</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ company: '', demandType: '', newBuilding: '', subMarket: '', grade: '', submitter: '' })}
                className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                清除全部筛选
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

        {/* 筛选栏 */}
        <div className={`flex flex-wrap gap-1.5 ${isFullscreen ? '2xl:flex-1 2xl:flex-nowrap' : ''}`} ref={dropdownRef}>
          {FILTER_CONFIGS.map((cfg) => {
            const isActive = !!filters[cfg.key as keyof typeof filters];
            const isOpen = activeDropdown === cfg.key;
            const rawOptions = uniqueValues[cfg.key as keyof typeof uniqueValues] || [];
            const isSubmitter = cfg.match === 'submitter_id';
            const searchVal = dropdownSearch.toLowerCase();

            const filtered = isSubmitter
              ? (rawOptions as [string, string][]).filter(([, name]) => name.toLowerCase().includes(searchVal))
              : cfg.match === 'fuzzy'
                ? (rawOptions as string[]).filter(o => o.toLowerCase().includes(searchVal))
                : (searchVal ? (rawOptions as string[]).filter(o => o.toLowerCase().includes(searchVal)) : rawOptions as string[]);

            const selectedValue = filters[cfg.key as keyof typeof filters];
            let displayLabel = cfg.label;
            if (selectedValue && isSubmitter) {
              const found = (rawOptions as [string, string][]).find(([id]) => id === selectedValue);
              displayLabel = found ? found[1] : selectedValue;
            } else if (selectedValue) {
              displayLabel = selectedValue;
            }

            return (
              <div key={cfg.key} className="flex items-center rounded-md">
                <button
                  type="button"
                  ref={(el) => { dropdownBtnRefs.current[cfg.key] = el; }}
                  onClick={() => openDropdown(cfg.key, dropdownBtnRefs.current[cfg.key])}
                  aria-haspopup="listbox"
                  aria-expanded={isOpen}
                  className={`flex items-center gap-1 ${isActive ? 'rounded-l-md' : 'rounded-md'} border px-2 py-1 text-[12px] transition-colors ${
                    isActive
                      ? 'border-[#003e7e] bg-blue-50 text-[#003e7e]'
                      : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'
                  }`}
                >
                  <span className="truncate max-w-[80px]">
                    {displayLabel}
                  </span>
                  <ChevronDown size={11} className="text-zinc-400" />
                </button>
                {isActive && (
                  <button
                    type="button"
                    onClick={(e) => clearFilter(cfg.key, e)}
                    aria-label={`清除${cfg.label}筛选`}
                    className="-ml-px rounded-r-md border border-[#003e7e] bg-blue-50 px-1.5 py-1 text-[12px] text-zinc-400 transition-colors hover:text-[#003e7e]"
                  >
                    ×
                  </button>
                )}

                {isOpen && createPortal(
                  <div
                    data-filter-dropdown
                    style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
                    className="w-48 rounded-lg border border-zinc-200 bg-white shadow-lg overflow-hidden"
                  >
                    <div className="p-1.5 border-b border-zinc-100">
                      <input
                        autoFocus
                        type="text"
                        value={dropdownSearch}
                        onChange={(e) => setDropdownSearch(e.target.value)}
                        placeholder={`搜索${cfg.label}...`}
                        className="w-full px-2 py-1 text-[12px] border border-zinc-200 rounded outline-none focus:border-[#003e7e]"
                      />
                    </div>
                    <div className="max-h-52 overflow-auto">
                      <button
                        onClick={() => selectFilter(cfg.key, '')}
                        className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-50 transition ${
                          !selectedValue ? 'bg-blue-50 text-[#003e7e] font-semibold' : 'text-zinc-600'
                        }`}
                      >
                        全部
                      </button>
                      {isSubmitter ? (
                        (filtered as [string, string][]).map(([id, name]) => (
                          <button
                            key={id}
                            onClick={() => selectFilter(cfg.key, id)}
                            className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-50 transition truncate ${
                              selectedValue === id ? 'bg-blue-50 text-[#003e7e] font-semibold' : 'text-zinc-700'
                            }`}
                          >
                            {name}
                          </button>
                        ))
                      ) : (
                        (filtered as string[]).map((opt) => (
                          <button
                            key={opt}
                            onClick={() => selectFilter(cfg.key, opt)}
                            className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-zinc-50 transition truncate ${
                              selectedValue === opt ? 'bg-blue-50 text-[#003e7e] font-semibold' : 'text-zinc-700'
                            }`}
                          >
                            {opt}
                          </button>
                        ))
                      )}
                      {filtered.length === 0 && (
                        <div className="px-3 py-2 text-[12px] text-zinc-400">无匹配项</div>
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            );
          })}
        </div>
        </div>
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
            {editMode && <col style={{ width: 48 }} />}
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
                >
                  {col.label}
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
                  <p className="text-sm font-medium text-zinc-400">暂无成交记录</p>
                </td>
              </tr>
            ) : (
              pagedData.map((row, idx) => {
                const rowNum = (currentPage - 1) * PAGE_SIZE + idx + 1;
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
                        >
                          {renderCell(col.key, row)}
                        </td>
                      ))}
                      {editMode && (
                        <td className="border-b border-zinc-100 px-1 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); onEdit?.(row); }}
                            aria-label={`编辑${fmt(row.company)}的成交记录`}
                            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-blue-50 hover:text-[#003e7e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/30"
                            title="编辑此记录"
                          >
                            <Edit2 size={14} />
                          </button>
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
            显示 {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredSubmissions.length)} 条，共 {filteredSubmissions.length} 条
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
                    currentPage === p
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
  );
}
