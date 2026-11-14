import { z } from 'zod';

export const deliveryViewSchema = z.discriminatedUnion('surface', [
  z.strictObject({ surface: z.literal('answer_table'), page: z.number().int().min(0).max(100000), pageSize: z.literal(25), sourceIds: z.array(z.string().min(1).max(160)).max(10) }),
  z.strictObject({ surface: z.literal('chart'), page: z.number().int().min(0).max(100000), pageSize: z.literal(25), layout: z.enum(['bar_page', 'scatter_all', 'line_all', 'faceted_line_all', 'heatmap_all', 'histogram_all', 'box_plot_all', 'interval_page']) }),
  z.strictObject({surface:z.literal('map'),page:z.number().int().min(0).max(100000),pageSize:z.literal(25),
    viewport:z.strictObject({cx:z.number().min(-400).max(400),cy:z.number().min(-200).max(200),span:z.number().min(0.0001).max(1000)}).nullable(),
    width:z.number().int().min(64).max(4096),height:z.number().int().min(100).max(2000),
    selectedIndices:z.array(z.number().int().min(0).max(4999)).min(1).max(5000).nullable(),baseStatus:z.enum(['loading','ready','error'])}),
  z.strictObject({ surface: z.literal('clarification') }),
]);
export type DeliveryView = z.infer<typeof deliveryViewSchema>;
export const deliveryReportSchema = z.strictObject({
  deliveryToken: z.string().min(1).max(4000), bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(['client_received', 'client_dom_committed', 'browser_download_dispatched']),
  view: deliveryViewSchema.optional(),
});
export type DeliveryReport = z.infer<typeof deliveryReportSchema>;
export type DeliveryReceipt = Pick<DeliveryReport, 'deliveryToken' | 'bodySha256'>;
