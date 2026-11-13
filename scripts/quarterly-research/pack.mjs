import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Report HTML is versioned by user authorization; application access stays admin-only.
const [edition, source] = process.argv.slice(2);
if (!['2026Q2', '2026Q3'].includes(edition) || !source) throw new Error('Usage: node scripts/quarterly-research/pack.mjs EDITION PRIVATE_HTML_PATH');
const html = await readFile(resolve(source), 'utf8');
// Reports are self-contained. Prevent accidental external requests from packaged content.
const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`;
const historyBridge = await readFile(fileURLToPath(new URL('./frame-history.js', import.meta.url)), 'utf8');
const document = html.replace('<head>', '<head>' + policy + '<script>' + historyBridge + '</script>');
await mkdir('private/quarterly-research', { recursive: true });
await writeFile(`private/quarterly-research/${edition}.html`, document);
console.log(`${edition}: report saved (${Buffer.byteLength(document)} bytes)`);
