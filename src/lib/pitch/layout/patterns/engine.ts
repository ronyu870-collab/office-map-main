import type { SlideContent } from '../../contracts/content';
import type { SceneElement } from '../../contracts/scene';
import { sceneComponents } from '../components';
import { LayoutError } from '../metrics';
import { chartElement } from '../chart';
import { tablePages } from '../table';
import { cellText } from '../../render/format';
import type { LayoutPattern, PatternSlot } from './catalog';
type Tools = ReturnType<typeof sceneComponents>;
type Block = SlideContent['blocks'][number];
type Box = {
    x: number;
    y: number;
    w: number;
    h: number;
};
const chunk = <T,>(v: T[], n: number): T[][] => Array.from({ length: Math.ceil(v.length / n) }, (_, i) => v.slice(i * n, (i + 1) * n));
const fail = (code: string, detail: string): never => { throw new LayoutError(code, detail); };
function textPages(text: string, box: Box, t: Tools): SceneElement[][] {
    const capacity = Math.floor((box.h + .01) / t.lh);
    if (!capacity)
        return fail('PITCH_TEXT_CAPACITY', '插槽不足一行可读文字，请更换布局。');
    return chunk(t.lines(text, box.w), capacity).map(lines => [t.text(lines.join('\n'), box.x, box.y, box.w, box.h)]);
}
function slotPages(b: Block, box: Box, t: Tools, pattern: LayoutPattern, en: boolean): SceneElement[][] {
    if (b.kind === 'paragraph')
        return textPages(b.text, box, t);
    if (b.kind === 'image')
        return [t.imageWithCredit(b, box.x, box.y, box.w, box.h)];
    if (b.kind === 'metric') {
        const changes = [b.yoy === undefined ? '' : `${en ? 'YoY' : '同比'} ${cellText(b.yoy)}%`, b.qoq === undefined ? '' : `${en ? 'QoQ' : '环比'} ${cellText(b.qoq)}%`].filter(Boolean);
        return textPages([b.label, `${cellText(b.value)} ${b.unit}`, ...changes].join('\n'), box, t);
    }
    if (b.kind === 'table')
        return tablePages(b, t, box.x, box.y, box.w, box.h);
    if (b.kind === 'chart')
        return [[chartElement(b, box, t)]];
    if (b.kind === 'case')
        return textPages(`${b.title}\n${en ? 'Challenge' : '挑战'}：${b.challenge}\n${en ? 'Approach' : '方法'}：${b.approach}\n${en ? 'Outcome' : '成果'}：${b.outcome}`, box, t);
    if (b.kind === 'team') {
        // Directory rows and a leader/crew split use the same pinned member/photo
        // primitives, with no inferred hierarchy or identities.
        const per = pattern.id === 'team-directory' ? 2 : 1;
        return chunk(b.members, per).flatMap(members => {
            const groups: SceneElement[][] = [];
            for (const [i, member] of members.entries()) {
                const h = (box.h - .2 * (per - 1)) / per, y = box.y + i * (h + .2), iw = Math.min(box.w * .25, h), gap = .2;
                const text = `${member.name}\n${member.title}\n${member.biography}`;
                const pages = textPages(text, { x: box.x + iw + gap, y, w: box.w - iw - gap, h }, t);
                for (const [j, elements] of pages.entries()) {
                    (groups[j] ??= []).push(...elements);
                    if (member.mediaAssetId)
                        groups[j].push({ kind: 'image', mediaAssetId: member.mediaAssetId, mediaVersion: member.mediaVersion!, alt: member.name, fit: 'contain', x: box.x, y, w: iw, h: Math.min(h, iw * 4 / 3) });
                }
            }
            return groups;
        });
    }
    if (b.kind === 'timeline') {
        const per = pattern.id === 'decision-next-steps' ? 2 : 4;
        return chunk(b.entries, per).flatMap(entries => {
            if (pattern.id === 'decision-next-steps') {
                const groups: SceneElement[][] = [];
                const h = (box.h - .3 * (entries.length - 1)) / entries.length;
                for (const [i, entry] of entries.entries()) {
                    const pages = textPages(`${entry.date}\n${entry.title}\n${entry.description}`, { ...box, y: box.y + i * (h + .3), h }, t);
                    for (const [page, elements] of pages.entries()) (groups[page] ??= []).push(...elements);
                }
                return groups;
            }
            const cols = entries.length, w = (box.w - (cols - 1) * .25) / cols, alternating = pattern.id === 'timeline-alternating';
            const elements: SceneElement[] = [{ kind: 'line', direction: 'horizontal', arrow: false, x: box.x, y: box.y + box.h * .5, w: box.w, h: .001 }];
            for (const [i, e] of entries.entries()) {
                const x = box.x + i * (w + .25), above = alternating && i % 2 === 0;
                const h = box.h * .4, y = box.y + (above ? 0 : box.h * .6), text = `${e.date}\n${e.title}\n${e.description}`;
                // A timeline entry is atomic: do not silently discard dates or invent
                // relations when the selected slot cannot hold its full description.
                elements.push(t.text(text, x, y, w, h), { kind: 'shape', shape: 'ellipse', fill: 'primary', background: true, x: x + w / 2 - .04, y: box.y + box.h * .5 - .04, w: .08, h: .08 });
            }
            return [elements];
        });
    }
    return fail('PITCH_UNSUPPORTED_CONTENT', `此插槽不支持 ${b.kind}。`);
}
/** The dispatcher supplies all business content and a safe zone. This renderer
 * never looks up a database, fetches a URL or accepts caller-authored geometry.
 * Per-slot page cursors avoid overwriting a long paragraph with the next item.
 */
export function layoutPattern(content: SlideContent, t: Tools, pattern: LayoutPattern, safe: Box): SceneElement[][] {
    const groups: SceneElement[][] = [], en = content.locale.startsWith('en');
    const scale = (s: Pick<PatternSlot, 'x' | 'y' | 'w' | 'h'>): Box => ({ x: safe.x + s.x * safe.w, y: safe.y + s.y * safe.h, w: s.w * safe.w, h: s.h * safe.h });
    const kinds = [...new Set(pattern.slots.map(s => s.kind))];
    for (const kind of kinds) {
        const slots = pattern.slots.filter(s => s.kind === kind), blocks = content.blocks.filter(b => b.kind === kind);
        if (blocks.length < slots.length)
            return fail('PITCH_REQUIRED_CONTENT', `${pattern.zh}需要至少 ${slots.length} 组 ${kind} 内容；现有内容未被改写。`);
        const cursors = slots.map(() => 0);
        for (const [i, b] of blocks.entries()) {
            const at = i % slots.length, slot = slots[at];
            const pages = slotPages(b, scale(slot), t, pattern, en);
            for (const elements of pages) {
                const page = cursors[at]++;
                if (page >= 50)
                    return fail('PITCH_PAGE_LIMIT', '完整内容超过五十页，请拆分提案。');
                (groups[page] ??= []).push(...elements);
            }
        }
    }
    if (content.blocks.some(b => !kinds.includes(b.kind as PatternSlot['kind'])))
        return fail('PITCH_UNSUPPORTED_CONTENT', '存在无对应插槽的内容；请更换布局。');
    return groups.map(elements => [
        ...pattern.marks.map(m => ({ kind: 'shape' as const, ...scale(m), shape: m.shape, fill: m.tone, background: true, opacity: m.opacity })),
        ...elements,
    ]);
}
