import {buildLeaseAnalytics} from './analytics';
import { createHash, randomUUID } from 'node:crypto';
import type { QueryResult, ResultCell, ResultTable } from '../result';
import { FIELD_REGISTRY_VERSION } from '../registry';
import { formatExact } from '../format';
import { analyzeLeaseSnapshot } from './analyze';
import { normalizeLeaseRead, type LeaseAuthority } from './reader';
import { leaseSelectionSchema, leaseReadFromScope, validateLeaseSelection, leaseSourceLabel, leaseNatureLabel, isLeaseGroup, type LeaseSelection, type LeaseView } from './view';
export type LeaseAnalysis = Omit<ReturnType<typeof analyzeLeaseSnapshot>, 'sources'>;
const text = (value: string, sourceIds: readonly string[]): ResultCell => ({kind:'text',value,sourceIds});
const count = (value: number, sourceIds: readonly string[]): ResultCell => ({kind:'number',value:{numeric:value,exact:{numerator:String(value),denominator:'1'}},sourceIds});
const unknown = (sourceIds: readonly string[], reason='no_valid_sample'): ResultCell => ({kind:'unknown',state:'missing',reason,sourceIds});
const fields = {area_sqm:['成交面积','m2'],face_rent:['表面成交租金','CNY/m2/month'],effective_rent:['有效成交租金','CNY/m2/month'],lease_term_months:['记录租期','month'],industry:['行业',null],sub_industry:['子行业',null],demand_type:['需求类型',null]} as const;
const periodText = (r: LeaseAnalysis['rows'][number]) => r.period.state==='date'?r.period.start!:r.period.state==='quarter'?`${r.period.start!.slice(0,4)}Q${Math.ceil(Number(r.period.start!.slice(5,7))/3)}`:r.period.state==='year'?`${r.period.start!.slice(0,4)}年（季度未知）`:r.period.state==='conflict'?'未知：期间冲突':r.period.state==='invalid'?'未知：期间无效':'未知：未记录期间';
export function leaseResultTable(a: LeaseAnalysis, view: LeaseView): ResultTable {
  const allRefs = (source: string) => a.rows.filter(r=>r.source===source).flatMap(r=>r.sourceIds);
  if(view==='summary')return {id:'lease_source_summary',columns:[{key:'name',label:'记录来源',unit:null},{key:'count',label:'原始记录数',unit:'record_count'},
    {key:'valid',label:'面积有效记录',unit:'record_count'},{key:'missing',label:'面积缺失记录',unit:'record_count'},{key:'invalid',label:'面积无效记录',unit:'record_count'},{key:'area',label:'已知成交面积合计',unit:'m2'}],
    rows:a.summaries.map(s=>{const refs=allRefs(s.source);return {entityId:s.source,cells:{name:text(leaseSourceLabel[s.source],refs),count:count(s.records,refs),valid:count(s.area!.valid,refs),missing:count(s.area!.missing,refs),invalid:count(s.area!.invalid,refs),area:s.area!.sum?{kind:'number',value:s.area!.sum,sourceIds:refs}:unknown(refs)}};})};
  if(view==='face_rent'||view==='effective_rent')return {id:'lease_weighted_rent',columns:[{key:'name',label:'来源与租金性质',unit:null},{key:'count',label:'原始记录数',unit:'record_count'},
    {key:'paired',label:'租金与正面积均有效',unit:'record_count'},{key:'denominator',label:'配对面积分母',unit:'m2'},{key:'rent',label:fields[view][0]+'（面积加权）',unit:'CNY/m2/month'}],
    rows:a.summaries.flatMap(s=>s.rents[view].map(g=>{const refs=allRefs(s.source);return {entityId:`${s.source}/${g.nature}`,cells:{name:text(`${leaseSourceLabel[s.source]} · ${leaseNatureLabel[g.nature as keyof typeof leaseNatureLabel]}`,refs),count:count(g.records,refs),paired:count(g.pairedRecords,refs),denominator:{kind:'number' as const,value:{exact:g.denominator,numeric:Number(g.denominator.numerator)/Number(g.denominator.denominator)},sourceIds:refs},rent:g.weightedRent?{kind:'number' as const,value:g.weightedRent,sourceIds:refs}:unknown(refs)}};}))};
  if(view!=='catalog')throw new Error('LEASE_CATALOG_VIEW_REQUIRED');
  const selected = a.fields.filter(f=>f!=='source_evidence') as (keyof typeof fields)[];
  const columns:ResultTable['columns']=[{key:'name',label:'企业（原记录名称）',unit:null},{key:'source',label:'记录来源',unit:null},{key:'building',label:'成交楼宇或项目',unit:null},{key:'scope',label:'楼宇匹配范围',unit:null},{key:'period',label:'原记录成交期间',unit:null},...selected.map(f=>({key:f,label:fields[f][0],unit:fields[f][1]})),
    ...a.fields.filter(f=>f==='face_rent'||f==='effective_rent').map(f=>({key:f+'_nature',label:fields[f][0]+'性质',unit:null})),...(a.fields.includes('source_evidence')?[{key:'evidence',label:'原文件定位文字（未关联原件版本）',unit:null}]:[])];
  return {id:'lease_records',columns,rows:a.rows.map(r=>{
    const cells:Record<string,ResultCell>={name:r.company?text(r.company,[r.fieldSources.company]):unknown([r.fieldSources.company],'company_missing'),source:text(leaseSourceLabel[r.source],r.sourceIds),building:r.building.name?text(r.building.name,[r.fieldSources.new_building]):unknown([r.fieldSources.new_building]),scope:text({exact:'楼座',reference:'历史参考',project:'项目整体',unmapped:'未映射'}[r.building.scope],[r.fieldSources.building_match_scope,r.fieldSources.related_building_ids]),period:text(periodText(r),[r.fieldSources.transaction_date,r.fieldSources.transaction_year,r.fieldSources.transaction_quarter])};
    for(const f of selected){const n=r.numbers[f],refs=[r.fieldSources[f]];cells[f]=n?(n.value?{kind:'number',value:n.value,sourceIds:refs}:{kind:'unknown',state:n.state==='invalid'?'invalid':'missing',reason:'lease_value_unavailable',sourceIds:refs}):r.values[f]!==null?text(r.values[f],refs):unknown(refs);}
    for(const f of ['face_rent','effective_rent'])if(a.fields.includes(f as 'face_rent'|'effective_rent')){const n=r.rentNature[f];cells[f+'_nature']=text(leaseNatureLabel[n.state as keyof typeof leaseNatureLabel],n.sourceIds);}
    if(a.fields.includes('source_evidence'))cells.evidence=r.evidence?text([r.evidence.file??'文件未知',r.evidence.sheet??'工作表未知',r.evidence.row===null?'行号未知':`第${r.evidence.row}行`].join(' / '),['source_file','source_sheet','source_row'].map(k=>r.fieldSources[k])):unknown(r.sourceIds,'original_not_linked');
    return {entityId:r.recordId,cells};
  })};
}
export function buildLeaseResult(raw: unknown, input: LeaseSelection, authority: LeaseAuthority, requestId: string): QueryResult {
  const parsed=leaseSelectionSchema.parse(input),selection={view:parsed.view,period:parsed.period,read:leaseReadFromScope({...parsed.read,inventory:'leases'}),...(parsed.range?{range:parsed.range}:{})};validateLeaseSelection(selection);
  const snapshot=normalizeLeaseRead(raw,selection.read,authority,requestId),full=analyzeLeaseSnapshot(snapshot);
  const coverage={candidates:full.rows.length,selected:0,possible:0,outside:0,unknown:0,invalid:0,conflict:0};
  const first=selection.range?.start??selection.period,last=selection.range?.end??selection.period;
  const start=first?`${first.year}-${String(first.quarter*3-2).padStart(2,'0')}-01`:null;
  const end=last?new Date(Date.UTC(last.year,last.quarter*3,0)).toISOString().slice(0,10):null;
  const periodLabel=first?`${first.year}Q${first.quarter}${selection.range?` 至 ${last!.year}Q${last!.quarter}`:''}`:'全部原期间';
  const decisions=full.rows.map(r=>{const p=r.period;const state=!start?'selected':p.state==='unknown'||p.state==='invalid'||p.state==='conflict'?p.state:p.start!>=start&&p.end!<=end!&&!(selection.view==='quarter_trend'&&p.state==='year')?'selected':p.end!<start||p.start!>end!?'outside':'possible';coverage[state]++;return {recordId:r.recordId,state,sourceIds:[r.fieldSources.transaction_date,r.fieldSources.transaction_year,r.fieldSources.transaction_quarter]};});
  const selectedIds=new Set(decisions.filter(d=>d.state==='selected').map(d=>d.recordId)),records=snapshot.records.filter(r=>selectedIds.has(r.id));
  const {sources:_selectedSources,...analysis}=analyzeLeaseSnapshot({...snapshot,records,expected:records.length,uniqueIds:records.length,uniqueSources:records.length});
  void _selectedSources;
  const grouped=isLeaseGroup(selection.view)||selection.view==='quarter_trend'?buildLeaseAnalytics(analysis,selection):null;
  const table=grouped?.table??leaseResultTable(analysis,selection.view);
  const paragraphs=[`本次获权候选 ${coverage.candidates} 条，纳入 ${coverage.selected} 条原始成交记录。日常与历史分别统计，不能视为跨来源去重后的独立成交笔数。`,
    ...(start?[`按明确落入 ${periodLabel} 的原成交期间纳入；仅可能涉及 ${coverage.possible} 条、期间未知 ${coverage.unknown} 条、无效 ${coverage.invalid} 条、冲突 ${coverage.conflict} 条、范围外 ${coverage.outside} 条。年份记录不猜测为某一季度。`]:['按获权记录全部原期间查询；成交日期、季度和年份保留原精度，不代表起租或到期日。']),
    ...analysis.summaries.map(s=>`${leaseSourceLabel[s.source]} ${s.records} 条${s.area?`；已知有效成交面积${s.area.sum?`合计 ${formatExact(s.area.sum,'m2')} ㎡`:'未知（无有效面积）'}，有效 ${s.area.valid}、缺失 ${s.area.missing}、无效 ${s.area.invalid} 条`:''}。`),
    ...(selection.view==='face_rent'||selection.view==='effective_rent'?analysis.summaries.map(s=>{
      const field=selection.view as 'face_rent'|'effective_rent';
      const groups=s.rents[field].filter(g=>g.records>0);
      return `${leaseSourceLabel[s.source]}${fields[field][0]}：${groups.length?groups.map(g=>`${leaseNatureLabel[g.nature as keyof typeof leaseNatureLabel]}${g.weightedRent?`面积加权 ${formatExact(g.weightedRent,'CNY/m2/month')} 元/㎡/月`:'未知（无有效配对样本）'}，有效配对 ${g.pairedRecords} 条`).join('；'):'未知（无入选记录）'}。租金仅按同来源、同估算类别的有效租金与正面积配对计算，面积分母见表。`;
    }):[]),
    ...(grouped?.paragraphs??[]),
    ...(records.length===0?['当前授权范围没有符合明确期间条件的记录；不能据此断言现实市场没有成交。']:[])];
  const result:QueryResult={resultId:randomUUID(),createdAt:new Date().toISOString(),snapshotId:snapshot.snapshotId,dataVersion:full.dataVersion,registryVersion:FIELD_REGISTRY_VERSION,
    scopeFingerprint:createHash('sha256').update(JSON.stringify([authority.actorId,authority.permissionRevision,selection])).digest('hex'),operation:'lease_observation',parameters:{view:selection.view,period:selection.period,...(selection.range?{range:selection.range}:{}),...(grouped?{leaseAnalytics:grouped.details}:{}),scope:{inventory:'leases',...selection.read},coverage,decisions,answer:{paragraphs}},analysis,table,sources:full.sources,limitations:full.limitations};
  const freeze=(v:unknown)=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}};freeze(result);return result;
}
