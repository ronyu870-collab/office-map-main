import { z } from 'zod';
import type { SceneElement } from '../contracts/scene';
const designProfiles = ['corporate-executive', 'consulting-minimal', 'architectural-editorial', 'market-intelligence', 'investment-memorandum', 'premium-portfolio'] as const;
const hex = z.string().regex(/^[0-9A-F]{6}$/);
export const designThemeSchema = z.strictObject({
  id: z.string().min(1).max(100), version: z.number().int().positive(), approval: z.enum(['provisional', 'brand_approved']),
  profile: z.enum(designProfiles).optional(),
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

/** Stage 2 themes validate substitution, not two official brand proposals. */
export const STUDIO_THEME = designThemeSchema.parse({ ...DEFAULT_THEME, version: 2,
  fonts: { zh: 'Noto Sans SC', en: 'Noto Sans SC' }, colors: { ...DEFAULT_THEME.colors, background: 'FAF9F6' },
  logo: { ...DEFAULT_THEME.logo, enabled: false }, footer: { enabled: true, pageNumber: true, label: '' },
});
export const VERIFICATION_THEME = designThemeSchema.parse({ ...STUDIO_THEME, id: 'colliers-render-verification', version: 1,
  colors: { primary: '435866', secondary: '7C868B', background: 'F4F5F3', text: '28343A', muted: '56636A' },
  chartColors: ['435866', '84979A', 'B5BEBD'], table: { ...STUDIO_THEME.table, headerFill: 'E4E9E7', border: 'AEBAB7' },
});

type Profile = typeof designProfiles[number];
type Cover = 'portrait' | 'framed' | 'full-bleed' | 'landscape' | 'masthead' | 'folio';
type Evidence = 'side' | 'below';
type ProfileRules = {
  name: string;
  cover: Cover;
  evidence: Evidence;
  imageShare: number;
  table: 'ledger' | 'banded';
  chart: { grid: string; line: number; markers: boolean; gap: number };
};

export const DESIGN_PROFILES: Record<Profile, ProfileRules> = {
  'corporate-executive': { name: 'Corporate Executive', cover: 'portrait', evidence: 'side', imageShare: .54, table: 'ledger', chart: { grid: 'D9DFE6', line: 2, markers: false, gap: 82 } },
  'consulting-minimal': { name: 'Consulting Minimal', cover: 'framed', evidence: 'side', imageShare: .43, table: 'ledger', chart: { grid: 'DDE0DE', line: 1.5, markers: false, gap: 58 } },
  'architectural-editorial': { name: 'Architectural Editorial', cover: 'full-bleed', evidence: 'below', imageShare: .69, table: 'ledger', chart: { grid: 'DDD7CC', line: 2.5, markers: false, gap: 115 } },
  'market-intelligence': { name: 'Market Intelligence', cover: 'masthead', evidence: 'side', imageShare: .49, table: 'banded', chart: { grid: 'D5E1E4', line: 2.25, markers: true, gap: 64 } },
  'investment-memorandum': { name: 'Investment Memorandum', cover: 'landscape', evidence: 'below', imageShare: .46, table: 'banded', chart: { grid: 'DFDAD0', line: 1.75, markers: true, gap: 90 } },
  'premium-portfolio': { name: 'Premium Portfolio', cover: 'folio', evidence: 'below', imageShare: .65, table: 'ledger', chart: { grid: 'DADBD3', line: 2.5, markers: true, gap: 125 } },
};

function candidate(profile: Profile, background: string, primary: string, chartColors: string[], headerFill: string, title: number, body: number, margin: number) {
  return designThemeSchema.parse({
    ...STUDIO_THEME, id: 'colliers-' + profile, version: 1, profile, approval: 'provisional', margin,
    colors: { ...STUDIO_THEME.colors, background, primary, text: '243038', muted: '4C5962' },
    typography: { title, body },
    chartColors, table: { headerFill, border: DESIGN_PROFILES[profile].chart.grid, cellPadding: .09 },
  });
}

export const PRESENTATION_THEME_CANDIDATES = [
  candidate('corporate-executive', 'F5F7F8', '183653', ['265680', '67929F', '8C715E', '536873'], 'E8EFF3', 31, 17, .62),
  candidate('consulting-minimal', 'F7F8F5', '26362F', ['34574A', '819588', '756651', '5B6872'], 'ECEFE9', 29, 17, .68),
  candidate('architectural-editorial', 'F6F2EB', '3D3B31', ['5A5A43', '9D7458', '627985', '665870'], 'EAE3D8', 33, 17, .65),
  candidate('market-intelligence', 'F3F7F8', '1E3E52', ['1E5874', '387D72', '9B624A', '6B6680'], 'E4EEF1', 29, 16, .60),
  candidate('investment-memorandum', 'F7F4EE', '43392E', ['69503B', '547373', '8A7456', '626C81'], 'EEE8DD', 28, 16, .70),
  candidate('premium-portfolio', 'F4F3ED', '37483D', ['425F51', 'A07959', '657581', '78677A'], 'E8EADF', 33, 17, .74),
];

type SceneText = Extract<SceneElement, { kind: 'text' }>;
export function textSize(theme: DesignTheme, role: SceneText['role'], semantic?: SceneText['semantic']) {
  if (!theme.profile || !semantic) return theme.typography[role];
  if (semantic === 'cover') return theme.typography.title + 8;
  if (semantic === 'caption' || semantic === 'source' || semantic === 'footer') return 11;
  return theme.typography[role];
}
export function textColor(theme: DesignTheme, element: SceneText) {
  if (element.purpose || element.semantic === 'caption') return theme.colors.muted;
  return element.role === 'title' ? theme.colors.primary : theme.colors.text;
}
export const chartTextSize = (theme: DesignTheme) => theme.profile ? 12 : theme.typography.body;

export function candidateThemeLabel(id: string) {
  const candidate = PRESENTATION_THEME_CANDIDATES.find(theme => theme.id === id);
  return candidate?.profile ? DESIGN_PROFILES[candidate.profile].name + '（候选）' : undefined;
}
