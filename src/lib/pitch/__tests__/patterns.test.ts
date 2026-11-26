import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { PATTERNS } from '../layout/patterns/catalog';
import { layoutFixture } from '../fixtures/layouts';
import { layoutSlides } from '../layout/engine';
import { checkScene } from '../layout/quality';
import { STUDIO_THEME, VERIFICATION_THEME } from '../design/theme';
import { slideContentSchema } from '../contracts/content';
import { layoutIdSchema, legacyLayoutIds } from '../contracts/scene';
import { renderPitchPptx } from '../render/pptx';
import { renderSceneSvg } from '../render/svg';

describe('reviewed declarative layout patterns', () => {
  it('has distinct component geometry; aliases and palette changes do not count', () => {
    const signatures=PATTERNS.map(p=>JSON.stringify(p.slots));
    expect(new Set(signatures).size).toBe(PATTERNS.length);
    expect(legacyLayoutIds.length+PATTERNS.length).toBeGreaterThanOrEqual(60);
    expect(layoutIdSchema.safeParse('unregistered-layout').success).toBe(false);
    for(const p of PATTERNS)for(const b of [...p.slots,...p.marks]){
      expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x+b.w).toBeLessThanOrEqual(1.001);expect(b.y+b.h).toBeLessThanOrEqual(1.001);
    }
  });
  it('lays out actual Chinese and English examples under both themes without mutation, overlap or small text', async () => {
    const sizes=[{id:'66666666-6666-4666-8666-666666666666',version:1,width:2400,height:1600}];
    for(const p of PATTERNS)for(const language of ['zh','en'] as const)for(const theme of [STUDIO_THEME,VERIFICATION_THEME]){
      const content=slideContentSchema.parse(layoutFixture(p.id,language)),before=JSON.stringify(content);
      const scenes=await layoutSlides(content,theme,p.id);
      expect(scenes.length).toBeGreaterThan(0);
      for(const scene of scenes)expect((await checkScene(scene,theme,sizes)).filter(i=>i.severity==='error'),p.id).toEqual([]);
      expect(JSON.stringify(content)).toBe(before);
    }
  },60000);
  it('paginates every paragraph without overwriting subsequent blocks or shrinking fonts', async () => {
    const content=layoutFixture('executive-summary');
    const paragraphs=content.blocks.filter(b=>b.kind==='paragraph');
    paragraphs[1].text=Array.from({length:130},(_,i)=>`记录${i}完整保留。`).join('\n');
    const scenes=await layoutSlides(content,STUDIO_THEME,'executive-summary');
    expect(scenes.length).toBeGreaterThan(1);
    const text=scenes.flatMap(s=>s.elements.filter(e=>e.kind==='text'&&!e.purpose&&e.role!=='title').map(e=>e.kind==='text'?e.text:'')).join('').replace(/\s/g,'');
    for(const p of paragraphs)for(const line of p.text.split('\n'))expect(text).toContain(line.replace(/\s/g,''));
    const slot=PATTERNS.find(p=>p.id==='executive-summary')!.slots[1];
    const ordered=scenes.flatMap(s=>s.elements.filter(e=>e.kind==='text'&&!e.purpose&&e.role==='body'&&Math.abs(e.x-STUDIO_THEME.margin)<.01&&Math.abs(e.y-(1.35+slot.y*4.45))<.01).map(e=>e.kind==='text'?e.text:'')).join('').replace(/\s/g,'');
    expect(ordered).toBe(paragraphs[1].text.replace(/\s/g,''));
    for(const s of scenes)expect(s.elements.filter(e=>e.kind==='text').every(e=>['title','body'].includes(e.role))).toBe(true);
  });
  it('keeps short next steps on one page and personnel photos aligned with their text', async () => {
    const next = await layoutSlides(layoutFixture('decision-next-steps'), STUDIO_THEME, 'decision-next-steps');
    expect(next).toHaveLength(1);
    const text = next[0].elements.filter(e => e.kind === 'text').map(e => e.kind === 'text' ? e.text : '').join('');
    expect(text).toContain('2026-01-01'); expect(text).toContain('2026-02-01');
    const team = await layoutSlides(layoutFixture('leader-team'), STUDIO_THEME, 'leader-team');
    for (const image of team[0].elements.filter(e => e.kind === 'image')) expect(image.h).toBeLessThanOrEqual(image.w * 4 / 3 + .001);
  });
  it('rejects missing slots, unsupported content, invalid charts, tables and encoding', async () => {
    const missing=layoutFixture('executive-summary');missing.blocks.pop();
    await expect(layoutSlides(missing,STUDIO_THEME,'executive-summary')).rejects.toThrow('PITCH_REQUIRED_CONTENT');
    const invalid=layoutFixture('executive-summary');invalid.blocks.push(layoutFixture('kpi').blocks[0]);
    await expect(layoutSlides(invalid,STUDIO_THEME,'executive-summary')).rejects.toThrow('PITCH_UNSUPPORTED_CONTENT');
    const chart=layoutFixture('dual-chart');const b=chart.blocks.find(b=>b.kind==='chart')!;b.series[0].values=[null,null];
    await expect(layoutSlides(chart,STUDIO_THEME,'dual-chart')).rejects.toThrow('PITCH_CHART_EMPTY');
    const table=layoutFixture('table-insight');table.blocks.find(b=>b.kind==='table')!.rows=[];
    await expect(layoutSlides(table,STUDIO_THEME,'table-insight')).rejects.toThrow('PITCH_EMPTY_TABLE');
    const encoding=layoutFixture('executive-summary');encoding.blocks.find(b=>b.kind==='paragraph')!.text='\uFFFD';
    await expect(layoutSlides(encoding,STUDIO_THEME,'executive-summary')).rejects.toThrow('PITCH_TEXT_ENCODING');
  });
  it('exports native text, charts, tables and new shapes with the visible data only', async () => {
    const patterns=['strategy-house','qualitative-funnel','dual-chart','table-insight'];
    const pages=(await Promise.all(patterns.map(async id=>(await layoutSlides(layoutFixture(id),STUDIO_THEME,id)).map(scene=>({scene,theme:STUDIO_THEME}))))).flat();
    const bytes=await renderPitchPptx('隔离结构验证',pages,[]),zip=await JSZip.loadAsync(bytes);
    const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));expect(names).toHaveLength(pages.length);
    const xml=(await Promise.all(names.map(n=>zip.file(n)!.async('string')))).join('');
    expect(xml).toContain('<a:t>');expect(xml).toContain('<a:tbl>');expect(xml).toContain('triangle');expect(xml).toContain('trapezoid');expect(xml).toContain('chart');
    expect(xml).not.toContain('<p:pic>');expect(Object.keys(zip.files).some(n=>/vbaProject|customXml|externalLink/.test(n))).toBe(false);
    const svg=await renderSceneSvg(pages[0].scene,STUDIO_THEME,[]);expect(svg).toContain('<polygon');expect(svg).toContain('opacity=');
  });
});
