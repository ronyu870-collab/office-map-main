/** Exercise the real quarterly panel, workbook and FileSaver in a minified Next/webpack browser build.
 * Only backend reads, audit persistence and UI chrome are replaced with synthetic local fixtures.
 * Usage: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/check-quarterly-export-browser.mjs
 * Optional: --expect-export-error is a pre-fix negative control, not a release gate bypass.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const browserModule = process.env.PLAYWRIGHT_MODULE;
if (!browserModule) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright/index.mjs; no production credentials are needed.');
const { chromium } = await import(pathToFileURL(browserModule).href);
const XLSX = require('xlsx');
const expectError = process.argv.includes('--expect-export-error');
const phase = expectError ? 'before' : 'after';
const evidence = process.env.QUARTERLY_BROWSER_ARTIFACT_DIR || path.join(tmpdir(), 'quarterly-browser-evidence');
await mkdir(evidence, { recursive: true });
const dir = await mkdtemp(path.join(tmpdir(), 'quarterly-export-browser-'));
const executable = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => spawnSync('test', ['-x', p]).status === 0);
const port = 3487;
let server, browser;
try {
  await symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  await mkdir(path.join(dir, 'app'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'quarterly-browser-isolated-harness', private: true }));
  await writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['dom', 'esnext'], allowJs: true, skipLibCheck: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', baseUrl: root, paths: { '@/*': ['./*'] } }, include: ['app/**/*.tsx'], exclude: ['node_modules'] }));
  await writeFile(path.join(dir, 'next.config.mjs'), `export default { typescript: { ignoreBuildErrors: true }, webpack(config) { config.resolve.alias = { ...config.resolve.alias, '@/src/services/supabaseClient$': ${JSON.stringify(path.join(dir, 'backend.js'))}, '@/src/utils/audit$': ${JSON.stringify(path.join(dir, 'audit.js'))}, '@/src/components/ui$': ${JSON.stringify(path.join(dir, 'ui.tsx'))}, '@': ${JSON.stringify(root)} }; return config; } };`);
  await writeFile(path.join(dir, 'app/layout.tsx'), `export default function Layout({children}: {children: React.ReactNode}) { return <html lang="zh-CN"><body>{children}</body></html>; }`);
  await writeFile(path.join(dir, 'app/page.tsx'), `'use client';
import * as React from 'react';
import { QuarterlyReportPanel } from ${JSON.stringify(path.join(root, 'src/components/admin/quarterly-report/QuarterlyReportPanel'))};
export default function Page() {
  const [year, setYear] = React.useState(2026), [quarter, setQuarter] = React.useState(3);
  return <QuarterlyReportPanel period={{ year, quarter, setYear, setQuarter, configured: { data: {year: 2026, quarter: 3}, loading: false, error: undefined, reload: () => {} } }} history={<div>原始记录</div>} />;
}`);
  await writeFile(path.join(dir, 'ui.tsx'), `export function Button({size, variant, ...props}: any) { return <button type="button" {...props} />; }`);
  await writeFile(path.join(dir, 'audit.js'), `export function logAction(...args) { (window.__exportAudits ||= []).push(args); }`);
  await writeFile(path.join(dir, 'backend.js'), `const metric = { building_id: 'a', record_year: 2026, total_area: 100, asking_rent: 270, face_rent: 260, management_fee: 20, rent_free_period: 1, vacant_area: 10, vacancy_rate: 10, user_id: 'u' };
const fixtures = {
  buildings: [{id:'a',name:'Synthetic Tower',grade:'A',submarket:'CBD'}, {id:'b',name:'Baseline Only Tower',grade:'P',submarket:'CBD'}],
  user_roles: [{user_id:'u',chinese_name:'Synthetic Broker'}],
  quarterly_submissions: [{...metric,id:'s1',record_quarter:3,created_at:'2026-09-01T00:00:00.000001Z',net_effective_rent:260}, {...metric,id:'s2',record_quarter:3,created_at:'2026-09-02T00:00:00.000001Z',net_effective_rent:240}],
  building_metrics: [{...metric,id:'m1',record_quarter:2,created_at:'2026-06-30T00:00:00Z',net_effective_rent:250,vacancy_rate:0.1}, {...metric,id:'m2',building_id:'b',record_quarter:2,created_at:'2026-06-30T00:00:00Z',net_effective_rent:290,vacant_area:20,vacancy_rate:0.2}]
};
export const supabase = { from(table) { const filters=[], orders=[]; let start=0,end=499;
  const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},lte(k,v){filters.push(r=>r[k]<=v);return q},order(k,options){orders.push([k,options?.ascending!==false]);return q},range(a,b){start=a;end=b;return q},then(resolve,reject){let rows=(fixtures[table]||[]).filter(r=>filters.every(f=>f(r)));rows.sort((a,b)=>{for(const [k,asc] of orders){const d=String(a[k]).localeCompare(String(b[k]));if(d)return asc?d:-d;}return 0});return Promise.resolve({data:rows.slice(start,end+1),error:null}).then(resolve,reject)}};return q;} };`);
  // This harness skips fixture typing only. The release always runs the repository's unmodified npm run verify separately.
  const env = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
  const next = path.join(root, 'node_modules/next/dist/bin/next');
  const build = spawnSync(process.execPath, [next, 'build', dir, '--webpack'], { cwd: dir, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 180000 });
  await writeFile(path.join(evidence, `${phase}-browser-build.log`), (build.stdout || '') + (build.stderr || ''));
  assert.equal(build.status, 0, 'Production browser harness must build: ' + (build.stderr || build.stdout || '').slice(-5000));
  server = spawn(process.execPath, [next, 'start', dir, '-p', String(port), '-H', '127.0.0.1'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = ''; server.stdout.on('data', b=>{serverLog+=b}); server.stderr.on('data', b=>{serverLog+=b});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{/* Server is still starting. */}await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready, 'Harness server failed: '+serverLog);
  browser = await chromium.launch({ headless:true, ...(executable ? {executablePath:executable} : {}) });
  const context = await browser.newContext({ acceptDownloads: true });
  const blocked=[];
  await context.route('**/*', route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1' ? route.continue() : (blocked.push(u.origin),route.abort());});
  const page = await context.newPage(); const errors=[], downloads=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('download',d=>downloads.push(d));
  await page.goto(`http://127.0.0.1:${port}`, {waitUntil:'networkidle'});
  await page.getByRole('region', {name:'甲级写字楼', exact:true}).waitFor();
  const button=page.getByRole('button', {name:'导出 Excel',exact:true});
  await button.click();
  if(expectError){
    await page.getByRole('alert').waitFor({timeout:15000});
    const error=await page.getByRole('alert').innerText();
    assert.match(error,/not a function/);
    assert.equal(downloads.length,0); assert.equal(await page.evaluate(()=>window.__exportAudits?.length||0),0);
    await writeFile(path.join(evidence,'before-reproduction.json'),JSON.stringify({error,downloadCount:downloads.length,auditCount:0,blocked,errors},null,2));
    await page.screenshot({path:path.join(evidence,'before.png'),fullPage:true});
    console.log('NEGATIVE CONTROL: reproduced minified production error:',error);
  } else {
    for(let i=0;i<300&&downloads.length===0;i++){if(await page.getByRole('alert').count())throw new Error(await page.getByRole('alert').innerText());await new Promise(r=>setTimeout(r,100));}
    assert.equal(downloads.length,1,'A real browser download is required, not a mocked save function');
    const saved=path.join(evidence,'browser-downloaded-quarterly.xlsx');
    assert.equal(downloads[0].suggestedFilename(),'季度市场数据_2026Q3.xlsx');
    await downloads[0].saveAs(saved); assert.equal(await downloads[0].failure(),null);
    const bytes=await readFile(saved); assert.ok(bytes.length>5000);
    const book=XLSX.read(bytes,{type:'buffer'});
    assert.deepEqual(book.SheetNames,['01 季度环比','02 本季最新','03 原始记录','04 市场看板']);
    assert.equal(book.Sheets['02 本季最新'].A5.v,'Synthetic Tower'); assert.equal(book.Sheets['02 本季最新'].I5.v,240);
    const market=book.Sheets['04 市场看板']; assert.equal(market.B7.v,1); assert.equal(market.C7.v,2); assert.equal(market.D7.v,270); assert.equal(market.E7.v,240);
    assert.ok(Math.abs(market.F7.v-(240/270-1))<1e-10); assert.ok(Math.abs(market.G7.v-0.15)<1e-10); assert.ok(Math.abs(market.H7.v-0.1)<1e-10);
    assert.equal(XLSX.utils.sheet_to_json(book.Sheets['03 原始记录'],{header:1,range:4}).length,2);
    assert.equal(await page.getByRole('alert').count(),0); assert.equal(await page.evaluate(()=>window.__exportAudits.length),1);
    // Verify cached dynamic imports too, and guard against a double click producing two exports.
    await button.evaluate(b=>{b.click();b.click()});
    for(let i=0;i<300&&downloads.length<2;i++)await new Promise(r=>setTimeout(r,100));
    await new Promise(r=>setTimeout(r,300)); assert.equal(downloads.length,2); assert.equal(await page.evaluate(()=>window.__exportAudits.length),2);
    assert.deepEqual(errors,[]); assert.deepEqual(blocked,[]);
    await page.screenshot({path:path.join(evidence,'after.png'),fullPage:true});
    await writeFile(path.join(evidence,'after-browser-verification.json'),JSON.stringify({downloads:downloads.length,bytes:bytes.length,sheets:book.SheetNames,baseline:270,current:240,previousBuildings:2,currentBuildings:1,pageErrors:errors,blockedRequests:blocked},null,2));
    console.log('PASS: real production browser download; 4 sheets, dedup, full baseline, numeric readback, warm import and double-click guard.');
  }
} finally { if(browser)await browser.close();if(server){server.kill('SIGTERM');await new Promise(r=>setTimeout(r,200));}await rm(dir,{recursive:true,force:true}); }
