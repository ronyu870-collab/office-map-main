'use client';

import * as React from 'react';
import { X, Building2, FileText } from 'lucide-react';
import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { MaskedCell } from '@/src/components/demo';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SubmissionDetailModalProps {
  /** 是否显示弹窗 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 要展示的成交记录列表（已在外部按需过滤） */
  submissions: LeaseTransaction[];
  /** 弹窗标题，如 "张三 的成交填报明细" 或 "团队全量明细" */
  title: string;
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

function fmtDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ─── 列定义 ───────────────────────────────────────────────────────────────────

interface ColDef {
  label: string;
  width: string;
  render: (row: LeaseTransaction) => React.ReactNode;
}

const COLUMNS: ColDef[] = [
  {
    label: '公司名称',
    width: 'min-w-[160px]',
    render: (r) => (
      <MaskedCell masked><span className="font-medium text-zinc-900">{fmt(r.company)}</span></MaskedCell>
    ),
  },
  {
    label: '疑似全称',
    width: 'min-w-[180px]',
    render: (r) => <MaskedCell masked><span className="text-zinc-600">{fmt(r.suspected_company_fullname)}</span></MaskedCell>,
  },
  {
    label: '企业类型',
    width: 'min-w-[80px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.enterprise_type)}</span>,
  },
  {
    label: '行业',
    width: 'min-w-[100px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.industry)}</span>,
  },
  {
    label: '行业细分',
    width: 'min-w-[100px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.sub_industry)}</span>,
  },
  {
    label: '需求类型',
    width: 'min-w-[80px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.demand_type)}</span>,
  },
  {
    label: '新租楼宇',
    width: 'min-w-[160px]',
    render: (r) => (
      <div className="flex items-center gap-1.5">
        <Building2 size={13} className="shrink-0 text-zinc-400" />
        <MaskedCell masked><span className="text-zinc-800">{fmt(r.new_building)}</span></MaskedCell>
      </div>
    ),
  },
  {
    label: '子市场',
    width: 'min-w-[80px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.sub_market)}</span>,
  },
  {
    label: '行政区',
    width: 'min-w-[80px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.district)}</span>,
  },
  {
    label: '楼宇级别',
    width: 'min-w-[72px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.building_grade)}</span>,
  },
  {
    label: '旧址',
    width: 'min-w-[160px]',
    render: (r) => <MaskedCell masked><span className="text-zinc-600">{fmt(r.old_address)}</span></MaskedCell>,
  },
  {
    label: '旧址子市场',
    width: 'min-w-[88px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.old_sub_market)}</span>,
  },
  {
    label: '旧址级别',
    width: 'min-w-[72px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.old_building_grade)}</span>,
  },
  {
    label: '面积(㎡)',
    width: 'min-w-[88px]',
    render: (r) => (
      <span className="tabular-nums text-right block text-zinc-700">
        {fmtNum(r.area_sqm)}
      </span>
    ),
  },
  {
    label: '表面租金',
    width: 'min-w-[80px]',
    render: (r) => (
      <span className="tabular-nums text-right block text-zinc-700">
        {fmtNum(r.face_rent)}
      </span>
    ),
  },
  {
    label: '有效租金',
    width: 'min-w-[80px]',
    render: (r) => (
      <span className="tabular-nums text-right block font-medium text-[#003e7e]">
        {fmtNum(r.effective_rent)}
      </span>
    ),
  },
  {
    label: '租期(月)',
    width: 'min-w-[72px]',
    render: (r) => (
      <span className="tabular-nums text-right block text-zinc-700">
        {fmtNum(r.lease_term_months)}
      </span>
    ),
  },
  {
    label: '装修期(月)',
    width: 'min-w-[80px]',
    render: (r) => (
      <span className="tabular-nums text-right block text-zinc-700">
        {fmtNum(r.fit_out_months)}
      </span>
    ),
  },
  {
    label: '免租期(月)',
    width: 'min-w-[80px]',
    render: (r) => (
      <span className="tabular-nums text-right block text-zinc-700">
        {fmtNum(r.rent_free_months)}
      </span>
    ),
  },
  {
    label: '成交季度',
    width: 'min-w-[80px]',
    render: (r) => <span className="text-zinc-600">{fmt(r.transaction_quarter)}</span>,
  },
  {
    label: '备注',
    width: 'min-w-[160px]',
    render: (r) => (
      <span className="text-zinc-500 text-xs leading-relaxed">{fmt(r.remarks)}</span>
    ),
  },
  {
    label: '提交人',
    width: 'min-w-[80px]',
    render: (r) => <MaskedCell masked><span className="text-zinc-700">{fmt(r.submitter_name)}</span></MaskedCell>,
  },
  {
    label: '提交时间',
    width: 'min-w-[140px]',
    render: (r) => (
      <span className="text-zinc-500 text-xs">{fmtDateTime(r.created_at)}</span>
    ),
  },
];

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function SubmissionDetailModal({
  isOpen,
  onClose,
  submissions,
  title,
}: SubmissionDetailModalProps) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const PAGE_SIZE = 20;

  // 重置分页（每次打开或数据变化时）
  React.useEffect(() => {
    if (isOpen) setCurrentPage(1);
  }, [isOpen, submissions]);

  // ESC 关闭
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 锁定背景滚动
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const totalPages = Math.ceil(submissions.length / PAGE_SIZE);
  const pagedData = submissions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex w-full max-w-[95vw] flex-col rounded-lg border border-zinc-200 bg-white shadow-[var(--cd-shadow-overlay)] xl:max-w-[1400px]"
        style={{ maxHeight: '90vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-title"
      >
        {/* ── 弹窗头部 ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="text-[#003e7e]" size={20} />
            <div>
              <h2
                id="detail-modal-title"
                className="text-base font-semibold text-zinc-900"
              >
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                共 {submissions.length} 条记录 · 数据范围：2026-04-23 至今 · 仅供查阅
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── 表格区域 ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          {submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <FileText className="mb-3 text-zinc-300" size={48} />
              <p className="text-sm text-zinc-500">暂无成交记录</p>
              <p className="mt-1 text-xs text-zinc-400">该时间范围内没有找到数据</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-zinc-200 bg-zinc-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 min-w-[48px]">
                    #
                  </th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.label}
                      className={`px-4 py-3 text-left text-xs font-semibold text-zinc-600 whitespace-nowrap ${col.width}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {pagedData.map((row, idx) => (
                  <tr
                    key={row.id ?? idx}
                    className="hover:bg-zinc-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-zinc-400 tabular-nums">
                      {(currentPage - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    {COLUMNS.map((col) => (
                      <td
                        key={col.label}
                        className={`px-4 py-3 ${col.width}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── 分页 ── */}
        {totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-zinc-100 bg-zinc-50/50 px-6 py-3">
            <p className="text-xs text-zinc-500">
              第 {currentPage} / {totalPages} 页，共 {submissions.length} 条
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        )}

        {/* ── 底部只读声明 ── */}
        <div className="shrink-0 border-t border-zinc-100 bg-zinc-50/80 px-6 py-2.5">
          <p className="text-center text-[11px] text-zinc-400">
            🔒 此视图为只读模式，不支持编辑、删除、新增或导出操作
          </p>
        </div>
      </div>
    </div>
  );
}
