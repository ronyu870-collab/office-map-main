import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { fixture, source } from './fixtures';
import { resolveNumericFact } from '../facts';
import { rentVacancyRelationship } from '../relationship';
import { buildRelationshipResult } from '../result';
import { executeQueryPlan } from '../executePlan';
import { parseQueryPlan } from '../plan';
import { describePlanRead } from '../snapshotReader';
import { authorizePlan } from '../admission';
import { resolveBusinessQuestion } from '../question';
import { buildResultChart, chartBounds } from '../charts';
import { resultSummary, resultViewSchema } from '../presentation';
import { buildResultArtifact } from '../artifacts';

function sample(rents: (string|number|null)[], vacancies: (string|number|null)[]) {
  const s=fixture();
  return {...s, expectedCount:rents.length,rows:s.rows.slice(0,rents.length).map((r,i)=>({...r,facts:{...r.facts,
    totalArea:resolveNumericFact('totalArea',r.id,[source(r.id,'totalArea',100)],s.period),
    netEffectiveRent:resolveNumericFact('netEffectiveRent',r.id,[source(r.id,'netEffectiveRent',rents[i])],s.period),
    vacantArea:resolveNumericFact('vacantArea',r.id,[source(r.id,'vacantArea',vacancies[i])],s.period),
  }}))};
}
const plan=()=>parseQueryPlan({operation:'relationship',period:{year:2026,quarter:3},scope:{inventory:'tracked'}});
describe('sourced building rent-vacancy relationship',()=>{
  it('parses the full supported question without ignoring extras, wrong rent definitions or periods',()=>{
    expect(resolveBusinessQuestion('2026Q3CBD、金融街净有效租金与空置率关系')).toMatchObject({kind:'plan',plan:{operation:'relationship',scope:{submarkets:['CBD','金融街']}}});
    for(const text of ['本季度CBD净有效租金与空置率关系','2026Q3CBD租金与空置率关系','2026Q3CBD净有效租金与空置率关系只看A座'])expect(resolveBusinessQuestion(text).kind).toBe('clarification');
    expect(()=>parseQueryPlan({...plan(),period:null})).toThrow();
  });
  it('uses joint rows rather than multiplying independent coverage or pairing different buildings',()=>{
    const a=rentVacancyRelationship(fixture());expect(a.coverage).toEqual({candidates:4,rentValid:3,vacancyValid:2,jointValid:2,excluded:2});
    expect(a.jointEntityIds).toEqual(['A','B']);expect(a.correlation).toMatchObject({value:null,unavailableReason:'fewer_than_three_joint_samples'});
    expect(a.rows[3].vacancy.excluded[0].reason).toBe('vacant_area_exceeds_total_area');
    expect(a.rows[3].rent.value?.numeric).toBe(150);
  });
  it('calculates positive, negative and zero Pearson relations with exact moments',()=>{
    for(const [ys,value] of [[[10,20,30],1],[[30,20,10],-1],[[10,30,10],0]] as const){
      const a=rentVacancyRelationship(sample([100,200,300],[...ys]));expect(a.correlation.value).toBe(value);expect(a.correlation.approximate).toBe(true);expect(a.correlation.squaredExact).toEqual({numerator:String(value*value),denominator:'1'});
    }
    const a=rentVacancyRelationship(sample([100,200,300],[10,20,40]));expect(a.correlation.value).toBe(.981981);expect(a.correlation.squaredExact).toEqual({numerator:'27',denominator:'28'});
  });
  it('does not mistake constant or empty samples for no correlation',()=>{
    expect(rentVacancyRelationship(sample([100,100,100],[0,10,20])).correlation).toMatchObject({value:null,unavailableReason:'constant_variable'});
    expect(rentVacancyRelationship(sample([100,200,300],[0,0,0])).correlation.value).toBeNull();
    expect(rentVacancyRelationship(sample([],[])).coverage.jointValid).toBe(0);
    expect(rentVacancyRelationship(sample([100,200,300],[0,10,20])).correlation.value).toBe(1);
  });
  it('retains decimal differences far beyond float precision and is order invariant',()=>{
    const s=sample(['100000000000000000001','100000000000000000002','100000000000000000003'],[10,20,40]);
    const a=rentVacancyRelationship(s),b=rentVacancyRelationship({...s,rows:[...s.rows].reverse()});expect(a.correlation.value).toBe(.981981);expect(b.correlation).toEqual(a.correlation);expect(b.moments).toEqual(a.moments);
  });
  it('rejects forged source facts, incomplete reads and mixed-quarter observations',()=>{
    const s=sample([100,200,300],[10,20,30]);expect(()=>rentVacancyRelationship({...s,complete:false})).toThrow();
    const bad=s.rows[0].facts.vacantArea!.sources.map(source=>({...source,period:{year:2025,quarter:3}}));
    expect(()=>rentVacancyRelationship({...s,rows:[{...s.rows[0],facts:{...s.rows[0].facts,vacantArea:{...s.rows[0].facts.vacantArea!,sources:bad}}},...s.rows.slice(1)]})).toThrow('SOURCE_PERIOD_MISMATCH');
  });
  it('bounds exact arithmetic without silently dropping a suffix of the sample',()=>{
    const base=fixture(), row=base.rows[0];
    const rows=Array.from({length:200},(_,i)=>{
      const id=`large-${i}`,area=(BigInt(10)**BigInt(78)+BigInt(i*2+1)).toString();
      return {...row,id,nameSource:{...row.nameSource,id:`name/${id}`,entityId:id,recordId:id},facts:{
        totalArea:resolveNumericFact('totalArea',id,[source(id,'totalArea',area)],base.period),
        netEffectiveRent:resolveNumericFact('netEffectiveRent',id,[source(id,'netEffectiveRent',i+1)],base.period),
        vacantArea:resolveNumericFact('vacantArea',id,[source(id,'vacantArea',1)],base.period),
      }};
    });
    expect(()=>rentVacancyRelationship({...base,rows,expectedCount:rows.length})).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  });
  it('requires all three field grants before read and binds plan filter/scope',()=>{
    const p=plan();expect(describePlanRead(p).fields).toEqual(['netEffectiveRent','totalArea','vacantArea']);
    const authority={actorId:'a',effectiveUserId:'a',sessionActive:true,policyVersion:'1',permissionRevision:'1',grants:['query:catalog','query:quarter'] as const,fields:['netEffectiveRent','totalArea'] as const};
    expect(()=>authorizePlan(p,authority)).toThrow('QUERY_DENIED');
    const raw=fixture(),s={...raw,queryScope:{...p.scope,requestedFields:describePlanRead(p).fields}};
    expect(executeQueryPlan(p,[s]).operation).toBe('relationship');
    expect(()=>executeQueryPlan({...p,filter:{field:'netEffectiveRent',operator:'gt',value:'100'}},[s])).toThrow('QUERY_SNAPSHOT_PLAN_MISMATCH');
  });
  it('keeps independent unknowns, true zero, full candidates and sourced scatter in one result',()=>{
    const r=buildRelationshipResult(fixture()),v=resultViewSchema.parse(r),c=buildResultChart(v,{kind:'scatter',x:'rent',y:'vacancy'});
    expect(c.renderedCount).toBe(2);expect(c.unknownCount).toBe(2);expect(chartBounds(c,'y')).toEqual([0,100]);
    expect(c.points[3]).toMatchObject({x:150,y:null,state:'unknown'});expect(r.table.rows[3].cells.vacancy).toMatchObject({kind:'unknown',state:'invalid'});
    expect(c.points[0].yCell.sourceIds).toHaveLength(2);expect(resultSummary(v).join('')).toContain('不足3栋');expect(r.table.rows).toHaveLength(4);
  });
  it('exports the exact result, coefficient rules and sources without recomputation',async()=>{
    const r=buildRelationshipResult(sample([100,200,300],[10,20,40])),common={requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',resultId:r.resultId,action:'export' as const};
    const x=await buildResultArtifact(r,{...common,format:'xlsx'});if(x.type!=='download')throw Error();const book=XLSX.read(x.bytes,{type:'array'});expect(book.Sheets['数据'].D2.v).toBe(.1);expect(book.Sheets['联合统计'].B3.v).toContain('0.981981');expect(book.Sheets['口径与快照'].B2.v).toBe(r.resultId);
    for(const format of ['csv_zip','svg_zip'] as const){const a=await buildResultArtifact(r,{...common,format,...(format==='svg_zip'?{chart:{kind:'scatter' as const,x:'rent',y:'vacancy'}}:{})});if(a.type!=='download')throw Error();const zip=await JSZip.loadAsync(a.bytes),manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));expect(manifest.resultId).toBe(r.resultId);expect(manifest.analysis.correlation.value).toBe(.981981);}
  });
});
