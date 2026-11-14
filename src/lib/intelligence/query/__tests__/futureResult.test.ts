import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {futureSample} from './futureFixture';
import {id,hash} from './submissionFixture';
import {buildFutureResult,futureResultTable} from '../future/result';
import {futureAnalysisSchema,futureModeForView,type FutureView} from '../future/view';
import type {FutureAuthority} from '../future/reader';
import {buildXlsx,buildCsvPackage} from '../exports';
import {buildResultChart,renderChartSvg} from '../charts';
import {resultViewSchema,resultSummary,resultScopeText} from '../presentation';
const authority:FutureAuthority={actorId:id(10),effectiveUserId:id(10),sessionId:id(20),sessionActive:true,policyVersion:'test',permissionRevision:hash,
  grants:['query:future-catalog','query:future-progress','query:future-quality'],fields:[],allSubmarkets:true,submarkets:[],allFutureSupplies:true,futureSupplyIds:[]};
function make(view:FutureView='summary'){
  const raw=futureSample(),mode=futureModeForView(view);raw.mode=mode;
  if(mode==='catalog'){raw.period=null;raw.periodBasis='none';raw.configuredPeriod=null;raw.settings=[];raw.assignments=[];raw.submissions=[];raw.expected.assignments=0;raw.expected.submissions=0;}
  else if(mode==='progress')raw.submissions.forEach(r=>{r.values={};});
  const selection={view,period:null};return {raw,selection,result:buildFutureResult(raw,selection,authority,raw.requestId)};
}
describe('immutable future supply results and same-result artifacts',()=>{
  it('keeps future identity, pending, half/year precision and unknown values visible in catalog',()=>{
    const {raw,selection}=make('catalog');raw.supplies[0].launch_year=null;raw.supplies[0].total_area=null;
    const result=buildFutureResult(raw,selection,authority,raw.requestId),view=resultViewSchema.parse(result);
    expect(result.table.rows.map(r=>r.entityId)).toEqual(raw.supplies.map(r=>r.id));expect(result.table.rows[0].cells.area).toMatchObject({kind:'unknown',state:'missing'});
    expect(result.table.rows[0].cells.launch).toMatchObject({kind:'text',value:'未知：未记录预计年份'});
    expect(result.table.rows[1].cells.launch).toMatchObject({value:'2026年下半年（季度未定）'});expect(result.table.rows[2].cells.launch).toMatchObject({value:'2026年（季度未定）'});
    expect(result.table.rows[2].cells.status).toMatchObject({value:'待核实'});expect(resultSummary(view).join(' ')).toContain('记录数不等于已确认的不同楼宇数');expect(resultScopeText(view)).toContain('保留原时间精度');
  });
  it('projects launch precision and disjoint quarterly coverage charts without inventing definite quarters',()=>{
    const launch=make('launch_summary').result,chart=buildResultChart(resultViewSchema.parse(launch),{kind:'bar',field:'count'});
    expect(chart.points.map(r=>r.y)).toEqual([2,1,1,0,0]);expect(chart.xLabel).toBe('预计入市时间精度');
    const result=make().result,view=resultViewSchema.parse(result);expect(buildResultChart(view,{kind:'bar',field:'count'}).points.map(r=>r.y)).toEqual([2,1,1,0]);
    expect(resultSummary(view).join(' ')).toContain('提交覆盖率 66.67%');expect(resultScopeText(view)).toContain('2026Q3季度任务');
  });
  it('separates same-name accounts, owner tasks, missing records and unassigned records',()=>{
    const people=make('people').result;expect(people.table.rows[0].cells.name).not.toEqual(people.table.rows[1].cells.name);
    expect(buildResultChart(resultViewSchema.parse(people),{kind:'bar',field:'assigned'}).points.map(p=>p.y)).toEqual([2,2]);
    expect(people.table.columns.find(c=>c.key==='assigned')?.unit).toBe('task_count');
    expect(make('missing').result.table.rows.map(r=>r.entityId)).toEqual([id(3)]);expect(make('unassigned').result.table.rows.map(r=>r.entityId)).toEqual([id(4)]);
    expect(make('missing_people').result.table.rows).toHaveLength(2);expect(make('missing_fields').result.table.rows.map(r=>r.entityId)).toEqual([id(3)]);
  });
  it('preserves raw zero/negative/invalid quality and latest unknown with complete source bindings',()=>{
    const {raw,selection}=make('quality');raw.submissions[0].created_at=null;raw.submissions[2].values.vacant_area='0';raw.submissions[2].values.asking_rent='-1';raw.submissions[2].values.face_rent='NaN';
    const result=buildFutureResult(raw,selection,authority,raw.requestId);resultViewSchema.parse(result);
    expect(result.table.rows[0].cells.asking_rent).toMatchObject({kind:'unknown',state:'unverified'});expect(result.table.rows[1].cells.vacant_area).toMatchObject({kind:'number',value:{numeric:0}});
    expect(result.table.rows[1].cells.asking_rent).toMatchObject({kind:'number',value:{numeric:-1}});expect(result.table.rows[1].cells.face_rent).toMatchObject({kind:'unknown',state:'invalid'});
    expect(buildFutureResult(raw,{...selection,view:'anomalies'},authority,raw.requestId).table.rows.map(r=>r.entityId)).toEqual([id(1),id(2)]);
    for(const row of result.table.rows)for(const c of Object.values(row.cells))for(const ref of c.sourceIds)expect(result.sources.some(s=>s.id===ref)).toBe(true);
  });
  it('archives the question-specific answer and retains legacy answers without changing unknown quality into missing fields',()=>{
    const {raw,selection}=make('quality');raw.submissions[0].created_at=null;raw.submissions[2].values.asking_rent=null;
    const result=buildFutureResult(raw,selection,authority,raw.requestId),view=resultViewSchema.parse(result);
    const answer=resultSummary(view);expect(answer[0]).toContain('最新提交可核查 2 条');expect(answer[0]).toContain('缺项 1 条');
    expect(answer[1]).toContain('1 条无该季提交');expect(answer[1]).toContain('1 条无法确认最新记录');
    expect(answer[1]).toContain('质量未知');expect(Object.isFrozen(result.parameters.answer)).toBe(true);
    const archive=JSON.parse(JSON.stringify(view));archive.analysis.catalog.records=999;
    expect(resultSummary(archive)).toEqual(answer);
    delete archive.parameters.answer;expect(resultSummary(archive)[0]).toContain('当前获权');
    archive.parameters.answer={version:'unknown',paragraphs:answer};expect(resultViewSchema.safeParse(archive).success).toBe(false);
    const missing=make('missing_fields').result;expect(resultSummary(resultViewSchema.parse(missing))[0]).toContain('缺项或无法检查的记录 1 条');
    expect(resultSummary(resultViewSchema.parse(make('people').result))[0]).toContain('人员任务 4 项');
  });
  it('refuses wrong request/period/mode/scope/grants and prevents catalog or progress projections from acquiring quality',()=>{
    const {raw,selection}=make('quality');expect(()=>buildFutureResult(raw,selection,authority,id(99))).toThrow();
    expect(()=>buildFutureResult(raw,{...selection,period:{year:2026,quarter:2}},authority,raw.requestId)).toThrow();
    expect(()=>buildFutureResult(raw,{...selection,view:'catalog'},authority,raw.requestId)).toThrow();
    expect(()=>buildFutureResult(raw,selection,{...authority,allFutureSupplies:false,futureSupplyIds:[id(1)]},raw.requestId)).toThrow();
    expect(()=>buildFutureResult(raw,selection,{...authority,grants:['query:future-catalog','query:future-progress']},raw.requestId)).toThrow('QUERY_DENIED');
    const a=futureAnalysisSchema.parse(make('catalog').result.analysis);expect(()=>futureResultTable(a,[],'people')).toThrow('FUTURE_VIEW_NOT_READ');
    expect(()=>futureResultTable(futureAnalysisSchema.parse(make().result.analysis),[],'quality')).toThrow('FUTURE_VIEW_NOT_READ');
  });
  it('readbacks actual XLSX/CSV/SVG with shared IDs, original percentages, future identities and all sources',async()=>{
    const {raw,result}=make('quality');const book=XLSX.read(await buildXlsx(result),{type:'array'});
    expect(XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['查询说明'],{header:1}).filter(r=>r[0]==='回答').map(r=>r[1])).toEqual(resultSummary(resultViewSchema.parse(result)));
    expect(book.SheetNames).toEqual(expect.arrayContaining(['数据','未来目录','预计时间精度','未来填报覆盖','未来季度记录','未来人员任务','未来填报质量','来源','精确值与来源','口径与快照']));
    const rows=XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['未来填报质量'],{header:1}),i=rows[2].findIndex(c=>String(c).startsWith('填报空置率'));
    expect(rows[0]).toEqual(['result_id',result.resultId]);expect(rows[3][i]).toBe(0.5);expect(rows[5][i]).toBe('未记录');
    const csv=buildCsvPackage(result),manifest=JSON.parse(csv.manifest);expect(manifest.sources).toEqual(result.sources);expect(manifest.resultId).toBe(result.resultId);
    const chart=buildResultChart(resultViewSchema.parse(result),{kind:'bar',field:'vacancy_rate'});expect(chart.points[0].y).toBe(0.5);expect(renderChartSvg(chart)).toContain(result.resultId);
    raw.submissions[0].values.vacancy_rate='99';expect(result.table.rows[0].cells.vacancy_rate).toMatchObject({kind:'number',value:{numeric:0.5}});expect(Object.isFrozen(result)).toBe(true);
  });
  it('does not create personnel or quality data sheets from catalog-only or progress-only snapshots',async()=>{
    for(const v of ['catalog','summary'] as const){const result=make(v).result,book=XLSX.read(await buildXlsx(result),{type:'array'});expect(book.SheetNames).not.toContain('未来填报质量');
      expect(result.sources.some(s=>s.field==='asking_rent')).toBe(false);if(v==='catalog'){expect(book.SheetNames).not.toContain('未来人员任务');expect(result.sources.every(s=>s.table==='future_supplies')).toBe(true);}}
  });
  it('exports complete source IDs for more than 1000 future records without Excel cell truncation',async()=>{
    const {raw,selection}=make();raw.assignments=[];raw.submissions=[];raw.supplies=Array.from({length:1205},(_,i)=>({...raw.supplies[0],id:id(i+1000),name:`未来合成${i}`}));raw.expected={supplies:1205,assignments:0,submissions:0};
    const result=buildFutureResult(raw,selection,authority,raw.requestId),book=XLSX.read(await buildXlsx(result),{type:'array'}),rows=XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['精确值与来源'],{header:1});
    const target=result.table.rows.find(r=>r.cells.count.kind==='number'&&r.cells.count.value.numeric===1205)!;
    const refs=rows.slice(1).filter(r=>r[0]===target.entityId&&r[1]==='count').map(r=>String(r[5])).join(';').split(';').filter(Boolean);
    expect(new Set(refs)).toEqual(new Set(target.cells.count.sourceIds));expect(refs.length).toBe(target.cells.count.sourceIds.length);
  });
  it('keeps zero inventory and zero task denominator distinct from missing facts',()=>{
    const {raw,selection}=make();raw.supplies=[];raw.assignments=[];raw.submissions=[];raw.expected={supplies:0,assignments:0,submissions:0};
    const result=buildFutureResult(raw,selection,authority,raw.requestId);expect(result.table.rows.map(r=>r.cells.count)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'number',value:{numeric:0,exact:{numerator:'0',denominator:'1'}}})]));
    expect(resultSummary(resultViewSchema.parse(result)).join(' ')).toContain('提交覆盖率 未知');
  });
});
