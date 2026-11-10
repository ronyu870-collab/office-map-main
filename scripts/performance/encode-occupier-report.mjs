// Recreate the static AVIF alternatives from the canonical WebP photographs.
// The existing dimensions and the WebP fallbacks are never changed.
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const assets = new URL('../../public/occupier-insights/', import.meta.url);
const sources = [
  ['office-cover', 63],
  ['office-ecosystem-panorama', 68],
  ['office-green-panorama', 68],
  ['office-network-panorama', 68],
  ['office-workplace-panorama', 68],
];
for (const [name, quality] of sources) {
  const from = fileURLToPath(new URL(name + '.webp', assets));
  const to = fileURLToPath(new URL(name + '.avif', assets));
  await sharp(from).avif({ quality, effort: 5, chromaSubsampling: '4:2:0' }).toFile(to);
}
