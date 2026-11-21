import path from 'node:path';
import { renderChartSvg, type ResultChart } from './charts';

/** Server-only, fixed SVG renderer; no caller-provided paths, SVG or URLs. */
export async function renderChartPng(chart: ResultChart) {
  const svg = renderChartSvg(chart);
  if (new TextEncoder().encode(svg).byteLength > 16 * 1024 * 1024) throw new Error('CHART_PNG_SOURCE_LIMIT');
  const size = /<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  if (!size) throw new Error('CHART_PNG_SIZE_INVALID');
  const width = Math.round(Number(size[1]) * 2), height = Math.round(Number(size[2]) * 2);
  if (width > 16000 || height > 16000 || width * height > 40_000_000) throw new Error('CHART_PNG_SIZE_LIMIT');
  const { renderAsync } = await import('@resvg/resvg-js');
  const rendered = await renderAsync(svg, { fitTo: { mode: 'zoom', value: 2 },
    font: { loadSystemFonts: false, defaultFontFamily: 'Noto Sans SC', sansSerifFamily: 'Noto Sans SC',
      fontFiles: [path.join(process.cwd(), 'private/chart-fonts/NotoSansSC-Regular.otf')] } });
  if (rendered.width !== width || rendered.height !== height) throw new Error('CHART_PNG_SIZE_INVALID');
  return { bytes: new Uint8Array(rendered.asPng()), width, height };
}
