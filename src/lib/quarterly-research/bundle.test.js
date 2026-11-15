import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';
import { bundleReport, assertSelfContained } from '../../../scripts/quarterly-research/bundle.mjs';
const base=process.env.REPORT_FIXTURE_DIR || 'private/quarterly-research';
const scripts=html=>[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
function payload(html,key){const window={};runInNewContext(scripts(html).find(s=>new RegExp(`window\\.${key}\\s*=`).test(s)),{window});return window[key];}
describe('packaged quarterly research',()=>{
 for(const edition of ['2026Q2','2026Q3'])it(`${edition} builds an embedded road image accepted by the private CSP`,()=>{
  const html=readFileSync(`${base}/${edition}.html`,'utf8');assertSelfContained(html);
  const maps=payload(html,'REPORT_MAPS'),runtime=scripts(html).find(s=>s.includes('function buildGeometry()'));
  // Execute the actual image attributes used by buildGeometry, rather than
  // validating only HTML literals (the old packer missed this dynamic path).
  const attributes=runtime.match(/el\('image',(\{href:[\s\S]*?\}),svg\);/)[1];
  const attrs=runInNewContext('('+attributes+')',{m:maps['2026Q2']});
  const image=document.createElementNS('http://www.w3.org/2000/svg','image');
  for(const [key,value]of Object.entries(attrs))image.setAttribute(key,String(value));
  expect(image.getAttribute('href')).toMatch(/^data:image\/svg\+xml;base64,/);
  const svg=Buffer.from(image.getAttribute('href').split(',')[1],'base64').toString();
  const parsed=new DOMParser().parseFromString(svg,'image/svg+xml');
  expect(parsed.querySelector('parsererror')).toBeNull();expect(parsed.querySelectorAll('path').length).toBeGreaterThan(10);
  expect(html).toContain("img-src data:");
 });
 it('reproduces Q3 from versioned source and parses every runtime script',async()=>{
  const html=await bundleReport('private/quarterly-research/source/2026Q3/原型/index.html');
  const packaged=readFileSync('private/quarterly-research/2026Q3.html','utf8');
  expect(packaged.slice(packaged.indexOf('<meta charset'))).toBe(html.slice(html.indexOf('<meta charset')));
  scripts(html).forEach(s=>expect(()=>new Script(s)).not.toThrow());
 });
 it('keeps disclosed levels, original changes, and illustrative history distinct',()=>{
  const html=readFileSync(`${base}/2026Q3.html`,'utf8'),q3=payload(html,'RESEARCH_EDITIONS')['2026Q3'],history=payload(html,'DEMO');
  expect(q3).toEqual(JSON.parse(readFileSync('private/quarterly-research/source/2026Q3/季度内容包/q3.json','utf8')));
  expect(q3.pack.metrics).toHaveLength(10);
  const dc=q3.pack.metrics.find(r=>r.area==='东城商务区');
  expect(dc.vacancy_qoq_reported).toBe('+0.3%');
  expect(q3.pack.prior_disclosed.find(r=>r.area==='东城商务区').vacancy).toBe('20.8%');
  expect(q3.report.city.absorption_ytd).toBe(35.4);
  expect(history.periods).toHaveLength(31);
  expect(history.rows.filter(r=>r.period==='2026Q2'||r.period==='2026Q3').every(r=>r.status==='reported'&&r.vacancy!==null)).toBe(true);
  expect(history.rows.filter(r=>r.period<'2026Q2').every(r=>r.status==='illustrative')).toBe(true);
  expect(q3.report.authors.items).toEqual([]);
 });
});
