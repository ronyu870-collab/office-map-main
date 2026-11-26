import type { SceneElement, SlideScene } from '../contracts/scene';
export type SceneMedia = { id: string; version: number; mime: string; bytes: Uint8Array; width?: number; height?: number };
export function sceneMediaReferences(scenes: SlideScene[]) {
  return scenes.flatMap(s => s.elements.filter((e): e is Extract<SceneElement, { kind: 'image' }> => e.kind === 'image').map(e => ({ id: e.mediaAssetId, version: e.mediaVersion })));
}
export async function inspectMedia(media: SceneMedia[]) {
  const sharp = (await import('sharp')).default;
  return Promise.all(media.map(async m => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(m.mime) || m.bytes.length > 8 * 1024 * 1024) throw new Error('PITCH_MEDIA_INVALID');
    const meta = await sharp(m.bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!meta.width || !meta.height || meta.pages && meta.pages > 1 || meta.orientation && meta.orientation !== 1) throw new Error('PITCH_MEDIA_ORIENTATION');
    return { ...m, width: meta.width, height: meta.height };
  }));
}
