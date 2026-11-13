import { describe, expect, it } from 'vitest';
import { analyzeSubmissionSnapshot, inspectSubmission } from '../submissions/analyze';
import { validateSubmissionSnapshot, type SubmissionSnapshot } from '../submissions/contracts';
import { authorizeSubmissionRead, normalizeSubmissionRead } from '../submissions/reader';

import { id, authority, sample } from './submissionFixture';
describe('quarterly submission observations', () => {
  it('keeps building coverage, owner pairs, raw records and unassigned work as different denominators', () => {
    const a = analyzeSubmissionSnapshot(sample());
    expect(a.counts).toEqual({ catalogBuildings:4,assignedBuildings:3,unassignedBuildings:1,submittedBuildings:3,assignedSubmittedBuildings:2,
      missingAssignedBuildings:1,unassignedSubmittedBuildings:1,assignmentPairs:4,submittedOwnerPairs:1,missingOwnerPairs:3,
      duplicateAssignmentRows:1,invalidAssignmentRows:0,rawSubmissions:4,repeatSubmissionRows:1,latestUnresolvedBuildings:0 });
    expect(a.submittedCoverage).toEqual({ numerator:'2',denominator:'3' });
    expect(a.people).toHaveLength(2);
    expect(a.people[0].names).toEqual(['同名人员']);
    expect(a.people[0].missingBuildingIds).toEqual([id(2)]);
    expect(a.people[1].missingBuildingIds).toEqual([id(1),id(3)]);
  });
  it('chooses whole rows using the shared microsecond selector, never repairs a new blank from older values', () => {
    const s = sample();
    s.submissions[0].createdAt = '2026-11-14T00:00:00.000002Z';
    s.submissions[0].values.asking_rent = null;
    s.submissions[1].updatedAt = '2026-11-15T00:00:00Z';
    const a = analyzeSubmissionSnapshot(s);
    expect(a.rows[0].latestSubmissionId).toBe(id(41));
    expect(a.rows[0].quality?.missingRequired).toEqual(['asking_rent']);
    expect(a.quality?.requiredCompleteBuildings).toBe(2);
    expect(analyzeSubmissionSnapshot({ ...s, submissions: [...s.submissions].reverse() }).rows).toEqual(a.rows.map(r => ({ ...r, sourceIds: expect.any(Array) })));
  });
  it('retains submission coverage but does not choose latest/quality when any timestamp is missing', () => {
    const s = sample(); s.submissions[0].createdAt = null;
    const a = analyzeSubmissionSnapshot(s);
    expect(a.rows[0]).toMatchObject({ submitted:true, latestUnresolved:true, latestSubmissionId:null, quality:null });
    expect(a.counts.latestUnresolvedBuildings).toBe(1);
    expect(a.quality?.evaluatedBuildings).toBe(2);
  });
  it('keeps real zeroes complete, applies percent units even below one, and preserves original precision', () => {
    const r = sample().submissions[0];
    expect(inspectSubmission(r).issues).toEqual([]); // 50 / 10000 = 0.5%, never guessed as ratio.
    Object.assign(r.values,{ vacant_area:'0', vacancy_rate:'0', asking_rent:'0', management_fee:'0', rent_free_period:'0', face_rent:'0', net_effective_rent:'0' });
    expect(inspectSubmission(r)).toMatchObject({ requiredComplete:true, rentEligible:false, vacancyEligible:true });
    expect(inspectSubmission(r).issues.map(x=>x.kind)).toEqual(['unavailable']);
  });
  it('distinguishes complete inputs from invalid ranges, missing values and calculation discrepancies', () => {
    const r = sample().submissions[0];
    Object.assign(r.values, { vacant_area:'15000', asking_rent:'-1', rent_free_period:'37', total_area:'10000' });
    const a=inspectSubmission(r); expect(a.requiredComplete).toBe(true); expect(a.vacancyEligible).toBe(false);
    expect(a.issues.filter(x=>x.kind==='invalid')).toHaveLength(3);
    Object.assign(r.values,{ vacant_area:'50', asking_rent:null, rent_free_period:'6', vacancy_rate:'0.005', net_effective_rent:'120' });
    expect(inspectSubmission(r).issues.map(x=>x.code)).toEqual(['missing_field','stored_percentage_differs_from_areas','net_rent_differs_from_36_month_formula']);
  });
  it('uses exact decimal thresholds and never silently corrects stored fields', () => {
    const r=sample().submissions[0];r.values.vacancy_rate='0.511';r.values.net_effective_rent='100.005';
    expect(inspectSubmission(r).issues).toEqual([]);
    r.values.vacancy_rate='0.511000000000000001';r.values.net_effective_rent='100.005000000000000001';
    expect(inspectSubmission(r).issues.filter(i=>i.kind==='inconsistent')).toHaveLength(2);
    expect(r.values.net_effective_rent).toBe('100.005000000000000001');
    const s=sample();s.submissions[1].values.total_area='1'.repeat(101);
    expect(analyzeSubmissionSnapshot(s).rows[0].quality?.issues.some(i=>i.code==='invalid_range_or_decimal'&&i.fields.includes('total_area'))).toBe(true);
  });
  it('keeps all sources, immutable snapshots and evidence for every quality finding', () => {
    const s=sample();s.submissions[0].values.face_rent='NaN';s.submissions[0].createdAt='2026-11-14T00:00:00.000002Z';
    const a=analyzeSubmissionSnapshot(s), ids=new Set(a.sources.map(r=>r.id));
    expect(a.sources.some(r=>r.table==='quarterly_submissions'&&r.field==='face_rent'&&r.rawValue==='NaN')).toBe(true);
    for(const r of a.rows)for(const i of r.quality?.issues??[])for(const id of i.sourceIds)expect(ids.has(id)).toBe(true);
    expect(a.sources.every(r=>r.original===null && r.verification==='database_only')).toBe(true);
    s.buildings[0].name='changed';expect(a.rows[0].name).toBe('1座');expect(Object.isFrozen(a.rows)).toBe(true);
  });
  it('returns unknown coverage for no assigned tasks, retains blank assignment anomalies', () => {
    const s=sample();s.assignments.forEach(a=>a.userId=' ');
    const a=analyzeSubmissionSnapshot(s);expect(a.submittedCoverage).toBeNull();expect(a.people).toEqual([]);
    expect(a.counts.invalidAssignmentRows).toBe(5);expect(a.counts.unassignedSubmittedBuildings).toBe(3);
  });
  it('never exposes numeric submission data with progress-only permission', () => {
    const s=sample();s.quality=false;s.submissions.forEach(r=>r.values={});
    const a=analyzeSubmissionSnapshot(s);expect(a.quality).toBeNull();expect(a.sources.some(r=>r.field==='net_effective_rent')).toBe(false);
    s.submissions[0].values.net_effective_rent='100';expect(()=>analyzeSubmissionSnapshot(s)).toThrow('SUBMISSION_FIELDS_MISMATCH');
  });
  it('rejects truncated, duplicate, off-period, foreign or falsely configured records', () => {
    const mutators: ((s:SubmissionSnapshot)=>void)[]=[s=>{s.expected.buildings++;},s=>{s.assignments[1].id=s.assignments[0].id;},
      s=>{s.submissions[0].buildingId=id(999);},s=>{s.submissions[0].quarter=2;},s=>{s.settings[1].value='4';},s=>{s.submissions[0].values.contact_phone='secret';}];
    for(const mutate of mutators){const s=sample();mutate(s);expect(()=>validateSubmissionSnapshot(s)).toThrow();}
  });
  it('does not guess a configured period, while allowing an explicit historical period with unknown settings', () => {
    const s=sample();s.settings=[];s.configuredPeriod=null;s.periodBasis='explicit';
    expect(validateSubmissionSnapshot(s).period).toEqual({year:2026,quarter:3});
    s.periodBasis='configured';expect(()=>validateSubmissionSnapshot(s)).toThrow('SUBMISSION_PERIOD_MISMATCH');
  });
  it('requires independent progress/quality capabilities and current scope even for an otherwise authorized admin', () => {
    const read={period:null,quality:true};
    for(const grants of [[],['query:catalog','query:quarter'],['query:catalog','query:submission-progress']] as const)
      expect(()=>authorizeSubmissionRead(read,{...authority,grants})).toThrow('QUERY_DENIED');
    expect(()=>normalizeSubmissionRead(sample(),read,{...authority,allBuildings:false,buildingIds:[id(1)]},id(91))).toThrow('SUBMISSION_SCOPE_MISMATCH');
    expect(()=>normalizeSubmissionRead(sample(),read,authority,id(92))).toThrow('SUBMISSION_SCOPE_MISMATCH');
    expect(()=>authorizeSubmissionRead(read,{...authority,effectiveUserId:id(99)})).toThrow('QUERY_DENIED');
    expect(normalizeSubmissionRead(sample(),read,authority,id(91)).buildings).toHaveLength(4);
  });
  it('rejects source expansion beyond the synchronous evidence budget instead of returning a truncated count', () => {
    const s=sample(), row=s.submissions[0];
    s.submissions=Array.from({length:14000},(_,i)=>({...row,id:id(100000+i)}));
    s.expected.submissions=s.submissions.length;
    expect(()=>analyzeSubmissionSnapshot(s)).toThrow('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');
  },15000);
});
