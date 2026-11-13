import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
const mime = { '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
async function asset(path) {
 path = path instanceof URL ? fileURLToPath(path) : path;
 const data = await readFile(path);
 if (!mime[extname(path)]) throw new Error(`Unsupported report resource: ${path}`);
 return `data:${mime[extname(path)]};base64,${data.toString('base64')}`;
}
async function replaceAsync(value, pattern, action) {
 const matches=[...value.matchAll(pattern)], values=await Promise.all(matches.map(action));
 let i=0;return value.replace(pattern,()=>values[i++]);
}
export async function inlineMapAssets(html) {
 // The map is constructed at runtime, so HTML src/href checks alone missed it.
 if (html.includes('原件引用/2026Q2_路网.svg')) {
  const roads=await asset(new URL('./assets/beijing-roads.svg',import.meta.url));
  html=html.replaceAll('原件引用/2026Q2_路网.svg',roads);
 }
 if (html.includes('原件引用/2026Q1_路网.svg')) html=html.replaceAll('原件引用/2026Q1_路网.svg',await asset(new URL('./assets/beijing-roads-q1.svg',import.meta.url)));
 return html.replaceAll("href:'../'+m.background", "href:m.background.startsWith('data:')?m.background:'../'+m.background");
}
export async function bundleReport(entry) {
 const root=dirname(resolve(entry));let html=await readFile(entry,'utf8');
 html=await replaceAsync(html,/<link rel="stylesheet" href="([^"]+)"\s*>/g,async m=>{
  const file=resolve(root,m[1].split('?')[0]);let css=await readFile(file,'utf8');
  css=await replaceAsync(css,/url\((['"]?)([^)]+?)\1\)/g,async u=>u[2].startsWith('data:')||u[2].startsWith('#')?u[0]:`url("${await asset(resolve(dirname(file),u[2]))}")`);
  return '<style>'+css+'</style>';
 });
 html=await replaceAsync(html,/<script src="([^"]+)"\s*>\s*<\/script>/g,async m=>{
  let js=await readFile(resolve(root,m[1].split('?')[0]),'utf8');
  js=await replaceAsync(js,/assets\/[\w.\-/]+/g,async a=>asset(resolve(root,a[0])));
  return '<script>\n'+js.replace(/<\/script/gi,'<\\/script')+'\n</script>';
 });
 html=await replaceAsync(html,/src="(assets\/[^"]+)"/g,async m=>`src="${await asset(resolve(root,m[1]))}"`);
 html=await inlineMapAssets(html);assertSelfContained(html);return html;
}
export function assertSelfContained(html) {
 if (/<script[^>]+src=|<link[^>]+stylesheet|(?:src|href)=["'](?:assets\/|\.\.\/)/.test(html)) throw new Error('External report dependency remains');
 if (html.includes('原件引用/2026Q2_路网.svg') || html.includes("href:'../'+m.background")) throw new Error('Map runtime dependency is not self-contained');
 const backgrounds=[...html.matchAll(/"background"\s*:\s*"([^"]*)"/g)];
 if (backgrounds.some(m=>!m[1].startsWith('data:image/'))) throw new Error('Map background cannot load under the private report CSP');
}
