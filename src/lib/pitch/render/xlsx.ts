import type { SlideScene } from '../contracts/scene';
import { spreadsheetSafeText } from '@/src/lib/intelligence/query/exports';
import { presentWorkbook } from '@/src/lib/intelligence/query/workbookPresentation';
/** Only the selected scenes' visible table/chart/map data, never raw assets or
 * cached query workbooks. No formulas, hidden sheets, notes or external links. */
export async function renderSceneXlsx(scenes: SlideScene[]) {
  const XLSX = await import('xlsx'), book = XLSX.utils.book_new();
  const safe = (v: string | number | null) => typeof v === 'string' ? spreadsheetSafeText(v) : v;
  for (const [i, scene] of scenes.entries()) for (const [j, el] of scene.elements.entries()) {
    let rows: (string | number | null)[][];
    if (el.kind === 'table') rows = [el.columns, ...el.rows];
    else if (el.kind === 'chart') rows = [['', ...el.series.map(s => `${s.name} (${s.unit})`)], ...el.categories.map((c, n) => [c, ...el.series.map(s => s.values[n])])];
    else if (el.kind === 'map') rows = [['地点 / Location', '经度 / Longitude', '纬度 / Latitude'], ...el.points.map(p => [p.label, p.longitude, p.latitude])];
    else continue;
    rows.push([], ...scene.elements.filter(e => e.kind === 'text' && e.purpose === 'source').map(e => [e.kind === 'text' ? e.text : '']));
    const sheet = XLSX.utils.aoa_to_sheet(rows.map(r => r.map(safe)));
    sheet['!cols'] = Array.from({ length: Math.max(...rows.map(r => r.length)) }, () => ({ wch: 26 }));
    XLSX.utils.book_append_sheet(book, sheet, `Page-${i + 1}-${j + 1}`);
  }
  if (!book.SheetNames.length) throw new Error('PITCH_NO_DATA_EXPORT');
  return presentWorkbook(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
}
