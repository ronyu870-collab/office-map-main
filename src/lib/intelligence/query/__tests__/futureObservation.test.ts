import {futureSample as sample} from './futureFixture';
import {describe,it,expect} from 'vitest';
import {id,hash} from './submissionFixture';
import {type FutureSnapshot,validateFutureSnapshot,futureReadSchema} from '../future/contracts';
import {analyzeFutureSnapshot,futureLaunchInterval,futureDueInQuarter} from '../future/analyze';
import {authorizeFutureRead,normalizeFutureRead,type FutureAuthority} from '../future/reader';

const authority:FutureAuthority={actorId:id(10),effectiveUserId:id(10),sessionId:id(20),sessionActive:true,policyVersion:'test',permissionRevision:hash,grants:['query:future-catalog','query:future-progress','query:future-quality'],fields:[],allSubmarkets:true,submarkets:[],allFutureSupplies:true,futureSupplyIds:[]};
describe('future supplies and selected-quarter task observations',()=>{
  it('preserves exact quarter, half-year, year range and truly unknown dates without completion fallback',()=>{
    expect(futureLaunchInterval('2027','H1')).toMatchObject({state:'half_year',start:{year:2027,quarter:1},end:{year:2027,quarter:2}});
    expect(futureLaunchInterval('2026',null)).toMatchObject({state:'year',start:{year:2026,quarter:1},end:{year:2026,quarter:4}});
    expect(futureLaunchInterval(null,'Q3')).toMatchObject({state:'unknown',start:null});
    for(const [y,q] of [['2026','Q6'],['2026','Q1 or Q2'],['2026年','Q3'],['99999','Q1']])expect(futureLaunchInterval(y,q).state).toBe('invalid');
    const s=sample();s.supplies[0].launch_year=null;const a=analyzeFutureSnapshot(s);expect(a.rows[0].launch.start).toBeNull();expect(a.rows[0].completionYear).toBe(2024);
    expect(futureDueInQuarter(futureLaunchInterval('2026','H2'),{year:2026,quarter:3})).toBe('possible');
    expect(futureDueInQuarter(futureLaunchInterval('2026','Q3'),{year:2026,quarter:3})).toBe('definite');
    expect(futureDueInQuarter(futureLaunchInterval('2026','H1'),{year:2026,quarter:3})).toBe('outside');
  });
  it('uses quarter assignment pairs, not launch quarter, current stock assignment or names as the task denominator',()=>{
    const a=analyzeFutureSnapshot(sample());expect(a.catalog.records).toBe(4);expect(a.catalog.pending).toBe(1);expect(a.catalog.futureRecords).toBe(3);
    expect(a.progress).toMatchObject({assignedSupplies:3,assignedSubmittedSupplies:2,missingAssignedSupplies:1,unassignedSupplies:1,unassignedSubmittedSupplies:1,
      assignmentPairs:4,submittedOwnerPairs:1,missingOwnerPairs:3,duplicateAssignments:1,repeatSubmissionRows:1,dueDefinite:1,duePossible:2,dueOutside:1,coverage:{numerator:'2',denominator:'3'}});
    expect(a.people).toHaveLength(2);expect(a.rows.map(r=>r.futureId)).toEqual([id(1),id(2),id(3),id(4)]);
    expect(a.sources.filter(r=>r.table==='future_supply_assignments').every(r=>r.period?.quarter===3)).toBe(true);
  });
  it('keeps missing or invalid area and location separate from valid numbers and treats unknown status explicitly',()=>{
    const s=sample();s.supplies[0].total_area=null;s.supplies[1].total_area='0';s.supplies[2].total_area='NaN';s.supplies[3].total_area='10.50';
    s.supplies[0].location_lng='0';s.supplies[0].location_lat='0';s.supplies[1].location_lng='190';s.supplies[2].location_lat=null;s.supplies[3].status=null;
    const a=analyzeFutureSnapshot(s);expect(a.catalog).toMatchObject({knownArea:1,missingArea:1,invalidArea:2,statusUnknown:1});
    expect(a.rows.map(r=>r.location.state)).toEqual(['invalid','invalid','unknown','valid']);expect(a.rows[3].area.value?.exact).toEqual({numerator:'21',denominator:'2'});
  });
  it('reuses whole-row microsecond ordering and exact quality rules with actual future table source IDs',()=>{
    const s=sample();s.submissions[0].created_at='2026-09-01T00:00:00.000002Z';s.submissions[1].created_at='2026-09-01T00:00:00.000001Z';s.submissions[0].values.asking_rent=null;
    const a=analyzeFutureSnapshot(s);expect(a.rows[0].latestSubmissionId).toBe(id(41));expect(a.rows[0].quality?.missingRequired).toEqual(['asking_rent']);
    expect(a.rows[0].quality?.issues.some(i=>i.code==='stored_percentage_differs_from_areas')).toBe(false);
    for(const r of a.rows)for(const issue of r.quality?.issues??[])for(const sid of issue.sourceIds){expect(sid).toContain('future_supply_submissions/');expect(a.sources.some(s=>s.id===sid)).toBe(true);}
    s.submissions[0].values.asking_rent='99';expect(a.rows[0].quality?.requiredComplete).toBe(false);expect(Object.isFrozen(a.rows[0])).toBe(true);
  });
  it('never attributes an unknown submitter to the assignee, while preserving actual building coverage',()=>{
    const s=sample();s.submissions[0].user_id=null;s.submissions[1].user_id=null;const a=analyzeFutureSnapshot(s);
    expect(a.progress).toMatchObject({assignedSubmittedSupplies:2,submittedOwnerPairs:0,unknownSubmitterRows:2});
    expect(a.rows[0].latestSubmittedBy?.userId).toBeNull();
  });
  it('missing submission time blocks choosing latest quality without converting an existing submission into no submission',()=>{
    const s=sample();s.submissions[0].created_at=null;const a=analyzeFutureSnapshot(s);expect(a.rows[0]).toMatchObject({submitted:true,latestUnresolved:true,latestSubmissionId:null,quality:null});
    expect(a.progress?.coverage).toEqual({numerator:'2',denominator:'3'});
  });
  it('empty assigned denominator is unknown; catalog never acquires task or quality data',()=>{
    const s=sample();s.assignments=[];s.expected.assignments=0;expect(analyzeFutureSnapshot(s).progress?.coverage).toBeNull();
    Object.assign(s,{mode:'catalog',period:null,configuredPeriod:null,periodBasis:'none',settings:[],submissions:[],expected:{supplies:4,assignments:0,submissions:0}});
    const a=analyzeFutureSnapshot(s);expect(a.progress).toBeNull();expect(a.people).toHaveLength(0);expect(a.sources.every(r=>r.table==='future_supplies')).toBe(true);
    expect(()=>futureReadSchema.parse({mode:'catalog',period:{year:2026,quarter:3}})).toThrow();
  });
  it('rejects incomplete counts, duplicates, crossed periods or identities and extra/absent fields',()=>{
    for(const mutate of [(s:FutureSnapshot)=>{s.expected.supplies=5;},(s:FutureSnapshot)=>{s.supplies[1].id=s.supplies[0].id;},(s:FutureSnapshot)=>{s.assignments[0].record_quarter=4;},
      (s:FutureSnapshot)=>{s.submissions[0].future_supply_id=id(999);},(s:FutureSnapshot)=>{s.supplies[0].building_id=id(50);s.supplies[1].building_id=id(50);},
      (s:FutureSnapshot)=>{s.submissions[0].values.notes='private';},(s:FutureSnapshot)=>{delete s.submissions[0].values.asking_rent;},(s:FutureSnapshot)=>{s.settings[1].value='4';}]){
      const s=sample();mutate(s);expect(()=>validateFutureSnapshot(s)).toThrow();
    }
    const s=sample();s.mode='progress';expect(()=>validateFutureSnapshot(s)).toThrow('FUTURE_FIELD_SCOPE_MISMATCH');s.submissions.forEach(r=>r.values={});expect(analyzeFutureSnapshot(s).rows.every(r=>r.quality===null)).toBe(true);
  });
  it('requires independent future scope/quality; stock grants, identity switching and broader requests cannot substitute',()=>{
    const read={mode:'quality' as const,period:null};expect(()=>authorizeFutureRead(read,authority)).not.toThrow();
    for(const a of [{...authority,grants:['query:catalog' as const,'query:submission-quality' as const]},
      {...authority,allFutureSupplies:false,futureSupplyIds:[]},{...authority,grants:['query:future-catalog' as const,'query:future-progress' as const]},
      {...authority,effectiveUserId:id(99)}])expect(()=>authorizeFutureRead(read,a)).toThrow('QUERY_DENIED');
    expect(()=>authorizeFutureRead({...read,futureIds:[id(2)]},{...authority,allFutureSupplies:false,futureSupplyIds:[id(1)]})).toThrow('QUERY_DENIED');
    expect(()=>normalizeFutureRead(sample(),read,{...authority,allFutureSupplies:false,futureSupplyIds:[id(1)]},id(91))).toThrow('FUTURE_SCOPE_MISMATCH');
  });
});
