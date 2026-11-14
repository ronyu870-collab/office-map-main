import {describe,it,expect} from 'vitest';
import JSZip from 'jszip';
import {timelineResult} from './futureTimelineFixture';
import {id} from './submissionFixture';
import {intervalGeometry} from '../future/timeline';
import {buildResultChart,renderChartSvg} from '../charts';
import {buildResultArtifact} from '../artifacts';
import {resultViewSchema} from '../presentation';

describe('future launch intervals use archived quarter windows',()=>{
  it('retains quarter/half/year precision, disambiguates names and shares one scale without allocating supply',()=>{
    const result=timelineResult(),chart=buildResultChart(resultViewSchema.parse(result),{kind:'launch_intervals'}),g=intervalGeometry(chart);
    expect(chart.kind).toBe('interval');expect(chart.zeroBaseline).toBe(false);expect(chart.points.map(p=>p.y!-(p.x as number)+1)).toEqual([1,2,4,1]);
    expect(g.min).toBe(2026*4);expect(g.maxExclusive).toBe(2029*4);expect(new Set(chart.points.map(p=>p.label)).size).toBe(4);
    expect(chart.points[1].yText).toContain('下半年（季度未定）');expect(chart.points[2].yText).toContain('待核实');
    expect(g.width(chart.points[2])).toBeCloseTo(100/3);expect(g.position(chart.points[3].x as number)).toBeCloseTo(100*11/12);
    for(const p of chart.points){expect(p.yCell.key).toBe('launch');expect(p.yCell.sourceIds.every(id=>result.sources.some(s=>s.id===id))).toBe(true);}
  });
  it('keeps all-unknown, empty, single-quarter and very wide ranges distinct without fabricated zero dates',()=>{
    for(const count of [0,3]){const c=buildResultChart(resultViewSchema.parse(timelineResult(count,true)),{kind:'launch_intervals'});
      expect(intervalGeometry(c).empty).toBe(true);expect(c.renderedCount).toBe(0);expect(c.unknownCount).toBe(count);expect(c.points.every(p=>p.x===null&&p.y===null)).toBe(true);expect(renderChartSvg(c)).not.toMatch(/NaN|Infinity/);}
    const one=buildResultChart(resultViewSchema.parse(timelineResult(1)),{kind:'launch_intervals'});expect(intervalGeometry(one).width(one.points[0])).toBe(100);
    const wide=structuredClone(one);wide.points.push({...wide.points[0],x:1900*4,y:1900*4});expect(intervalGeometry(wide).ticks.length).toBeLessThanOrEqual(8);
  });
  it('rejects unrelated results, altered table boundaries and mismatched precision',()=>{
    const result=resultViewSchema.parse(timelineResult());expect(()=>buildResultChart({...result,parameters:{...result.parameters,view:'catalog'}},{kind:'launch_intervals'})).toThrow('CHART_LAUNCH_SCHEDULE_REQUIRED');
    const changed=structuredClone(result);changed.table.rows[1].cells.end={kind:'text',value:'2026Q3',sourceIds:[]};expect(()=>buildResultChart(changed,{kind:'launch_intervals'})).toThrow('CHART_INTERVAL_TABLE_MISMATCH');
    const c=buildResultChart(result,{kind:'launch_intervals'});c.points[1].y=c.points[1].x as number;expect(()=>intervalGeometry(c)).toThrow('CHART_INTERVAL_RANGE_INVALID');
  });
  it('exports all intervals, unknowns, exact source bindings and the same result in a standalone SVG package',async()=>{
    const result=timelineResult(30);const artifact=await buildResultArtifact(result,{action:'export',requestId:id(91),resultId:result.resultId,format:'svg_zip',chart:{kind:'launch_intervals'}});
    if(artifact.type!=='download')throw Error();const zip=await JSZip.loadAsync(artifact.bytes),manifest=JSON.parse(await zip.file('manifest.json')!.async('string')),svg=await zip.file('chart.svg')!.async('string');
    expect(manifest.resultId).toBe(result.resultId);expect(manifest.chart.points).toHaveLength(30);expect(manifest.sources).toEqual(result.sources);expect(svg).toContain('记录 30');expect(svg).toContain('stroke-dasharray');expect(svg).toContain('不代表持续供给');
    const chart=buildResultChart(resultViewSchema.parse(result),{kind:'launch_intervals'});chart.points[0].label='<script>alert(1)</script>';expect(renderChartSvg(chart)).not.toContain('<script>');
  });
});
