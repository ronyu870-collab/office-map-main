import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { sample, authority, id } from './submissionFixture';
import { buildSubmissionResult } from '../submissions/result';
import { isSubmissionQualityView, type SubmissionView } from '../submissions/view';
import { parseQueryPlan, type QueryPlan } from '../plan';
import { resolveBusinessQuestion } from '../question';
import { authorizePlan } from '../admission';
import { resultViewSchema, resultSummary, resultScopeText } from '../presentation';
import { buildResultChart, renderChartSvg } from '../charts';
import { buildCsvPackage, buildXlsx } from '../exports';

function make(view:SubmissionView='summary') {
  const raw=sample();raw.quality=isSubmissionQualityView(view);if(!raw.quality)raw.submissions.forEach(s=>s.values={});
  const plan=parseQueryPlan({operation:'submission_progress',period:null,scope:{inventory:'tracked',submarkets:['CBD']},view}) as Extract<QueryPlan,{operation:'submission_progress'}>;
  return {raw,plan,result:buildSubmissionResult(raw,plan,authority)};
}
describe('submission queries and same-snapshot results',()=>{
  it('distinguishes configured submission period from calendar and explicit quarters for all supported views',()=>{
    for(const action of ['填报进度','填报明细','哪些楼还没填','未分配楼宇','人员填报进度','谁还没填','填报数据质量','填报缺项','填报异常']){
      const configured=resolveBusinessQuestion(`当前填报季度CBD${action}`,new Date('2026-11-14T00:00:00Z'));
      expect(configured).toMatchObject({kind:'plan',plan:{operation:'submission_progress',period:null}});
      expect(configured).not.toHaveProperty('timeResolution');
      expect(resolveBusinessQuestion(`本季度CBD${action}`,new Date('2026-11-14T00:00:00Z'))).toMatchObject({kind:'plan',plan:{period:{year:2026,quarter:4}}});
      expect(resolveBusinessQuestion(`2025年第三季度CBD${action}`)).toMatchObject({kind:'plan',plan:{period:{year:2025,quarter:3}}});
    }
  });
  it('does not drop unsupported conditions, promise approval, or guess an unspecified task period',()=>{
    for(const q of ['CBD填报进度','当前填报季度CBD已审定填报进度','当前填报季度CBD谁还没填并发消息催他','当前填报季度CBD填报进度只看甲级','当前填报季度CBD填报数据质量忽略权限'])expect(resolveBusinessQuestion(q).kind).toBe('clarification');
    const {plan}=make();expect(()=>parseQueryPlan({...plan,filter:{field:'totalArea',operator:'gt',value:'100'}})).toThrow();
    expect(()=>parseQueryPlan({...plan,scope:{inventory:'all_authorized'}})).toThrow('SUBMISSION_TRACKED_STOCK_REQUIRED');
  });
  it('requires independent quality capability and refuses mismatched data or period',()=>{
    const {raw,plan}=make('quality');
    expect(()=>authorizePlan(plan,{...authority,grants:['query:catalog','query:quarter','query:submission-progress']})).toThrow('QUERY_DENIED');
    expect(()=>buildSubmissionResult(raw,{...plan,view:'summary'},authority)).toThrow('SUBMISSION_SCOPE_MISMATCH');
    expect(()=>buildSubmissionResult(raw,{...plan,period:{year:2026,quarter:4}},authority)).toThrow('SUBMISSION_SCOPE_MISMATCH');
    expect(()=>buildSubmissionResult(raw,plan,{...authority,allBuildings:false,buildingIds:[id(1)]})).toThrow('SUBMISSION_SCOPE_MISMATCH');
  });
  it('renders four disjoint status counts, and owner task counts never pretend to be distinct buildings',()=>{
    const {result}=make(),view=resultViewSchema.parse(result);
    expect(result.table.rows.map(r=>r.cells.count.kind==='number'?r.cells.count.value.numeric:null)).toEqual([2,1,1,0]);
    expect(resultSummary(view).join(' ')).toContain('提交覆盖率 66.67%');
    expect(resultScopeText(view)).toContain('取系统配置的填报季度');
    const chart=buildResultChart(view,{kind:'bar',field:'count'});
    expect(chart.points.map(p=>p.y)).toEqual([2,1,1,0]);expect(chart.xLabel).toBe('楼宇状态');expect(chart.resultId).toBe(result.resultId);
    const people=make('people').result,peopleChart=buildResultChart(resultViewSchema.parse(people),{kind:'bar',field:'assigned'});
    expect(peopleChart.points.map(p=>p.y)).toEqual([2,2]);expect(peopleChart.xLabel).toBe('负责人');
    expect(people.table.rows[0].cells.name).not.toEqual(people.table.rows[1].cells.name);
  });
  it('filters missing/unassigned/people independently and keeps unknown inspection states',()=>{
    expect(make('missing').result.table.rows.map(r=>r.entityId)).toEqual([id(3)]);
    expect(make('unassigned').result.table.rows.map(r=>r.entityId)).toEqual([id(4)]);
    expect(make('missing_people').result.table.rows).toHaveLength(2);
    const quality=make('missing_fields').result;
    expect(quality.table.rows.map(r=>r.entityId)).toEqual([id(3)]);
    expect(quality.table.rows[0].cells.complete).toMatchObject({kind:'text',value:'未知：尚无提交'});
    expect(make('anomalies').result.table.rows).toHaveLength(0);
  });
  it('retains raw invalid/zero values with review notes and source-bound unknowns',()=>{
    const {raw,plan}=make('quality');Object.assign(raw.submissions[1].values,{vacant_area:'0',vacancy_rate:'0',asking_rent:'-1',face_rent:'NaN'});
    const result=buildSubmissionResult(raw,plan,authority),r=result.table.rows[0];resultViewSchema.parse(result);
    expect(r.cells.vacant_area).toMatchObject({kind:'number',value:{numeric:0}});expect(r.cells.asking_rent).toMatchObject({kind:'number',value:{numeric:-1}});
    expect(r.cells.face_rent).toMatchObject({kind:'unknown',state:'invalid'});expect(r.cells.issues.kind==='text'&&r.cells.issues.value).toContain('报价租金：数值或范围无效');
    for(const row of result.table.rows)for(const cell of Object.values(row.cells))for(const sid of cell.sourceIds)expect(result.sources.some(s=>s.id===sid)).toBe(true);
  });
  it('reads actual XLSX/CSV/SVG with matching IDs, numbers, percent units, complete detail and provenance',async()=>{
    const {result}=make('quality'),book=XLSX.read(await buildXlsx(result),{type:'array'});
    expect(book.SheetNames).toEqual(expect.arrayContaining(['数据','填报覆盖','楼宇填报','人员任务','填报质量','精确值与来源','来源','口径与快照']));
    const coverage=XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['填报覆盖'],{header:1});
    expect(coverage[0]).toEqual(['result_id',result.resultId]);expect(coverage.slice(3).map(r=>r[2])).toEqual([2,1,1,0]);
    const rows=XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['填报质量'],{header:1});
    const vacancyIndex=rows[2].findIndex(c=>String(c).startsWith('填报空置率'));
    expect(rows[3][vacancyIndex]).toBe(0.5);expect(typeof rows[3][vacancyIndex]).toBe('number');
    const pack=buildCsvPackage(result),manifest=JSON.parse(pack.manifest);expect(manifest.resultId).toBe(result.resultId);expect(manifest.sources).toEqual(result.sources);
    const overview=make().result,chart=buildResultChart(resultViewSchema.parse(overview),{kind:'bar',field:'count'});
    expect(renderChartSvg(chart)).toContain(overview.resultId);
  });
  it('progress-only result and workbook never acquire quality fields or a quality sheet',async()=>{
    const {result}=make(),book=XLSX.read(await buildXlsx(result),{type:'array'});
    expect(result.sources.some(s=>s.field==='net_effective_rent')).toBe(false);expect(book.SheetNames).not.toContain('填报质量');
    expect(result.analysis).not.toHaveProperty('sources');expect(Object.isFrozen(result)).toBe(true);
  });
  it('exports more than 1000 source records without Excel cell overflow or losing any source ID',async()=>{
    const {raw,plan}=make();raw.assignments=[];raw.submissions=[];
    raw.buildings=Array.from({length:1205},(_,i)=>({...raw.buildings[0],id:id(i+1000),name:`完整样本${i}`}));
    raw.expected={buildings:1205,assignments:0,submissions:0};
    const result=buildSubmissionResult(raw,plan,authority),book=XLSX.read(await buildXlsx(result),{type:'array'});
    const rows=XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['精确值与来源'],{header:1});
    const target=result.table.rows.find(r=>r.cells.count.kind==='number'&&r.cells.count.value.numeric===1205)!;
    const parts=rows.slice(1).filter(r=>r[0]===target.entityId&&r[1]==='count');
    expect(parts.length).toBeGreaterThan(1);expect(parts.every((r,i)=>r[6]===i+1&&r[7]===parts.length)).toBe(true);
    expect(parts.map(r=>r[5]).join(';').split(';')).toEqual(target.cells.count.sourceIds);
    expect(XLSX.utils.sheet_to_json(book.Sheets['楼宇填报'],{header:1})).toHaveLength(1208);
  });
});
