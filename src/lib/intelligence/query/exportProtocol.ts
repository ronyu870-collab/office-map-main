import { z } from 'zod';

/** Presentation metadata only. Download still recovers the owner-only archive
 * and checks live export grants, all original plans and source ACLs. */
export const agentExportDescriptorSchema = z.object({
  version: z.literal('agent-export/1'), format: z.enum(['xlsx', 'csv_zip']),
  singleSheet: z.boolean(), matchedRows: z.number().int().nonnegative(),
  exportedRows: z.number().int().nonnegative(),
});
