import {z} from 'zod';
import {Decimal} from '../decimal';
import type {FutureAnalysis} from './view';

const count=z.number().int().nonnegative();
const number=z.object({numeric:z.number().finite(),exact:z.object({numerator:z.string().regex(/^\d{1,400}$/),denominator:z.string().regex(/^[1-9]\d{0,399}$/)})});
const coverage={records:count,valid:count,missing:count,invalid:count,knownArea:number.nullable()};
export const supplyOverviewSchema=z.strictObject({version:z.literal('future-supply-summary/1'),...coverage,
  sharedIdentityRecords:count,unlinkedRecords:count,
  groups:z.array(z.strictObject({id:z.string(),label:z.string(),classification:z.enum(['future_record','pending','status_unknown']),
    memberIds:z.array(z.uuid()),sourceIds:z.array(z.string()),...coverage})).max(20000),
});
export type SupplyOverview=z.infer<typeof supplyOverviewSchema>;
export const futureClassificationText=(value:FutureAnalysis['rows'][number]['classification'])=>value==='future_record'?'未来记录（数据库分类）':value==='pending'?'待核实':'分类未知';

const intervalLabel=(r:FutureAnalysis['rows'][number])=>{
  const q=r.launch.start;if(!q)return r.launch.state==='invalid'?'预计时间无效':'预计时间未知';
  return r.launch.state==='quarter'?`${q.year}Q${q.quarter}`:r.launch.state==='half_year'?`${q.year}年${q.quarter===1?'上':'下'}半年`:`${q.year}年`;
};

/** Disjoint recorded intervals, never a quarterly allocation or deduplicated market inventory. */
export function summarizeFutureSupply(rows:FutureAnalysis['rows']):SupplyOverview{
  const summarize=(members:FutureAnalysis['rows'])=>{
    const valid=members.filter(r=>r.area.state==='valid'&&r.area.value!==null);
    const sum=valid.reduce((n,r)=>n.add(Decimal.fraction(BigInt(r.area.value!.exact.numerator),BigInt(r.area.value!.exact.denominator))),Decimal.zero());
    return {records:members.length,valid:valid.length,missing:members.filter(r=>r.area.state==='missing').length,
      invalid:members.filter(r=>r.area.state==='invalid').length,knownArea:valid.length?{exact:sum.exact(),numeric:sum.toNumber()}:null};
  };
  const groups=new Map<string,FutureAnalysis['rows']>(),identities=new Map<string,number>();
  for(const r of rows){
    const key=[r.launch.start?.year??'unknown',r.launch.start?.quarter??0,r.launch.end?.quarter??0,r.launch.state,r.classification].join('/');
    const group=groups.get(key)??[];group.push(r);groups.set(key,group);
    if(r.buildingId)identities.set(r.buildingId,(identities.get(r.buildingId)??0)+1);
  }
  return supplyOverviewSchema.parse({version:'future-supply-summary/1',...summarize(rows),
    sharedIdentityRecords:rows.filter(r=>r.buildingId&&(identities.get(r.buildingId)??0)>1).length,
    unlinkedRecords:rows.filter(r=>!r.buildingId).length,
    groups:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([id,members])=>({id:`future-supply/${id}`,
      label:`${intervalLabel(members[0])} · ${members[0].classification==='future_record'?'未来记录':futureClassificationText(members[0].classification)}`,classification:members[0].classification,
      memberIds:members.map(r=>r.futureId).sort(),sourceIds:[...new Set(members.flatMap(r=>[r.fieldSources.name,r.fieldSources.building_id,r.fieldSources.status,r.fieldSources.launch_year,r.fieldSources.launch_quarter,...r.area.sourceIds]))].sort(),
      ...summarize(members)})),
  });
}
