'use client';

import { FileSpreadsheet, FileText, Download } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { useQueryDownload } from './useQueryDownload';
import styles from './HomeQueryFileAttachment.module.css';

type Props = { scope: QueryClientScope; requestId: string; resultId: string; internalExport: boolean;
  filename: string; format: 'xlsx' | 'csv_zip' | 'pdf' | 'docx' | 'pptx'; description: string; label: string };
export function HomeQueryFileAttachment({ scope, requestId, resultId, internalExport, filename, format, description, label }: Props) {
  const { state, message, busy, download } = useQueryDownload(scope, requestId, resultId);
  const Icon = format === 'xlsx' || format === 'csv_zip' ? FileSpreadsheet : FileText;
  const formatLabel = { xlsx: 'Excel', pdf: 'PDF 研究报告', csv_zip: 'CSV 与来源', docx: 'Word', pptx: 'PowerPoint' }[format];
  return <section className={styles.attachment} aria-label={label} data-state={state}>
    <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
    <div className={styles.description}><strong title={filename}>{filename}</strong><p>{description} · 仅供内部分析</p>
      {message && <p role="status" className={state === 'failed' ? styles.error : undefined}>{message}</p>}</div>
    {internalExport ? <Button variant="secondary" disabled={busy} aria-label={`下载 ${formatLabel}`}
      onClick={() => void download({ format })}><Download size={16} aria-hidden="true" />{busy ? '准备中' : state === 'failed' ? '重试下载' : '下载'}</Button>
      : <span>当前无导出权限</span>}
  </section>;
}
