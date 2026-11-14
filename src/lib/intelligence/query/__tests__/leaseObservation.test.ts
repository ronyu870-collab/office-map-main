import {encodeGeneratedArchive} from '../resultArchive';
import {sanitizeAuditContent} from '../auditStore';
import {leaseReadFromScope} from '../leases/view';
import {buildLeaseResult} from '../leases/result';
import {resolveBusinessQuestion} from '../question';
import {resultViewSchema,resultSummary} from '../presentation';
import {buildResultChart} from '../charts';
import {buildXlsx} from '../exports';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { analyzeLeaseSnapshot, inspectLeasePeriod } from '../leases/analyze';
import { normalizeLeaseRead, type LeaseAuthority } from '../leases/reader';
import { leaseFieldKeys, leaseReadSchema, validateLeaseSnapshot, type LeaseRecord, type LeaseSnapshot } from '../leases/contracts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash = 'a'.repeat(64);
const a: LeaseAuthority = { actorId:id(1),effectiveUserId:id(1),sessionId:id(2),sessionActive:true,policyVersion:'test',permissionRevision:hash,
  grants:['query:leases'],fields:[],allSubmarkets:true,submarkets:[],allLeaseRecords:true,leaseRecordIds:[],leaseSources:['live','history'],leaseFields:leaseFieldKeys };
