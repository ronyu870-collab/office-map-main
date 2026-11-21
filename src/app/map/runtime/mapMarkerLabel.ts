const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

// Full names remain in the detail/hover record. Map labels must never become
// a tall text column or split an emoji/combining character at the cut.
export function mapBuildingLabel(name: string): string {
  const compact = name.trim().replace(/\s+/g, ' ');
  const parts = Array.from(segmenter.segment(compact), part => part.segment);
  return parts.length <= 12 ? compact : parts.slice(0, 11).join('') + '…';
}
