import { z } from 'zod';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import type { QueryResult } from '@/src/lib/intelligence/query/result';
import { digest } from '../data/store';

const { operation, table, sources } = resultViewSchema.shape;
export const documentResultSchema = z.object({ operation, table, sources });

/** Query receipt IDs and timestamps change on every read. Compare the visible
 * values and the original, versioned facts instead of the transport receipt. */
export function documentDataVersion(results: Pick<QueryResultView, 'operation' | 'table' | 'sources'>[]) {
  const canonical = results.map(({ operation, table, sources }) => ({
    operation, columns: table.columns,
    rows: table.rows.map(row => ({
      ...row, cells: Object.fromEntries(Object.entries(row.cells).sort(([a], [b]) => a.localeCompare(b))),
    })),
    sources: [...sources].sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return digest(Buffer.from(JSON.stringify(canonical)));
}

/** Persist the reviewed result and the smallest source identity needed for
 * editorial citations whose page IDs differ from the query result ID. */
export function captureReviewedQuery(result: Pick<QueryResult,
  'resultId' | 'operation' | 'parameters' | 'table' | 'scopeFingerprint' | 'registryVersion' | 'sources'
>) {
  const { resultId, operation, parameters, table, scopeFingerprint, registryVersion, sources } = result;
  const fields = [...new Set(sources.map(source => source.field))].sort();
  const sourceKeys = sources.filter(source => source.table === 'map_submarket_profiles')
    .map(({ table, recordId, recordVersion, field }) => ({ table, recordId, recordVersion, field }));
  return {
    resultId, operation, parameters, table, scopeFingerprint, registryVersion,
    sourceFingerprint: digest(Buffer.from(JSON.stringify(sources))),
    fields: fields.length ? fields : table.columns.map(column => column.key),
    ...(sourceKeys.length ? { sourceKeys } : {}),
  };
}
