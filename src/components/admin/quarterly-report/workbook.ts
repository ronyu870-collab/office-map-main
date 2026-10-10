import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { difference, finite, METHOD_NOTE, periodLabel, rateChange, snapshotLabel, type Detail, type Report } from './model';

const NUMBER = '#,##0.0';
const PERCENT = '0.0%';
const CHANGE = '+0.0%;-0.0%;0.0%';
const PP = '+0.0" pp";-0.0" pp";0.0" pp"';
type Value = string | number | null | undefined;
type Row = Array<Value | XLSX.CellObject>;
type Role = 'title' | 'note' | 'group' | 'header' | 'total' | 'body';
interface Layout { roles: Record<number, Role>; freeze: number; columns: number; firstColumn: boolean }
const numeric = (v: Value): Value => v == null ? null : finite(v) ?? String(v);
const cell = (v: Value, format?: string): XLSX.CellObject => v == null
  ? { t: 's', v: '' }
  : typeof v === 'number' ? { t: 'n', v, ...(format ? { z: format } : {}) } : { t: 's', v: String(v) };
const number = (v: Value) => cell(numeric(v), NUMBER);
const rate = (v: number | null) => cell(v, PERCENT);
function submittedAt(iso: string) {
  const fraction = iso.match(/:\d{2}\.(\d+)/)?.[1];
  return snapshotLabel(iso) + (fraction ? `.${fraction}` : '');
}
function storedRate(v: Value) {
  const n = finite(v);
  return n === null ? cell(v == null ? null : String(v)) : cell(n / 100, PERCENT); // DB stores percentage points, never guess by value magnitude.
}
function latestChecks(d: Detail) { return d.checks.join('；'); }
function comparisonChecks(d: Detail) {
  return [...d.checks, ...(!d.previous ? ['上季无记录'] : d.previousValues.issues.map(s => `上季：${s}`))].join('；');
}
export function buildWorkbook(report: Report) {
  const workbook = XLSX.utils.book_new();
  const layouts: Layout[] = [];
  const currentLabel = periodLabel(report.period), previousLabel = periodLabel(report.previous);
  const subtitle = `截至 ${snapshotLabel(report.capturedAt)}（北京时间）`;
  const add = (name: string, title: string, headers: string[], data: Row[], widths: number[]) => {
    const rows: Row[] = [[title], [subtitle], [], headers, ...data];
    const sheet = XLSX.utils.aoa_to_sheet(rows.map(row => row.map(v => typeof v === 'object' && v !== null ? v : cell(v))));
    sheet['!merges'] = [0, 1].map(r => ({ s: { r, c: 0 }, e: { r, c: headers.length - 1 } }));
    sheet['!cols'] = widths.map(wch => ({ wch }));
    sheet['!rows'] = rows.map((_, r) => ({ hpt: r === 0 ? 28 : r === 3 ? 34 : 22 }));
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: Math.max(3, rows.length - 1), c: headers.length - 1 } }) };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    layouts.push({ roles: { 0: 'title', 1: 'note', 3: 'header' }, freeze: 4, columns: headers.length, firstColumn: true });
  };
  const compareHeaders = ['项目名称', '类型', '子市场', `${previousLabel}净有效租金`, `${currentLabel}净有效租金`, '租金环比', `${previousLabel}空置率`, `${currentLabel}空置率`, '空置率变化', `${previousLabel}空置面积`, `${currentLabel}空置面积`, '空置面积变化'];
  const comparisonWarnings = report.latest.some(d => comparisonChecks(d));
  if (comparisonWarnings) compareHeaders.push('数据检查');
  const compareRows: Row[] = report.latest.map(d => {
    const c = d.values, p = d.previousValues;
    const row: Row = [d.name, d.category, d.submarket, number(p.rent), number(c.rent), cell(rateChange(c.rent, p.rent), CHANGE),
      rate(p.vacancy), rate(c.vacancy), cell(difference(c.vacancy, p.vacancy) === null ? null : (c.vacancy! - p.vacancy!) * 100, PP),
      number(p.vacant), number(c.vacant), number(difference(c.vacant, p.vacant))];
    if (comparisonWarnings) row.push(comparisonChecks(d));
    return row;
  });
  add('01 季度环比', `${currentLabel} · 逐栋季度环比（租金：元/㎡/月；面积：㎡）`, compareHeaders, compareRows,
    [26, 15, 19, 18, 18, 12, 17, 17, 15, 18, 18, 16, ...(comparisonWarnings ? [36] : [])]);

  const headers = ['项目名称', '类型', '子市场', '总面积(㎡)', '报价租金(元/㎡/月)', '物业费(元/㎡/月)', '表面租金(元/㎡/月)', '免租期(月)', '净有效租金(元/㎡/月)', '空置面积(㎡)', '空置率', '填写人', '提交时间（北京时间）', '业主', '物业公司', '备注'];
  const widths = [26, 15, 19, 16, 18, 18, 18, 12, 20, 16, 12, 16, 29, 26, 26, 36];
  const businessRow = (d: Detail): Row => {
    const s = d.source;
    return [d.name, d.category, d.submarket, number(s.total_area), number(s.asking_rent), number(s.management_fee), number(s.face_rent), number(s.rent_free_period),
      number(s.net_effective_rent), number(s.vacant_area), storedRate(s.vacancy_rate), d.submitter, submittedAt(s.created_at), s.owner, s.property_management, s.notes];
  };
  const hasChecks = report.latest.some(d => d.checks.length);
  add('02 本季最新', `${currentLabel} · 本季最新（每栋楼保留最新一次提交）`, [...headers, ...(hasChecks ? ['数据检查'] : [])],
    report.latest.map(d => [...businessRow(d), ...(hasChecks ? [latestChecks(d)] : [])]), [...widths, ...(hasChecks ? [36] : [])]);
  add('03 原始记录', `${currentLabel} · 原始记录（全部提交版本）`, headers, report.raw.map(businessRow), widths);

  const dashboard: Row[] = [[`${currentLabel} · 市场看板`], [`租金：元/㎡/月 · 空置率：% · ${subtitle}`], [METHOD_NOTE], []];
  const roles: Record<number, Role> = { 0: 'title', 1: 'note', 2: 'note' };
  const merges = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: 8 } }));
  const comments: Array<{ r: number; c: number; text: string }> = [];
  for (const group of report.markets) {
    const heading = dashboard.length;
    roles[heading] = 'group';
    merges.push({ s: { r: heading, c: 0 }, e: { r: heading, c: 8 } });
    dashboard.push([group.label]);
    roles[dashboard.length] = 'header';
    dashboard.push(['子市场', '本季栋数', '上季栋数', `${previousLabel}租金`, `${currentLabel}租金`, '租金环比', `${previousLabel}空置率`, `${currentLabel}空置率`, '变化(pp)']);
    for (const row of group.rows) {
      const r = dashboard.length;
      if (row.total) roles[r] = 'total';
      dashboard.push([row.name, cell(row.current.count, '0'), cell(row.previous.count, '0'), number(row.previous.rent), number(row.current.rent), cell(row.rentChange, CHANGE),
        rate(row.previous.vacancy), rate(row.current.vacancy), cell(row.vacancyChange === null ? null : row.vacancyChange * 100, PP)]);
      for (const [c, count, total] of [[3, row.previous.rentCount, row.previous.count], [4, row.current.rentCount, row.current.count], [6, row.previous.vacancyCount, row.previous.count], [7, row.current.vacancyCount, row.current.count]]) {
        if (count !== total) comments.push({ r, c, text: `有效样本：${count}栋；${total - count}栋因对应指标缺失或无效未计入。` });
      }
    }
    dashboard.push([]);
  }
  if (report.currentIssueCount || report.previousIssueCount || report.unclassifiedCount) {
    const r = dashboard.length;
    roles[r] = 'note';
    merges.push({ s: { r, c: 0 }, e: { r, c: 8 } });
    dashboard.push([`数据核查：本季${report.currentIssueCount}栋、上季${report.previousIssueCount}栋；无效指标不计入，受影响指标的有效样本数见单元格批注。${report.unclassifiedCount ? '未识别类型的楼宇未计入分类统计。' : ''}`]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(dashboard.map(row => row.map(v => typeof v === 'object' && v !== null ? v : cell(v))));
  sheet['!merges'] = merges;
  sheet['!cols'] = [22, 11, 11, 17, 17, 12, 18, 18, 14].map(wch => ({ wch }));
  sheet['!rows'] = dashboard.map((_, r) => ({ hpt: roles[r] === 'title' ? 30 : roles[r] === 'note' ? 34 : roles[r] === 'header' ? 34 : 24 }));
  for (const comment of comments) {
    sheet[XLSX.utils.encode_cell(comment)].c = [{ a: '有效样本', t: comment.text }];
  }
  XLSX.utils.book_append_sheet(workbook, sheet, '04 市场看板');
  layouts.push({ roles, freeze: 3, columns: 9, firstColumn: false });
  workbook.Props = { Title: `${currentLabel} 季度市场数据`, Subject: '季度填报统计', Author: 'Colliers', CreatedDate: new Date(report.capturedAt) };
  return { workbook, layouts };
}

/** SheetJS CE writes data/number formats; add a small OOXML presentation layer using the existing JSZip dependency. */
export async function reportBytes(report: Report): Promise<Uint8Array> {
  const { workbook, layouts } = buildWorkbook(report);
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }));
  let styles = await zip.file('xl/styles.xml')!.async('string');
  function append(tag: string, entries: string[]): number {
    const re = new RegExp(`<${tag}\\b[^>]*count="(\\d+)"[^>]*>([\\s\\S]*?)<\\/${tag}>`);
    const match = styles.match(re);
    if (!match) throw new Error('Excel 样式生成失败');
    const start = Number(match[1]);
    styles = styles.replace(re, `<${tag} count="${start + entries.length}">${match[2]}${entries.join('')}</${tag}>`);
    return start;
  }
  const font = (size: number, color: string, bold = false) => `<font>${bold ? '<b/>' : ''}<sz val="${size}"/><color rgb="FF${color}"/><name val="Microsoft YaHei"/></font>`;
  const f = append('fonts', [font(11, '273442'), font(16, '003E7E', true), font(10, '626F7D'), font(12, '003E7E', true), font(11, 'FFFFFF', true), font(11, '273442', true)]);
  const fill = (color: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`;
  const bg = append('fills', [fill('003E7E'), fill('EEF3F8'), fill('F2F4F6')]);
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  if (!xfs.length) throw new Error('Excel 数值样式生成失败');
  const additions: string[] = [];
  const cache = new Map<string, number>();
  const fontOffset: Record<Role, number> = { body: 0, title: 1, note: 2, group: 3, header: 4, total: 5 };
  function styleId(old: number, role: Role, numericCell: boolean) {
    const key = `${old}:${role}:${numericCell}`;
    if (cache.has(key)) return cache.get(key)!;
    const id = xfs.length + additions.length;
    const numFmt = xfs[old]?.match(/numFmtId="(\d+)"/)?.[1] ?? '0';
    const fillId = role === 'header' ? bg : role === 'group' ? bg + 1 : role === 'total' ? bg + 2 : 0;
    additions.push(`<xf numFmtId="${numFmt}" fontId="${f + fontOffset[role]}" fillId="${fillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="${numericCell ? 'right' : 'left'}" vertical="center" wrapText="1"/></xf>`);
    cache.set(key, id);
    return id;
  }
  for (let i = 0; i < layouts.length; i++) {
    const path = `xl/worksheets/sheet${i + 1}.xml`, layout = layouts[i];
    let xml = await zip.file(path)!.async('string');
    xml = xml.replace(/<c\b([^>]*\br="([A-Z]+)(\d+)"[^>]*)>/g, (_match, attributes: string, _col: string, row: string) => {
      const old = Number(attributes.match(/\bs="(\d+)"/)?.[1] ?? 0);
      const isNumber = !/\bt="(?:s|str|inlineStr|b|e)"/.test(attributes);
      const id = styleId(old, layout.roles[Number(row) - 1] ?? 'body', isNumber);
      return `<c${attributes.replace(/\s+s="\d+"/, '')} s="${id}">`;
    });
    const split = layout.firstColumn ? ' xSplit="1"' : '';
    const pane = layout.firstColumn ? 'bottomRight' : 'bottomLeft';
    const topLeft = `${layout.firstColumn ? 'B' : 'A'}${layout.freeze + 1}`;
    const views = `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${i === 3 ? ' tabSelected="1"' : ''}><pane${split} ySplit="${layout.freeze}" topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`;
    xml = /<sheetViews\b/.test(xml) ? xml.replace(/<sheetViews\b[^>]*>[\s\S]*?<\/sheetViews>/, views) : xml.replace(/<dimension\b[^>]*\/>/, m => m + views);
    zip.file(path, xml);
  }
  append('cellXfs', additions);
  zip.file('xl/styles.xml', styles);
  let book = await zip.file('xl/workbook.xml')!.async('string');
  const views = '<bookViews><workbookView activeTab="3" firstSheet="0"/></bookViews>';
  book = /<bookViews\b/.test(book) ? book.replace(/<bookViews\b[^>]*>[\s\S]*?<\/bookViews>/, views) : book.replace('<sheets>', views + '<sheets>');
  zip.file('xl/workbook.xml', book);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