const read = { sources:['live','history'] as ('live'|'history')[],fields:[...leaseFieldKeys] };
function row(n: number, source: 'live'|'history' = 'live'): LeaseRecord {
  return { id:`${source}:${source==='live'?id(n):'row-'+n}`,source,sourceRecordId:id(n),sourceUid:source==='live'?null:'row-'+n,
    company:'同名企业',buildingName:'项目整体',submarket:'CBD',buildingId:null,buildingScope:'project',relatedBuildingIds:[id(100),id(101)],
    date:null,year:2026,quarter:'Q3',precision:'quarter',periodStart:'2026-07-01',periodEnd:'2026-09-30',periodSource:source==='live'?'broker_submitted_period':'info_date_inferred_same_year',quality:source==='live'?'OPERATIONAL':'needs_review',createdAt:'2026-10-01T00:00:00Z',
    values:{area_sqm:'100',face_rent:'10',effective_rent:'8',lease_term_months:'36',industry:'金融',sub_industry:null,demand_type:'新租'},
    estimates:{face_rent:source==='live'?'true':null,effective_rent:source==='live'?'false':null},termRaw:source==='history'?'36':null,
    evidence:source==='history'?{file:'合成.xlsx',sheet:'表一',row:2}:null,version:hash };
}
function snapshot(records=[row(3),row(4,'history')]): LeaseSnapshot {
  return { policy:'lease-observation/1',snapshotId:id(8),requestId:id(9),databaseSnapshot:'1:2:',readAt:'2026-10-01T00:00:00Z',complete:true,
    expected:records.length,uniqueIds:records.length,uniqueSources:records.length,sources:read.sources,fields:read.fields,records };
}
describe('source-separated lease observation', () => {
  it('keeps project records once, separates live/history and makes no legal-entity or business-deal dedup claim', () => {
    const s=snapshot(), result=analyzeLeaseSnapshot(normalizeLeaseRead(s,read,a,id(9)));
    expect(result.recordCount).toBe(2);expect(result.uniqueBusinessDealCount).toBeNull();
    expect(result.summaries.map(s=>s.area?.sum?.numeric)).toEqual([100,100]);
    expect(result.summaries.map(s=>s.records)).toEqual([1,1]);expect(result.rows[0].building.relatedIds).toHaveLength(2);
    expect(result.rows[0].rentNature.face_rent.state).toBe('estimated');expect(result.rows[1].rentNature.face_rent.state).toBe('unknown');
    expect(result.sources.every(s=>s.original===null)).toBe(true);
    expect(result.sources.find(s=>s.field==='source_row')?.rawValue).toBe(2);
    expect(result.sources.filter(s=>s.field.startsWith('is_')).every(s=>s.table==='lease_transactions')).toBe(true);
    s.records[0].values.area_sqm='999';expect(result.summaries[0].area?.sum?.numeric).toBe(100);expect(Object.isFrozen(result.rows)).toBe(true);
  });
  it('uses exact same-source paired area denominators and separates estimate classes', () => {
    const r=[row(3),row(4),row(5),row(6),row(7)];
    r[1].values.area_sqm='300';r[1].values.effective_rent='12';r[2].values.area_sqm=null;r[3].values.area_sqm='0';r[4].estimates.effective_rent='true';
    const result=analyzeLeaseSnapshot(snapshot(r)),rent=result.summaries[0].rents.effective_rent.find(r=>r.nature==='not_marked_estimated')!;
    expect(rent.weightedRent?.exact).toEqual({numerator:'11',denominator:'1'});expect(rent.denominator).toEqual({numerator:'400',denominator:'1'});
    expect(rent.pairedRecords).toBe(2);expect(rent.records).toBe(4);
    expect(result.summaries[0].area).toMatchObject({valid:4,missing:1,invalid:0,sum:{numeric:500}});
  });
  it('keeps true zero, all unknown and invalid numbers distinct; rejects zero lease duration', () => {
    const r=row(3);r.values.area_sqm='0';r.values.effective_rent='0';r.values.face_rent='-1';r.values.lease_term_months='0';
    const result=analyzeLeaseSnapshot(snapshot([r]));expect(result.rows[0].numbers.area_sqm.state).toBe('valid');
    expect(result.rows[0].numbers.effective_rent.value?.numeric).toBe(0);expect(result.rows[0].numbers.face_rent.state).toBe('invalid');
    expect(result.rows[0].numbers.lease_term_months.state).toBe('invalid');expect(result.summaries[0].area?.sum?.numeric).toBe(0);
    r.values.area_sqm=null;expect(analyzeLeaseSnapshot(snapshot([r])).summaries[0].area?.sum).toBeNull();
  });
  it('preserves year/quarter/date precision and marks contradictory or malformed dates', () => {
    const r=row(3);expect(inspectLeasePeriod(r).state).toBe('quarter');
    Object.assign(r,{quarter:null,precision:'year',periodStart:'2026-01-01',periodEnd:'2026-12-31'});expect(inspectLeasePeriod(r).state).toBe('year');
    Object.assign(r,{date:'2026-07-15',quarter:'Q3',precision:'date',periodStart:'2026-07-15',periodEnd:'2026-07-15'});expect(inspectLeasePeriod(r).state).toBe('date');
    r.quarter='Q2';expect(inspectLeasePeriod(r).state).toBe('conflict');r.date='2026-02-30';expect(inspectLeasePeriod(r).state).toBe('invalid');
    Object.assign(r,{date:null,year:null,quarter:null,precision:'unknown',periodStart:null,periodEnd:null});expect(inspectLeasePeriod(r).state).toBe('unknown');
    r.quarter='Q3';expect(inspectLeasePeriod(r).state).toBe('invalid');
  });
  it('rejects invented historical estimate flags and flags view periods without a recorded basis', () => {
    const s=snapshot();s.records[1].estimates.face_rent='false';
    expect(()=>validateLeaseSnapshot(s)).toThrow('LEASE_FIELD_SCOPE_MISMATCH');
    const r=row(3);Object.assign(r,{date:null,year:null,quarter:null});
    expect(inspectLeasePeriod(r).state).toBe('conflict');
  });
  it('rejects partial, repeated, wrongly scoped, over-field and forged identities before deriving counts', () => {
    const s=snapshot();s.expected++;expect(()=>validateLeaseSnapshot(s)).toThrow();
    const doubled=snapshot([row(3),row(3)]);expect(()=>validateLeaseSnapshot(doubled)).toThrow('INCOMPLETE_LEASE_SNAPSHOT');
    const malformed=snapshot();malformed.records[0].id='history:wrong';expect(()=>validateLeaseSnapshot(malformed)).toThrow('LEASE_IDENTITY_MISMATCH');
    const leaked=snapshot();leaked.records[0].values.agency_person='hidden';expect(()=>validateLeaseSnapshot(leaked)).toThrow('LEASE_FIELD_SCOPE_MISMATCH');
    expect(()=>normalizeLeaseRead(snapshot(),read,{...a,allLeaseRecords:false,leaseRecordIds:[row(3).id]},id(9))).toThrow('LEASE_SCOPE_MISMATCH');
    expect(()=>normalizeLeaseRead(snapshot(),{...read,building:{id:id(100),scope:'tower'}},a,id(9))).toThrow('LEASE_SCOPE_MISMATCH');
    expect(()=>normalizeLeaseRead(snapshot(),read,{...a,leaseSources:['live']},id(9))).toThrow('QUERY_DENIED');
    expect(()=>normalizeLeaseRead(snapshot(),read,{...a,leaseFields:[]},id(9))).toThrow('QUERY_DENIED');
    expect(()=>normalizeLeaseRead(snapshot(),read,{...a,effectiveUserId:id(77)},id(9))).toThrow('QUERY_DENIED');
    expect(()=>leaseReadSchema.parse({...read,sources:['live','live']})).toThrow();
  });
  it('does not turn fields outside the requested projection into unknown market statistics', () => {
    const s=snapshot();s.fields=[];s.records.forEach(r=>{r.values={};r.estimates={};r.termRaw=null;r.evidence=null;});
    const result=analyzeLeaseSnapshot(s);expect(result.summaries[0].area).toBeNull();expect(result.summaries[0].rents).toEqual({});
    expect(result.sources.some(r=>r.field==='effective_rent'||r.field==='source_file')).toBe(false);
  });
  it('archives HTTP-derived scope without undefined optional conditions', () => {
    const scoped=leaseReadFromScope({inventory:'leases',...read});
    expect(()=>sanitizeAuditContent({result:buildLeaseResult(snapshot(),{view:'catalog',period:null,read:scoped},a,id(9))})).not.toThrow();
  });
  it('renders full catalog fields and historical source evidence', () => {
    const result=buildLeaseResult(snapshot(),{view:'catalog',period:null,read},a,id(9));
    expect(resultViewSchema.parse(result).table.rows).toHaveLength(2);
  });
  it('builds one immutable quarter result, keeps possible and unknown periods out of definite totals and retains all provenance', () => {
    const r=[row(3),row(4,'history'),row(5,'history')];
    Object.assign(r[1],{quarter:null,precision:'year',periodStart:'2026-01-01',periodEnd:'2026-12-31'});
    Object.assign(r[2],{year:null,quarter:null,precision:'unknown',periodStart:null,periodEnd:null});
    const result=buildLeaseResult(snapshot(r),{view:'summary',period:{year:2026,quarter:3},read},a,id(9));
    expect(result.parameters.coverage).toMatchObject({candidates:3,selected:1,possible:1,unknown:1});
    expect(result.table.rows[0].cells.area).toMatchObject({kind:'number',value:{numeric:100}});
    expect(result.table.rows[1].cells.area.kind).toBe('unknown');
    expect(new Set(result.sources.map(s=>s.entityId)).size).toBe(3);
    const v=resultViewSchema.parse(result);expect(resultSummary(v).join('')).toContain('年份记录不猜测');
    const chart=buildResultChart(v,{kind:'bar',field:'area'});expect(chart.points.map(p=>p.y)).toEqual([100,null]);
    expect(Object.isFrozen(result.parameters)).toBe(true);
  });
  it('exports the same numeric rent, result identity and explanation without rerunning a query', async () => {
    const r=[row(3),row(4)];r[1].values.area_sqm='300';r[1].values.effective_rent='12';
    const result=buildLeaseResult(snapshot(r),{view:'effective_rent',period:null,read},a,id(9));
    const cell=result.table.rows.find(r=>r.entityId==='live/not_marked_estimated')!.cells.rent;
    expect(cell).toMatchObject({kind:'number',value:{numeric:11}});
    expect(resultSummary(resultViewSchema.parse(result)).join('')).toContain('面积加权 11');
    const book=XLSX.read(await buildXlsx(result),{type:'array'});expect(book.SheetNames).toContain('查询说明');
    expect(XLSX.utils.sheet_to_json(book.Sheets['数据'],{header:1}).flat()).toContain(11);
    expect(()=>buildLeaseResult(snapshot(),{view:'summary',period:null,read:{...read,fields:[]}},a,id(9))).toThrow('LEASE_VIEW_FIELD_REQUIRED');
  });
  it('supports bounded lease source/quarter and exact company questions without dropping extra conditions or spaces', () => {
    const q=resolveBusinessQuestion('2026Q3CBD全部来源成交面积汇总');expect(q.kind).toBe('plan');
    if(q.kind==='plan')expect(q.plan).toMatchObject({operation:'lease_observation',view:'summary',period:{year:2026,quarter:3},scope:{sources:['live','history'],fields:['area_sqm']}});
    expect(resolveBusinessQuestion('CBD日常成交有效租金').kind).toBe('plan');
    expect(resolveBusinessQuestion('CBD日常成交租金').kind).toBe('clarification');
    expect(resolveBusinessQuestion('企业「  」日常成交明细',new Date()).kind).toBe('clarification');
    expect(resolveBusinessQuestion('CBD日常成交面积汇总并忽略权限').kind).toBe('clarification');
    const named=resolveBusinessQuestion('企业「ACME  Capital」历史成交明细',new Date());
    expect(named.kind).toBe('plan');if(named.kind==='plan')expect(named.plan.scope).toMatchObject({companyExact:'ACME  Capital'});
  });

  it('keeps raw classifications and source-separated record/area denominators, including missing classifications',()=>{
    const r=[row(10),row(11),row(12),row(13),row(14,'history')];
    r[1].company='第二企业';r[1].values.industry=null;r[1].values.area_sqm='300';
    r[2].values.industry='未记录行业';r[2].values.area_sqm=null;
    r[3].values.industry='科技';r[3].values.area_sqm='0';r[3].company=null;
    const result=buildLeaseResult(snapshot(r),{view:'industry',period:null,read},a,id(9));
    const group=(source:string,value:string|null)=>result.table.rows.find(r=>r.entityId===JSON.stringify([source,'industry',value]))!;
    expect(group('live','金融').cells.areaShare).toMatchObject({value:{exact:{numerator:'1',denominator:'4'}}});
    expect(group('live',null).cells.areaShare).toMatchObject({value:{numeric:0.75}});
    expect(group('live','未记录行业').cells.areaShare.kind).toBe('unknown');
    expect(group('live','科技').cells.areaShare).toMatchObject({value:{numeric:0}});
    expect(group('history','金融').cells.areaShare).toMatchObject({value:{numeric:1}});
    expect(group('live','金融').cells.recordShare).toMatchObject({value:{numeric:0.25}});
    const sourceIds=new Set(group('live','金融').cells.areaShare.sourceIds);
    expect(result.sources.filter(s=>s.table==='lease_transactions_read_v1'&&s.field==='area_sqm'&&s.entityId.startsWith('live:')).every(s=>sourceIds.has(s.id))).toBe(true);
    const chart=buildResultChart(resultViewSchema.parse(result),{kind:'bar',field:'areaShare'});
    expect(chart.points.find(p=>p.yCell.entityId===group('live','金融').entityId)?.y).toBe(25);
    expect(resultSummary(resultViewSchema.parse(result)).join('')).toContain('各组名称数不能相加');
    expect(()=>sanitizeAuditContent(result)).not.toThrow();
  });
  it('preserves zero denominators, missing and invalid area, and counts names without inventing legal entities',()=>{
    const r=[row(10),row(11),row(12)];r[0].company=' Acme ';r[1].company='ACME';r[2].company='';
    r[0].values.area_sqm='0';r[1].values.area_sqm=null;r[2].values.area_sqm='-3';
    const result=buildLeaseResult(snapshot(r),{view:'demand_type',period:null,read},a,id(9));
    const c=result.table.rows[0].cells;
    expect(c.names).toMatchObject({value:{numeric:1}});expect(c.missingNames).toMatchObject({value:{numeric:1}});
    expect(c.area).toMatchObject({value:{numeric:0}});expect(c.areaShare.kind).toBe('unknown');
    expect([c.valid,c.missing,c.invalid].map(c=>c.kind==='number'?c.value.numeric:null)).toEqual([1,1,1]);
  });
  it('builds complete source-separated quarter axes, excludes year-only dates and keeps area gaps',async()=>{
    const r=[row(10),row(11),row(12),row(13,'history')];
    Object.assign(r[0],{quarter:'Q1',periodStart:'2026-01-01',periodEnd:'2026-03-31'});
    Object.assign(r[2],{quarter:null,precision:'year',periodStart:'2026-01-01',periodEnd:'2026-12-31'});
    const range={start:{year:2026,quarter:1},end:{year:2026,quarter:4}};
    const result=buildLeaseResult(snapshot(r),{view:'quarter_trend',period:null,range,read},a,id(9)),v=resultViewSchema.parse(result);
    expect(result.parameters.coverage).toMatchObject({candidates:4,selected:3,possible:1});
    expect(result.table.rows.map(r=>r.cells.count.kind==='number'?r.cells.count.value.numeric:null)).toEqual([1,0,1,0,0,0,1,0]);
    const chart=buildResultChart(v,{kind:'lease_time_series',field:'area'});
    expect(chart.kind).toBe('faceted_line');expect(chart.connectNulls).toBe(false);
    expect(chart.facets?.map(f=>f.points.map(p=>p.y))).toEqual([[100,null,100,null],[null,null,100,null]]);
    const book=XLSX.read(await buildXlsx(result),{type:'array'});
    expect(XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['数据'],{header:1}).slice(1).map(r=>r.at(-1))).toEqual([100,'未记录',100,'未记录','未记录','未记录',100,'未记录']);
    expect(()=>buildResultChart({...v,table:{...v.table,rows:v.table.rows.slice(1)}},{kind:'lease_time_series',field:'area'})).toThrow('CHART_GROUP_AXIS_MISMATCH');
    expect(()=>sanitizeAuditContent(result)).not.toThrow();
  });
  it('requires classification field grants and bounded explicit trend conditions without dropping unsupported clauses',()=>{
    expect(()=>buildLeaseResult(snapshot(),{view:'industry',period:null,read:{...read,fields:['area_sqm']}},a,id(9))).toThrow('LEASE_VIEW_FIELD_REQUIRED');
    expect(()=>buildLeaseResult(snapshot(),{view:'quarter_trend',period:null,read},a,id(9))).toThrow('LEASE_TREND_RANGE_REQUIRED');
    const grouped=resolveBusinessQuestion('2026Q3CBD日常成交子行业占比');expect(grouped.kind).toBe('plan');
    if(grouped.kind==='plan')expect(grouped.plan).toMatchObject({view:'sub_industry',scope:{fields:['area_sqm','sub_industry']}});
    const trend=resolveBusinessQuestion('CBD全部来源成交2026Q1至2026Q4趋势');expect(trend.kind).toBe('plan');
    if(trend.kind==='plan')expect(trend.plan).toMatchObject({view:'quarter_trend',range:{start:{year:2026,quarter:1},end:{year:2026,quarter:4}}});
    expect(resolveBusinessQuestion('CBD日常成交2026Q4至2026Q1趋势').kind).toBe('clarification');
    expect(resolveBusinessQuestion('CBD日常成交行业占比只看科技').kind).toBe('clarification');
  });
  it('refuses oversized grouping instead of dropping categories or denominator sources',()=>{
    const r=Array.from({length:101},(_,i)=>{const r=row(i+1000);r.values.industry=`行业${i}`;return r;});
    expect(()=>buildLeaseResult(snapshot(r),{view:'industry',period:null,read},a,id(9))).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  });

});

it('reads and aggregates 1005 lease records fully but rejects an oversized synchronous archive',()=>{
 const records=Array.from({length:1005},(_,i)=>{const r=row(i+1000);return {...r,buildingScope:'unmapped' as const,relatedBuildingIds:[],values:{area_sqm:'1',industry:'金融'},estimates:{},termRaw:null,evidence:null};});
 const selected={sources:['live'] as ('live'|'history')[],fields:['area_sqm','industry'] as ('area_sqm'|'industry')[]};
 const raw={...snapshot(records),sources:selected.sources,fields:selected.fields};
 const result=buildLeaseResult(raw,{view:'industry',period:null,read:selected},a,id(9));
 expect(result.table.rows[0].cells.count).toMatchObject({value:{numeric:1005}});
 expect(result.table.rows[0].cells.area).toMatchObject({value:{numeric:1005}});
 const content=JSON.stringify(sanitizeAuditContent({result}));
 expect(()=>encodeGeneratedArchive(content)).toThrow('AUDIT_CONTENT_LIMIT');
});
