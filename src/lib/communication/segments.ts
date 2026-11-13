export type MarketColor = 'blue' | 'red' | 'green';
export type MarketSegment = {
  text: string;
  bold?: boolean;
  color?: MarketColor;
  mentionUserId?: string;
  everyone?: true;
};
export type MarketMember = { id: string; name: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = new Set<MarketColor>(['blue', 'red', 'green']);

export function normalizeMarketSegments(value: unknown): MarketSegment[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return null;
  let length = 0;
  const result: MarketSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some(key => !['text', 'bold', 'color', 'mentionUserId', 'everyone'].includes(key))) return null;
    if (typeof raw.text !== 'string' || !raw.text.length) return null;
    if (raw.bold !== undefined && typeof raw.bold !== 'boolean') return null;
    if (raw.color !== undefined && (typeof raw.color !== 'string' || !COLORS.has(raw.color as MarketColor))) return null;
    if (raw.mentionUserId !== undefined && (typeof raw.mentionUserId !== 'string' || !UUID.test(raw.mentionUserId) || !raw.text.startsWith('@'))) return null;
    if (raw.everyone !== undefined && (raw.everyone !== true || raw.text !== '@所有人')) return null;
    if (raw.everyone && raw.mentionUserId) return null;
    length += raw.text.length;
    if (length > 2000) return null;
    result.push({
      text: raw.text,
      ...(raw.bold ? { bold: true } : {}),
      ...(raw.color ? { color: raw.color as MarketColor } : {}),
      ...(raw.mentionUserId ? { mentionUserId: raw.mentionUserId } : {}),
      ...(raw.everyone ? { everyone: true as const } : {}),
    });
  }
  return result.map((segment, index) => {
    // Ignore harmless whitespace outside the message, without changing mention tokens.
    if (result.length === 1 && !segment.mentionUserId && !segment.everyone) {
      return { ...segment, text: segment.text.trim() };
    }
    return segment;
  }).filter(segment => segment.text.length > 0);
}

export function segmentText(segments: readonly MarketSegment[]) {
  return segments.map(part => part.text).join('');
}

export function editorSegments(root: HTMLElement): MarketSegment[] {
  const result: MarketSegment[] = [];
  const append = (text: string, style: Omit<MarketSegment, 'text'>) => {
    const clean = text.replace(/\u200b/g, '');
    if (!clean) return;
    const last = result[result.length - 1];
    if (last && last.bold === style.bold && last.color === style.color
      && last.mentionUserId === style.mentionUserId && last.everyone === style.everyone
      && !style.everyone && !style.mentionUserId) {
      last.text += clean;
    } else {
      result.push({ text: clean, ...style });
    }
  };
  const walk = (node: Node, style: Omit<MarketSegment, 'text'>) => {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.textContent || '', style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.tagName === 'BR') { append('\n', style); return; }
    const mention = element.dataset.mentionUserId;
    if (mention && UUID.test(mention)) {
      append(element.textContent || '', { mentionUserId: mention });
      return;
    }
    if (element.dataset.mentionEveryone === 'true') {
      append('@所有人', { everyone: true });
      return;
    }
    const declaredColor = element.dataset.marketColor
      ?? element.style.color
      ?? (element.tagName === 'FONT' ? element.getAttribute('color') : null);
    const normalizedCssColor = (declaredColor || '').toLowerCase().replaceAll(' ', '');
    const color: MarketColor | null = normalizedCssColor === '#003e7e' || normalizedCssColor === 'rgb(0,62,126)'
      ? 'blue' : normalizedCssColor === '#c9362b' || normalizedCssColor === 'rgb(201,54,43)'
      ? 'red' : normalizedCssColor === '#16855b' || normalizedCssColor === 'rgb(22,133,91)'
      ? 'green' : COLORS.has(normalizedCssColor as MarketColor) ? normalizedCssColor as MarketColor : null;
    const nextStyle = {
      ...style,
      ...(element.tagName === 'STRONG' || element.tagName === 'B' || element.style.fontWeight === 'bold' || Number(element.style.fontWeight) >= 600 ? { bold: true } : {}),
      ...(color ? { color } : {}),
    };
    const block = element.tagName === 'DIV' || element.tagName === 'P';
    if (block && result.length && !result[result.length - 1].text.endsWith('\n')) append('\n', style);
    Array.from(element.childNodes).forEach(child => walk(child, nextStyle));
  };
  Array.from(root.childNodes).forEach(child => walk(child, {}));
  while (result.length && result[result.length - 1].text.endsWith('\n')) {
    const last = result[result.length - 1];
    last.text = last.text.replace(/\n+$/, '');
    if (last.text.length) break;
    result.pop();
  }
  return result;
}
