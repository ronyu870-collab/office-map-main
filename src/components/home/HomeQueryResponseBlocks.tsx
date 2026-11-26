'use client';

import dynamic from 'next/dynamic';
import type { QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryClientScope } from '@/src/services/trustedQueryClient';
import { agentExportDescriptorSchema } from '@/src/lib/intelligence/query/exportProtocol';
import { buildArtifactFilename } from '@/src/lib/intelligence/query/artifactFilename';
import { HomeQueryDataTable } from './HomeQueryDataTable';
import { HomeQueryExportDownload } from './HomeQueryExportDownload';
import { HomeQueryPdfDownload } from './HomeQueryPdfDownload';

function FileBlock({ result, requestId, scope, internalExport }: {
  result: QueryResultView; requestId: string; scope: QueryClientScope; internalExport: boolean;
}) {
  const exported = agentExportDescriptorSchema.safeParse(result.parameters.agentExport).data;
  return <>
    {!result.parameters.researchTask && <HomeQueryPdfDownload descriptor={result.parameters.agentReport} filename={buildArtifactFilename(result, 'pdf')}
      requestId={requestId} resultId={result.resultId} scope={scope} internalExport={internalExport} />}
    <HomeQueryExportDownload descriptor={result.parameters.agentExport} filename={exported ? buildArtifactFilename(result, exported.format) : undefined}
      requestId={requestId} resultId={result.resultId} scope={scope} internalExport={internalExport} />
  </>;
}

/** Registered modular renderers for versioned response blocks. Summary,
 * metrics and sources share the result shell so they retain its source/focus
 * controller instead of creating independent requests or state stores. */
export const responseBlockRenderers = Object.freeze({
  text: dynamic(() => import('./HomeQueryMarkdown').then(module => module.HomeQueryMarkdown), { loading: () => null }),
  table: HomeQueryDataTable,
  chart: dynamic(() => import('./HomeQueryChartWorkspace').then(module => module.HomeQueryChartWorkspace), { loading: () => <p role="status">正在打开图表…</p> }),
  building: dynamic(() => import('./HomeQueryBuildings').then(module => module.HomeQueryBuildings), {
    loading: () => <p role="status">正在打开楼宇信息…</p>,
  }),
  file: FileBlock,
});
