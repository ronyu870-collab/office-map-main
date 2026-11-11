'use client';

import * as React from 'react';
import { Check, Download, Loader2 } from 'lucide-react';

import { Button } from '@/src/components/ui/Button';
import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { logAction } from '@/src/utils/audit';
import {
  LEASE_EXPORT_COLUMNS,
  buildLeaseExportRows,
  leaseExportColumnWidths,
  leaseExportFileName,
  type LeaseExportRecord,
} from '../leaseExport';

type ExportState = 'idle' | 'loading' | 'success' | 'error';

export function AdminLeaseExportButton() {
  const [state, setState] = React.useState<ExportState>('idle');
  const [error, setError] = React.useState('');
  const resetTimer = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const scheduleReset = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      setState('idle');
      setError('');
    }, 1800);
  };

  const exportAll = async () => {
    if (state === 'loading') return;
    setState('loading');
    setError('');

    try {
      const session = await getSessionFast();
      const token = session?.session?.access_token;
      if (!token) throw new Error('登录状态异常，请重新登录');

      const response = await fetch('/api/lease-submission/export', {
        headers: withImpersonationHeaders({ Authorization: `Bearer ${token}` }),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as {
        records?: LeaseExportRecord[];
        count?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || '导出失败');

      const records = Array.isArray(body.records) ? body.records : [];
      const XLSX = await import('xlsx');
      const rows = buildLeaseExportRows(records);
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet['!cols'] = leaseExportColumnWidths();
      worksheet['!autofilter'] = {
        ref: `A1:${XLSX.utils.encode_col(LEASE_EXPORT_COLUMNS.length - 1)}${Math.max(1, rows.length)}`,
      };

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '租赁成交');
      const filename = leaseExportFileName();
      XLSX.writeFile(workbook, filename, { compression: true });

      logAction(session.user?.email || '未知用户', 'EXPORT_LEASE_TRANSACTIONS', {
        record_count: records.length,
        file_name: filename,
        target_name: filename,
      });
      setState('success');
      scheduleReset();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '导出失败，请稍后重试';
      setError(message);
      setState('error');
    }
  };

  return (
    <div className="min-w-0 max-w-44">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => { void exportAll(); }}
        disabled={state === 'loading'}
        aria-busy={state === 'loading'}
        data-state={state}
        className="w-full sm:w-auto data-[state=error]:text-red-700 data-[state=error]:hover:bg-[var(--cd-color-danger-soft)] data-[state=success]:bg-[var(--cd-color-success-soft)] data-[state=success]:text-[var(--cd-color-text-primary)]"
        title={error || '导出全部租赁成交数据'}
      >
        {state === 'loading'
          ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
          : state === 'success'
            ? <Check aria-hidden="true" className="text-[var(--cd-color-success)]" />
            : <Download aria-hidden="true" />}
        {state === 'loading' ? '导出中…' : state === 'success' ? '已导出' : state === 'error' ? '导出失败' : '导出数据'}
      </Button>
      {state === 'error' && error && (
        <p role="alert" className="px-3 text-xs text-red-700 [overflow-wrap:anywhere]">{error}</p>
      )}
    </div>
  );
}
