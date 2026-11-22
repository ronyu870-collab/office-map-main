/** SheetJS CE preserves typed data and number formats but does not write panes
 * or custom styles. Apply these small OOXML presentation changes after serialization,
 * using the existing ZIP dependency; no new spreadsheet engine is introduced. */
export async function presentWorkbook(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const styleFile = zip.file('xl/styles.xml');
  const sheets = Object.keys(zip.files).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path));
  if (!styleFile || !sheets.length) return bytes;
  let styles = await styleFile.async('string');
  const fontCount = Number(/<fonts count="(\d+)"/.exec(styles)?.[1]);
  const fillCount = Number(/<fills count="(\d+)"/.exec(styles)?.[1]);
  const xfCount = Number(/<cellXfs count="(\d+)"/.exec(styles)?.[1]);
  if (![fontCount, fillCount, xfCount].every(n => Number.isInteger(n) && n > 0)) return bytes;
  styles = styles.replace(/<fonts count="\d+"/, `<fonts count="${fontCount + 1}"`).replace('</fonts>', '<font><b/><sz val="11"/><color rgb="FF172033"/><name val="Arial"/></font></fonts>')
    .replace(/<fills count="\d+"/, `<fills count="${fillCount + 1}"`).replace('</fills>', '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F3F7"/><bgColor indexed="64"/></patternFill></fill></fills>')
    .replace(/<cellXfs count="\d+"/, `<cellXfs count="${xfCount + 1}"`).replace('</cellXfs>', `<xf numFmtId="0" fontId="${fontCount}" fillId="${fillCount}" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`);
  const date = new Date('2000-01-01T00:00:00Z');
  for (const path of sheets) {
    let sheet = await zip.file(path)!.async('string');
    sheet = sheet.replace(/(<row\b[^>]*\br="1"[^>]*>)([\s\S]*?)(<\/row>)/, (_, open: string, cells: string, close: string) => open + cells.replace(/<c\b([^>]*)>/g, (_: string, attributes: string) => `<c${attributes.replace(/\s+s="[^"]*"/g, '')} s="${xfCount}">`) + close);
    const pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
    sheet = sheet.replace(/<sheetView\b([^>]*?)(?:\/>|>)/, (_: string, attributes: string) => `<sheetView${attributes}>${pane}`);
    // SheetJS emits a self-closing sheetView. Close the expanded element when it
    // has no existing selection children; leave other workbook parts untouched.
    sheet = sheet.replace(`${pane}</sheetViews>`, `${pane}</sheetView></sheetViews>`);
    zip.file(path, sheet, { date });
  }
  zip.file('xl/styles.xml', styles, { date });
  // Replacing parts may create ZIP directory entries with wall-clock dates.
  // Normalize every entry so authorized rebuilds match the generated digest.
  for (const entry of Object.values(zip.files)) entry.date = date;
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
