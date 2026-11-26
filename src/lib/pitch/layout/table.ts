import type { SlideContent } from '../contracts/content';
import type { SceneElement } from '../contracts/scene';
import { cellText } from '../render/format';
import { LayoutError } from './metrics';
import { sceneComponents } from './components';
type Tools = ReturnType<typeof sceneComponents>;
type Of<K extends SlideContent['blocks'][number]['kind']> = Extract<SlideContent['blocks'][number], {
    kind: K;
}>;
export function tablePages(table: Of<'table'>, t: Tools, x: number, y: number, w: number, h: number, emphasizeFirst = false): SceneElement[][] {
    if (!table.rows.length)
        throw new LayoutError('PITCH_EMPTY_TABLE', '表格没有数据，未知值请保留为空值。');
    if (table.columns.length > 6)
        throw new LayoutError('PITCH_TABLE_COLUMNS', '当前表格最多六列，请选择对比转置变体或减少本页字段。');
    let heatScale: { min: number; max: number } | undefined;
    if (table.treatment === 'heatmap') {
        const values = table.rows.flatMap(row => row.slice(1)).filter((value): value is number => typeof value === 'number');
        if (values.length) {
            heatScale = { min: Math.min(...values), max: Math.max(...values) };
            if (!Number.isFinite(heatScale.max - heatScale.min)) throw new LayoutError('PITCH_TABLE_SCALE', '热力矩阵数值范围超限，请使用明确的共同单位。');
        }
    }
    const weights = table.columns.map((_, i) => i === 0 ? emphasizeFirst ? 1.8 : t.theme.profile ? 1.42 : 1 : 1);
    const widths = weights.map(weight => w * weight / weights.reduce((a, b) => a + b, 0));
    const heightFor = (row: (string | number | null)[]) => Math.max(...row.map((v, i) => t.lines(cellText(v), widths[i] - 2 * t.theme.table.cellPadding).length)) * t.lh + 2 * t.theme.table.cellPadding;
    const header = heightFor(table.columns), pages: SceneElement[][] = [];
    let rows: typeof table.rows = [], heights: number[] = [], used = header;
    const flush = () => { pages.push([{ kind: 'table', x, y, w, h: used, columns: table.columns, rows, columnWidths: widths, rowHeights: [header, ...heights], ...(heatScale && { heatScale }) }]); rows = []; heights = []; used = header; };
    for (const row of table.rows) {
        const rh = heightFor(row);
        if (header + rh > h)
            throw new LayoutError('PITCH_TABLE_CELL_CAPACITY', '单行内容过长，无法在可读字号下完整展示，请拆分内容。');
        if (used + rh > h || rows.length >= 10)
            flush();
        rows.push(row);
        heights.push(rh);
        used += rh;
    }
    if (rows.length)
        flush();
    return pages;
}
