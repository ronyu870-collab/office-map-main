'use client';

import { agentExportDescriptorSchema } from '@/src/lib/intelligence/query/exportProtocol';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { HomeQueryFileAttachment } from './HomeQueryFileAttachment';

export function HomeQueryExportDownload({ descriptor, requestId, resultId, scope, internalExport, filename }: {
  descriptor: unknown; requestId: string; resultId: string; scope: QueryClientScope; internalExport: boolean; filename?: string;
}) {
  const prepared = agentExportDescriptorSchema.safeParse(descriptor).data;
  return prepared ? <HomeQueryFileAttachment key={`${requestId}:${resultId}`} scope={scope} requestId={requestId} resultId={resultId}
    internalExport={internalExport} filename={filename ?? `楼宇查询结果.${prepared.format === 'xlsx' ? 'xlsx' : 'zip'}`}
    format={prepared.format} description={`${prepared.format === 'xlsx' ? 'Excel' : 'CSV 与来源'} · ${prepared.exportedRows} 条记录`}
    label="本条回答生成的文件" /> : null;
}
