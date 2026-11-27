import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import type { SlideScene } from '../contracts/scene';
import type { DesignTheme } from '../design/theme';
import type { SceneMedia } from './media';
import { renderSceneRaster } from './svg';

export async function renderScenePdf(
  pages: { scene: SlideScene; theme: DesignTheme }[],
  readPageMedia: (pageIndex: number) => Promise<SceneMedia[]>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  let embeddedBytes = 0;
  for (const [index, { scene, theme }] of pages.entries()) {
    signal.throwIfAborted();
    const media = await readPageMedia(index);
    signal.throwIfAborted();
    const raster = await renderSceneRaster(scene, theme, media);
    const jpg = await sharp(raster.pixels, { raw: { width: raster.width, height: raster.height, channels: 4 } })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    embeddedBytes += jpg.byteLength;
    if (embeddedBytes > 16 * 1024 * 1024) throw new Error('PITCH_EXPORT_LIMIT');
    const width = scene.width * 72, height = scene.height * 72;
    const image = await pdf.embedJpg(jpg);
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  return pdf.save();
}
