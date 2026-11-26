export const exportFormats = ['pptx', 'png', 'svg', 'xlsx'] as const;
export type ExportFormat = typeof exportFormats[number];
export const MIME: Record<ExportFormat, string> = { pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', png: 'image/png', svg: 'image/svg+xml', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
export function artifactName(title: string, format: ExportFormat, page?: number) {
  const safe = title.normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|\u202a-\u202e\u2066-\u2069]/g, '_').trim().slice(0, 90) || 'Pitch';
  return `${safe}${page === undefined ? '' : `-${String(page + 1).padStart(2, '0')}`}.${format}`;
}
export const cellText = (v: string | number | null) => v === null ? '—' : typeof v === 'number' ? (Math.abs(v) >= 1e9 || Math.abs(v) > 0 && Math.abs(v) < .0001 ? v.toExponential(3) : String(v)) : v;
