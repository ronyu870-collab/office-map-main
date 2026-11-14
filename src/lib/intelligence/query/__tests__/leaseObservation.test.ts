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
});
