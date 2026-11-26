import type { SlideScene } from '../contracts/scene';
import type { DesignTheme } from '../design/theme';
/** A deck is numbered after composing content groups, identically for preview
 * and all renderers. Local pagination indices remain stable for theme upgrades. */
export function numberDeckPages<T extends { scene: SlideScene; theme: DesignTheme }>(pages: T[], start = 0): T[] {
  return pages.map((p, i) => ({ ...p, scene: { ...p.scene, elements: p.scene.elements.map(e => e.kind === 'text' && e.purpose === 'footer' ? { ...e, text: [p.theme.footer.label, p.theme.footer.pageNumber ? String(start + i + 1) : ''].filter(Boolean).join(' · ') } : e) } }));
}
