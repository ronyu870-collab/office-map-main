import { z } from 'zod';
import { metricSchema } from './multiMetricView';

export const chartAxisSchema = z.strictObject({
  min: z.number().finite().min(-1e15).max(1e15).optional(),
  max: z.number().finite().min(-1e15).max(1e15).optional(),
  ticks: z.number().int().min(2).max(12).optional(),
  unit: z.string().min(1).max(40).optional(),
});
const options = {
  title: z.string().trim().min(1).max(160).optional(),
  legend: z.boolean().optional(),
  xAxis: chartAxisSchema.optional(), yAxis: chartAxisSchema.optional(),
  sort: z.strictObject({ field: z.string().min(1).max(80), direction: z.enum(['asc', 'desc']) }).optional(),
};
/** Bindings and display configuration only; never accepts data, sources or SVG. */
export const chartRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('plot'), type: z.enum(['bar', 'horizontal_bar', 'line', 'scatter']),
    x: z.string().min(1).max(80), y: z.array(z.string().min(1).max(80)).min(1).max(6),
    groupBy: z.string().min(1).max(80).optional(),
    periods: z.array(z.string().regex(/^\d{4}-?Q[1-4]$/)).min(1).max(40).optional(), ...options }),
  z.strictObject({ kind: z.literal('bar'), field: z.string().min(1).max(80), metric: metricSchema.optional(), ...options }),
  z.strictObject({ kind: z.literal('scatter'), x: z.string().min(1).max(80), y: z.string().min(1).max(80), ...options }),
  z.strictObject({ kind: z.literal('period_comparison'), metric: metricSchema.optional(), ...options }),
  z.strictObject({ kind: z.literal('time_series'), metric: metricSchema.optional(), ...options }),
  z.strictObject({ kind: z.literal('grouped_time_series'), metric: metricSchema.optional(), ...options }),
  z.strictObject({ kind: z.literal('heatmap'), metric: metricSchema.optional(), ...options }),
  z.strictObject({ kind: z.literal('histogram'), ...options }),
  z.strictObject({ kind: z.literal('box_plot'), ...options }),
]);
export type ChartRequest = z.infer<typeof chartRequestSchema>;
