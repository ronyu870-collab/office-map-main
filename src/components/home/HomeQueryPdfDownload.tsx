'use client';

import { reportDescriptorSchema } from '@/src/lib/intelligence/query/reportProtocol';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { HomeQueryFileAttachment } from './HomeQueryFileAttachment';

export function HomeQueryPdfDownload({ descriptor, requestId, resultId, scope, internalExport, filename }: {
  descriptor: unknown; requestId: string; resultId: string; scope: QueryClientScope; internalExport: boolean; filename?: string;
}) {
  const prepared = reportDescriptorSchema.safeParse(descriptor).data;
  return prepared?.format === 'pdf' ? <HomeQueryFileAttachment key={`${requestId}:${resultId}`} scope={scope} requestId={requestId} resultId={resultId}
    internalExport={internalExport} filename={filename ?? '内部研究报告.pdf'} format="pdf"
    description={`PDF · ${prepared.sectionCount} 个研究部分`} label="本条回答生成的 PDF 报告" /> : null;
}
