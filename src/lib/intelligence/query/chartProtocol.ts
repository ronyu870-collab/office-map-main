import { z } from 'zod';
import { chartRequestSchema } from './chartSpec';

export const agentChartDescriptorSchema = z.strictObject({
  version: z.literal('chart-workspace/1'), request: chartRequestSchema,
  format: z.enum(['png_zip', 'svg_zip']).optional(),
});
export const chartContextSchema = z.strictObject({ resultId: z.uuid(), chart: chartRequestSchema });
