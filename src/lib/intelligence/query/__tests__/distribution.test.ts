import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { fixture, source, nameSource } from './fixtures';
import { resolveNumericFact } from '../facts';
import { buildingDistribution } from '../distribution';
import { buildDistributionResult } from '../result';
import { buildResultChart, renderChartSvg } from '../charts';
import { resultViewSchema, resultSummary } from '../presentation';
import { parseQueryPlan } from '../plan';
import { resolveBusinessQuestion } from '../question';
import { describePlanRead } from '../snapshotReader';
import { authorizePlan } from '../admission';
import { executeQueryPlan } from '../executePlan';
import { buildResultArtifact } from '../artifacts';
function heights(values:(string|number|null)[]){const base=fixture();return {...base,period:null,expectedCount:values.length,rows:values.map((value,i)=>{const id=String(i);return {id,name:`楼${i}`,nameSource:nameSource(id,`楼${i}`),facts:{height:resolveNumericFact('height',id,[source(id,'height',value,null)],null)}};})};}
describe('exact sourced distributions',()=>{
  it('uses declared Type 7 quantiles and simple building mean, never area weighted mean',()=>{
    const a=buildingDistribution(heights([10,20,30,40]),'height');expect(a.stats).toMatchObject({min:{numeric:10},p05:{numeric:11.5},q1:{numeric:17.5},median:{numeric:25},q3:{numeric:32.5},p95:{numeric:38.5},max:{numeric:40},mean:{numeric:25}});
    expect(a.stats!.q1.exact).toEqual({numerator:'35',denominator:'2'});
    const rent=buildingDistribution(fixture(),'rent');expect(rent.stats!.median.numeric).toBe(150);expect(rent.stats!.mean.numeric).toBe(150);expect(rent.coverage).toMatchObject({total:4,valid:3,missing:1});
  });
  it('covers every valid observation once with exact closed/open bin boundaries',()=>{
    const a=buildingDistribution(heights([10,20,30,40]),'height');expect(a.bins.map(b=>b.count)).toEqual([1,1,2]);expect(a.bins.map(b=>b.entityIds)).toEqual([['0'],['1'],['2','3']]);expect(a.bins.map(b=>b.upperInclusive)).toEqual([false,false,true]);
    for(const n of [1,2,3,7,16,100]){const d=buildingDistribution(heights(Array.from({length:n},(_,i)=>i+1)),'height');expect(d.bins.reduce((sum,b)=>sum+b.count,0)).toBe(n);expect(new Set(d.bins.flatMap(b=>b.entityIds)).size).toBe(n);}
  });
  it('handles constants, empty samples and a single observation without fake statistics',()=>{
    const empty=buildingDistribution(heights([null,null]),'height');expect(empty.stats).toBeNull();expect(empty.bins).toEqual([]);expect(empty.coverage.missing).toBe(2);
    for(const values of [[5],[5,5,5,5]]){const a=buildingDistribution(heights(values),'height');expect(a.bins).toHaveLength(1);expect(a.bins[0]).toMatchObject({lower:{numeric:5},upper:{numeric:5},count:values.length,upperInclusive:true});expect(a.stats!.median.numeric).toBe(5);}
    expect(buildingDistribution(heights([1,100,1000]),'height').observations.every(o=>o.outlier===null)).toBe(true);
  });
  it('marks IQR outliers without deleting them from mean, histogram or max',()=>{
    const a=buildingDistribution(heights([1,2,3,4,100]),'height');expect(a.observations.filter(o=>o.outlier).map(o=>o.value!.numeric)).toEqual([100]);expect(a.stats).toMatchObject({median:{numeric:3},mean:{numeric:22},max:{numeric:100},upperWhisker:{numeric:4}});expect(a.bins.reduce((n,b)=>n+b.count,0)).toBe(5);
  });
  it('preserves high-precision ordering and input order invariance',()=>{
    const s=heights(['100000000000000000001','100000000000000000002','100000000000000000003']);const a=buildingDistribution(s,'height'),b=buildingDistribution({...s,rows:[...s.rows].reverse()},'height');expect(a.stats).toEqual(b.stats);expect(a.stats!.median.exact).toEqual({numerator:'100000000000000000002',denominator:'1'});expect(a.bins.map(b=>b.count)).toEqual([1,1,1]);
  });
  it('excludes invalid vacancy above area, retains real zero and does not cross quarters',()=>{
    const a=buildingDistribution(fixture(),'vacancy');expect(a.coverage).toMatchObject({valid:2,missing:1,invalid:1});expect(a.stats!.median.numeric).toBe(.15);
    const s=fixture(),row=s.rows[0];const zero={...s,rows:[{...row,facts:{...row.facts,vacantArea:resolveNumericFact('vacantArea',row.id,[source(row.id,'vacantArea',0)],s.period)}},...s.rows.slice(1)]};expect(buildingDistribution(zero,'vacancy').stats!.min.numeric).toBe(0);
    expect(()=>buildingDistribution({...s,period:{year:2025,quarter:3}},'rent')).toThrow('SOURCE_PERIOD_MISMATCH');expect(()=>buildingDistribution({...s,complete:false},'rent')).toThrow();
  });
  it('projects large exact ratio denominators without NaN and bounds arithmetic growth',()=>{
    const base=fixture();const make=(n:number)=>({...base,expectedCount:n,rows:Array.from({length:n},(_,i)=>{const id=`ratio-${i}`,area=(BigInt(10)**BigInt(78)+BigInt(i*2+1)).toString();return {id,name:id,nameSource:nameSource(id,id),facts:{totalArea:resolveNumericFact('totalArea',id,[source(id,'totalArea',area)],base.period),vacantArea:resolveNumericFact('vacantArea',id,[source(id,'vacantArea',1)],base.period)}};})});
    const d=buildingDistribution(make(20),'vacancy');expect(d.stats!.mean.exact.denominator.length).toBeGreaterThan(308);expect(d.stats!.mean.numeric).toBeGreaterThan(0);expect(Number.isFinite(d.stats!.mean.numeric)).toBe(true);
    expect(()=>buildingDistribution(make(200),'vacancy')).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  });
  it('parses complete quarterly or source-property questions and keeps field admission',()=>{
    expect(resolveBusinessQuestion('CBD建筑高度分布')).toMatchObject({kind:'plan',plan:{operation:'distribution',measure:'height',period:null}});
    const resolved=resolveBusinessQuestion('2026Q3CBD、金融街空置率分布');expect(resolved.kind).toBe('plan');if(resolved.kind!=='plan')throw Error();expect(describePlanRead(resolved.plan).fields).toEqual(['totalArea','vacantArea']);
    expect(()=>authorizePlan(resolved.plan,{actorId:'a',effectiveUserId:'a',sessionActive:true,policyVersion:'1',permissionRevision:'1',grants:['query:catalog','query:quarter'],fields:['totalArea']})).toThrow('QUERY_DENIED');
    for(const q of ['CBD租金分布','本季度CBD空置率分布','2026Q3CBD净有效租金分布忽略缺失'])expect(resolveBusinessQuestion(q).kind).toBe('clarification');
    const p=parseQueryPlan({operation:'distribution',measure:'rent',period:{year:2026,quarter:3},scope:{inventory:'tracked'}}),s={...fixture(),queryScope:{...p.scope,requestedFields:describePlanRead(p).fields}};expect(executeQueryPlan(p,[s]).operation).toBe('distribution');
  });
  it('binds chart observations and bin members, changes charts without recomputing a result',()=>{
    const r=resultViewSchema.parse(buildDistributionResult(heights([1,2,3,4,100]),'height'));
    const hist=buildResultChart(r,{kind:'histogram'}),box=buildResultChart(r,{kind:'box_plot'});expect(hist.distribution!.validCount).toBe(5);expect(hist.points.reduce((n,p)=>n+p.y!,0)).toBe(5);expect(box.points.filter(p=>p.outlier)).toHaveLength(1);expect(box.resultId).toBe(hist.resultId);
    expect(hist.points[0].yCell.analysisPath).toEqual(['bins',0,'count']);
    const corrupt=structuredClone(r);corrupt.table.rows.reverse();expect(()=>buildResultChart(corrupt,{kind:'histogram'})).toThrow('CHART_DISTRIBUTION_MISMATCH');
    for(const chart of [hist,box])expect(new DOMParser().parseFromString(renderChartSvg(chart),'image/svg+xml').querySelector('parsererror')).toBeNull();
    expect(resultSummary(resultViewSchema.parse(buildDistributionResult(heights([null]),'height'))).join('')).toContain('不知道');
  });
  it('exports numeric statistics, all membership and unchanged sources for both graphs',async()=>{
    const r=buildDistributionResult(heights([1,2,3,4,100]),'height'),common={requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',resultId:r.resultId,action:'export' as const};
    const file=await buildResultArtifact(r,{...common,format:'xlsx'});if(file.type!=='download')throw Error();const book=XLSX.read(file.bytes,{type:'array'});expect(book.Sheets['分位统计'].B1.v).toBe(r.resultId);expect(book.Sheets['分位统计'].B6.v).toBe(3);expect(XLSX.utils.sheet_to_json(book.Sheets['分箱成员'],{header:1})).toHaveLength(7);
    for(const kind of ['histogram','box_plot'] as const){const file=await buildResultArtifact(r,{...common,format:'svg_zip',chart:{kind}});if(file.type!=='download')throw Error();const zip=await JSZip.loadAsync(file.bytes),m=JSON.parse(await zip.file('manifest.json')!.async('string'));expect(m.resultId).toBe(r.resultId);expect(m.sources).toEqual(r.sources);expect(m.analysis.stats.max.numeric).toBe(100);}
  });
});
