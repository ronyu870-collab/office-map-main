import { z } from 'zod';
import { resultViewSchema, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
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
