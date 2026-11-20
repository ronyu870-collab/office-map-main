import JSZip from 'jszip';

/**
 * SheetJS Community writes editable cells and merges but does not persist
 * presentation styles. Finish the native XLSX by applying a small OOXML
 * stylesheet to the diagram sheet only; the detail tabs remain true cells.
 */
const fill = (hex: string) =>
  '<fill><patternFill patternType="solid"><fgColor rgb="FF' + hex +
  '"/><bgColor indexed="64"/></patternFill></fill>';
const font = (hex: string, size: number, bold = false) =>
  '<font>' + (bold ? '<b/>' : '') + '<sz val="' + size +
  '"/><color rgb="FF' + hex + '"/><name val="Microsoft YaHei"/><family val="2"/></font>';
const border = '<border><left style="thin"><color rgb="FFDCE3EA"/></left>' +
  '<right style="thin"><color rgb="FFDCE3EA"/></right>' +
  '<top style="thin"><color rgb="FFDCE3EA"/></top>' +
  '<bottom style="thin"><color rgb="FFDCE3EA"/></bottom></border>';
const xf = (fontId: number, fillId: number, borderId: number, alignment = 'center') =>
  '<xf numFmtId="0" fontId="' + fontId + '" fillId="' + fillId +
  '" borderId="' + borderId + '" xfId="0" applyFont="1" applyFill="1"' +
  ' applyBorder="1" applyAlignment="1"><alignment horizontal="' + alignment +
  '" vertical="center" wrapText="1"/></xf>';

export const stackingDiagramStyleXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="4">' +
    font('20354B', 10) + font('FFFFFF', 21, true) + font('183A5E', 11, true) + font('526779', 10, true) +
  '</fonts>' +
  '<fills count="9"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    fill('163E67') + fill('E9F1F8') + fill('F2F5F8') +
    fill('DCEAF4') + fill('EEF1F5') + fill('E6EFE7') + fill('F6EDDB') +
  '</fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/></border>' + border + '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="13">' +
    xf(0, 0, 0) + xf(1, 2, 0, 'left') + xf(2, 3, 0, 'left') +
    xf(2, 4, 1) + xf(2, 0, 1) + xf(0, 5, 1) + xf(0, 6, 1) +
    xf(0, 7, 1) + xf(0, 8, 1) + xf(0, 4, 1) +
    xf(0, 0, 1) + xf(0, 0, 0) + xf(3, 0, 0) +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
  '</styleSheet>';

/** Returns a regular .xlsx ArrayBuffer; no image objects and no Excel macros. */
export async function styleStackingWorkbook(
  buffer: ArrayBuffer,
  cellStyles: Record<string, number>,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('xl/worksheets/sheet1.xml');
  if (!xmlFile) throw new Error('未找到堆叠图工作表');
  const source = await xmlFile.async('string');
  let styled = source.replace(/<c\b([^>]*?\br="([A-Z]+[0-9]+)"[^>]*?)(\/?)>/g,
    (whole, attrs: string, ref: string, selfClosing: string) => {
      const style = cellStyles[ref];
      if (style === undefined) return whole;
      const withoutStyle = attrs.replace(/\s+s="\d+"/g, '');
      return '<c' + withoutStyle + ' s="' + style + '"' + selfClosing + '>';
    });
  // Standard Excel print settings: A3 landscape, fit both towers on one page.
  const margins = '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.15" footer="0.15"/>';
  const pageSetup = '<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="1"/>';
  styled = styled.replace(/<pageMargins\b[^>]*\/>/g, '').replace(/<pageSetup\b[^>]*\/>/g, '');
  styled = styled.replace('</worksheet>', margins + pageSetup + '</worksheet>');
  zip.file('xl/worksheets/sheet1.xml', styled);
  zip.file('xl/styles.xml', stackingDiagramStyleXml);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
