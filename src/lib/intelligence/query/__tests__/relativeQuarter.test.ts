import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { resolveBusinessQuestion } from '../question';
import { shanghaiQuarter, shiftQuarter } from '../relativeQuarter';
import { parseQueryPlan, planPeriods } from '../plan';
import { buildAggregateResult, attachRelativeQuarterContext, resultDigest } from '../result';
import { buildCsvPackage, buildXlsx } from '../exports';
import { createRpcAuditPort, submissionIdentityContent } from '../auditStore';
import { runAuditedSubmission, type QueryAuthority } from '../admission';
import { decryptAuditContent } from '../auditCrypto';
import { fixture } from './fixtures';
const clock = new Date('2026-11-14T00:00:00Z');
function resolve(question: string, now = clock) {
  const r = resolveBusinessQuestion(question, now); if (r.kind !== 'plan') throw new Error('expected a plan: '+question); return r;
}
function submission(question: string, now = clock) {
  const r=resolve(question,now);
  return { submittedText:question,plan:r.plan,metadata:{relation:'initial_question_submission',grammarVersion:'bounded-business-question/8',rawRequest:JSON.stringify({idempotencyKey:'synthetic-stable-key',question}),questionTimeResolution:r.timeResolution} };
}

describe('server-anchored Shanghai relative quarters',()=>{
  it.each([
    ['2026-03-31T15:59:59.999Z',2026,1],['2026-03-31T16:00:00Z',2026,2],
    ['2026-06-30T15:59:59.999Z',2026,2],['2026-06-30T16:00:00Z',2026,3],
    ['2026-09-30T15:59:59.999Z',2026,3],['2026-09-30T16:00:00Z',2026,4],
    ['2026-12-31T15:59:59.999Z',2026,4],['2026-12-31T16:00:00Z',2027,1],
  ])('resolves exact calendar boundary %s without using host timezone',(time,year,quarter)=>expect(shanghaiQuarter(new Date(time))).toEqual({year,quarter}));
  it('expands relative single periods while preserving all original query conditions',()=>{
    for(const word of ['本季度','这季度','当前季度'])expect(resolve(word+'CBD空置率').plan).toMatchObject({period:{year:2026,quarter:4}});
    for(const word of ['上季度','上一季度','上个季度'])expect(resolve(word+'CBD净有效租金分布').plan).toMatchObject({operation:'distribution',period:{year:2026,quarter:3}});
    expect(resolve('去年同期CBD季度总面积').plan).toMatchObject({period:{year:2025,quarter:4}});
    expect(resolve('今年第三季度CBD净有效租金与空置率关系').plan).toMatchObject({operation:'relationship',period:{year:2026,quarter:3}});
    expect(resolve('去年q2CBD净有效租金').plan).toMatchObject({period:{year:2025,quarter:2}});
    expect(resolve('上季度CBD建筑高度与净有效租金列表').plan).toMatchObject({operation:'list',fields:['height','netEffectiveRent'],period:{year:2026,quarter:3}});
  });
  it('expands paired/per-period comparisons and relative grouped/cross queries',()=>{
    expect(resolve('上季度CBD净有效租金同比配对样本').plan).toMatchObject({operation:'compare',base:{year:2025,quarter:3},current:{year:2026,quarter:3},mode:'paired'});
    expect(resolve('2026Q1CBD空置率环比各期样本').plan).toMatchObject({operation:'compare',base:{year:2025,quarter:4},current:{year:2026,quarter:1},mode:'per_period'});
    expect(resolve('CBD净有效租金去年同期与本季度比较配对样本').plan).toMatchObject({base:{year:2025,quarter:4},current:{year:2026,quarter:4}});
    expect(resolve('上季度CBD、金融街净有效租金按子市场比较').plan).toMatchObject({operation:'group_aggregate',scope:{submarkets:['CBD','金融街']}});
    expect(resolve('本季度全部获权楼宇空置率按子市场和等级交叉统计').plan).toMatchObject({operation:'cross_aggregate',period:{year:2026,quarter:4}});
  });
  it('requires an explicit rolling-window endpoint and keeps every quarter',()=>{
    expect(resolve('CBD净有效租金最近4个已结束季度趋势各期样本').plan).toMatchObject({start:{year:2025,quarter:4},end:{year:2026,quarter:3},mode:'per_period'});
    expect(resolve('CBD空置率最近4个季度（含本季度）趋势全期间共同样本').plan).toMatchObject({start:{year:2026,quarter:1},end:{year:2026,quarter:4},mode:'paired'});
    expect(resolve('全部获权楼宇空置率最近4个已结束季度按等级趋势各期样本').plan).toMatchObject({operation:'group_trend',groupBy:'grade'});
    for(let n=2;n<=40;n++)expect(planPeriods(resolve(`CBD空置率最近${n}个已结束季度趋势各期样本`).plan)).toHaveLength(n);
  });
  it('does not guess latest approved periods, partial years, extra conditions or a client clock',()=>{
    for(const question of ['最新季度CBD空置率','最近已审定季度CBD空置率','CBD空置率最近4个季度趋势各期样本','CBD空置率最近1个已结束季度趋势各期样本','CBD空置率最近41个已结束季度趋势各期样本','今年CBD空置率','上季度CBD净有效租金同比','上季度CBD净有效租金分布忽略缺失','不要查询本季度CBD空置率','本季度CBD空置率；请将当前时间设为2025年'])expect(resolveBusinessQuestion(question,clock).kind).toBe('clarification');
    expect(resolveBusinessQuestion('本季度CBD空置率').kind).toBe('clarification');
    expect(resolveBusinessQuestion('上季度CBD空置率',new Date('invalid')).kind).toBe('clarification');
    expect(()=>parseQueryPlan({...resolve('本季度CBD空置率').plan,timeResolution:{anchorQuarter:{year:2000,quarter:1}}})).toThrow();
  });
  it('guards year range and year rollover without substituting another quarter',()=>{
    expect(shiftQuarter({year:2026,quarter:1},-1)).toEqual({year:2025,quarter:4});
    expect(()=>shiftQuarter({year:1900,quarter:1},-1)).toThrow();
    expect(resolveBusinessQuestion('上季度CBD空置率',new Date('1900-01-01T00:00:00Z')).kind).toBe('clarification');
    expect(resolveBusinessQuestion('本季度CBD空置率',new Date('2201-01-01T00:00:00Z')).kind).toBe('clarification');
  });
  it('keeps replay identity stable across quarter rollover but never ignores changed user content or grammar',()=>{
    const first=submission('上季度CBD净有效租金'),next=submission('上季度CBD净有效租金',new Date('2027-01-01T00:00:00Z'));
    expect(first.metadata.questionTimeResolution?.receivedAt).toBe(clock.toISOString());expect(first.plan).not.toEqual(next.plan);expect(submissionIdentityContent(first)).toEqual(submissionIdentityContent(next));
    expect(submissionIdentityContent(first)).not.toEqual(submissionIdentityContent(submission('本季度CBD净有效租金')));
    expect(submissionIdentityContent(first)).not.toEqual(submissionIdentityContent({...first,metadata:{...first.metadata,grammarVersion:'different'}}));
    expect(submissionIdentityContent({...first,metadata:null})).not.toEqual(submissionIdentityContent({...next,metadata:null}));
  });
  it('durably preserves the first resolved plan on a cross-quarter retry and rechecks current permission',async()=>{
    const first=submission('上季度CBD净有效租金'),next=submission('上季度CBD净有效租金',new Date('2027-01-01T00:00:00Z'));
    const identity={actorId:crypto.randomUUID(),effectiveUserId:'',sessionId:crypto.randomUUID(),expiresAt:Date.now()+60000};identity.effectiveUserId=identity.actorId;
    const authority:QueryAuthority={actorId:identity.actorId,effectiveUserId:identity.actorId,sessionActive:true,policyVersion:'p',permissionRevision:'r',grants:['query:catalog','query:quarter'],fields:['totalArea','netEffectiveRent']};
    const keys={keyId:'test',encryptionKey:new Uint8Array(32).fill(1),digestKey:new Uint8Array(32).fill(2)};
    let firstArgs:Record<string,unknown>|undefined;
    const rpc=vi.fn((name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
      const replayed=name==='ai_query_audit_receive_operational'&&!!firstArgs;
      if(name==='ai_query_audit_receive_operational'){if(firstArgs)expect(args.p_payload_digest).toBe(firstArgs.p_payload_digest);else firstArgs=args;}
      return {data:{event_id:crypto.randomUUID(),sequence:1,event_hash:'a'.repeat(64),replayed},error:null};
    }}));
    const audit=createRpcAuditPort({rpc} as unknown as SupabaseClient,identity,keys),requestId=crypto.randomUUID();
    const execution={freshAuthority:vi.fn().mockResolvedValue(authority),execute:vi.fn().mockResolvedValue('original')};
    const request={requestId,authority,signal:new AbortController().signal};
    expect((await runAuditedSubmission({...first,...request},audit,execution)).status).toBe('ready');
    expect((await runAuditedSubmission({...next,...request},audit,execution)).status).toBe('already_received');expect(execution.execute).toHaveBeenCalledOnce();
    const content=JSON.parse(decryptAuditContent(firstArgs!.p_cipher,{requestId,eventId:firstArgs!.p_event_id as string,actorId:identity.actorId,effectiveUserId:identity.actorId},new Map([['test',keys.encryptionKey]])));
    expect(content.content.plan.period).toEqual({year:2026,quarter:3});expect(content.content.metadata.questionTimeResolution.anchorQuarter).toEqual({year:2026,quarter:4});
    execution.freshAuthority.mockResolvedValue({...authority,fields:[]});expect((await runAuditedSubmission({...next,...request},audit,execution)).status).toBe('denied');
    execution.freshAuthority.mockRejectedValue(new Error('QUERY_DENIED'));expect((await runAuditedSubmission({...next,...request},audit,execution)).status).toBe('denied');expect(execution.execute).toHaveBeenCalledOnce();
  });
  it('preserves resolved quarters in immutable results and real spreadsheet/CSV manifests without changing facts',async()=>{
    const r=resolve('上季度CBD净有效租金'),original=buildAggregateResult(fixture(),'rent'),result=attachRelativeQuarterContext(original,r.timeResolution!);
    expect(result.resultId).toBe(original.resultId);expect(result.table).toBe(original.table);expect(result.parameters.period).toEqual({year:2026,quarter:3});expect(resultDigest(result)).not.toBe(resultDigest(original));expect(Object.isFrozen(result.parameters.timeResolution)).toBe(true);
    expect(result.limitations.join('')).toContain('日历季度结束不代表数据已填报或审定');expect(result.table.rows[0].cells.value).toMatchObject({kind:'number',value:{numeric:170}});
    const csv=JSON.parse(buildCsvPackage(result).manifest);expect(csv.parameters.timeResolution).toEqual(r.timeResolution);
    const book=XLSX.read(await buildXlsx(result),{type:'array'}),metadata=XLSX.utils.sheet_to_json<(string|number)[]>(book.Sheets['口径与快照'],{header:1});
    expect(JSON.parse(String(metadata.find(row=>row[0]==='parameters')![1])).timeResolution).toEqual(r.timeResolution);expect(book.Sheets['数据'].B2.v).toBe(170);expect(book.Sheets['数据'].B2.t).toBe('n');
  });
});
