import { z } from 'zod';
const hex = z.string().regex(/^[0-9A-F]{6}$/);
export const designThemeSchema = z.strictObject({
  id: z.string().min(1).max(100), version: z.number().int().positive(), approval: z.enum(['provisional', 'brand_approved']),
  width: z.literal(13.333333), height: z.literal(7.5),
  colors: z.strictObject({ primary: hex, secondary: hex, background: hex, text: hex, muted: hex }),
  logo: z.strictObject({ resource: z.literal('colliers-brand-assets/1'), enabled: z.boolean() }),
  fonts: z.strictObject({ zh: z.string().min(1).max(100), en: z.string().min(1).max(100) }),
  typography: z.strictObject({ title: z.number().min(24).max(44), body: z.number().min(16).max(24) }),
  margin: z.number().min(.4).max(.8), gridGap: z.number().min(.2).max(.5),
  chartColors: z.array(hex).min(2).max(10),
  table: z.strictObject({ headerFill: hex, border: hex, cellPadding: z.number().min(.05).max(.2) }),
  footer: z.strictObject({ enabled: z.boolean(), pageNumber: z.boolean(), label: z.string().max(150) }),
});
export type DesignTheme = z.infer<typeof designThemeSchema>;
/** Provisional technical baseline, NOT an approved Colliers master. Immutable by version. */
export const DEFAULT_THEME: DesignTheme = designThemeSchema.parse({
  id: 'colliers-default-v1', version: 1, approval: 'provisional', width: 13.333333, height: 7.5,
  colors: { primary: '25408F', secondary: '777C88', background: 'F5F4F1', text: '243044', muted: '596273' },
  logo: { resource: 'colliers-brand-assets/1', enabled: true }, fonts: { zh: 'Microsoft YaHei', en: 'Arial' },
  typography: { title: 30, body: 18 }, margin: .6, gridGap: .3, chartColors: ['25408F', '778BA5', 'B1B9C3'],
  table: { headerFill: 'E8EBF0', border: 'BBC2CB', cellPadding: .1 },
  footer: { enabled: true, pageNumber: true, label: '临时主题 · 未经品牌确认' },
});
