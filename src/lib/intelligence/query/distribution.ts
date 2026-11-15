import { z } from 'zod';
import { Decimal } from './decimal';
import { aggregateQuarter } from './analytics';
import { assertComplete, type FactSnapshot, type NumericOutput } from './contracts';
import { assertFieldContext, getFact } from './facts';
import { numericFields, type NumericField } from './registry';

export const distributionMeasureSchema = z.enum(['height','floors','parking','totalArea','vacantArea','rent','vacancy']);
export type DistributionMeasure = z.infer<typeof distributionMeasureSchema>;
export function distributionFields(measure: DistributionMeasure): readonly NumericField[] {
  return measure === 'rent' ? ['totalArea','netEffectiveRent'] : measure === 'vacancy' ? ['totalArea','vacantArea'] : [measure];
}
export function distributionUnit(measure: DistributionMeasure): string { return measure === 'rent' ? 'CNY/m2/month' : measure === 'vacancy' ? 'ratio' : numericFields[measure].unit; }
export function distributionLabel(measure: DistributionMeasure): string { return measure === 'rent' ? '净有效租金' : measure === 'vacancy' ? '楼宇空置率' : numericFields[measure].label; }
const out = (value: Decimal): NumericOutput => {
  const exact=value.exact(),negative=exact.numerator.startsWith('-'),n=exact.numerator.replace('-',''),d=exact.denominator;
  // Project a ratio without Infinity/Infinity for large exact denominators.
  // Only the chart projection uses this; all statistics use the full fraction.
  const a=n.slice(0,17),b=d.slice(0,17),numeric=(negative?-1:1)*Number(a)/Number(b)*10**(n.length-a.length-d.length+b.length);
  if(!Number.isFinite(numeric))throw new Error('NUMERIC_PROJECTION_OVERFLOW');
  return {exact,numeric};
};
const from = (value: NumericOutput) => Decimal.fraction(BigInt(value.exact.numerator),BigInt(value.exact.denominator));
const numeric = z.object({exact:z.object({numerator:z.string().regex(/^-?\d{1,5000}$/),denominator:z.string().regex(/^[1-9]\d{0,4999}$/)}),numeric:z.number().finite()});
export const distributionStatLabels = {min:'最小值',p05:'P05',q1:'P25',median:'中位数（P50）',q3:'P75',p95:'P95',max:'最大值',mean:'简单平均（逐楼等权）',lowerFence:'下围栏（Q1−1.5×IQR）',upperFence:'上围栏（Q3+1.5×IQR）',lowerWhisker:'下须线（实际记录）',upperWhisker:'上须线（实际记录）'} as const;
const statsSchema = z.object({min:numeric,p05:numeric,q1:numeric,median:numeric,q3:numeric,p95:numeric,max:numeric,mean:numeric,lowerFence:numeric,upperFence:numeric,lowerWhisker:numeric,upperWhisker:numeric});
export const distributionAnalysisSchema = z.object({version:z.literal('building-distribution-type7/1'),measure:distributionMeasureSchema,unit:z.string(),
  coverage:z.object({total:z.number().int().nonnegative(),valid:z.number().int().nonnegative(),missing:z.number().int().nonnegative(),invalid:z.number().int().nonnegative(),conflict:z.number().int().nonnegative(),unverified:z.number().int().nonnegative()}),
  observations:z.array(z.object({entityId:z.string(),name:z.string(),value:numeric.nullable(),state:z.enum(['valid','missing','invalid','conflict','unverified']),reason:z.string().nullable(),sourceIds:z.array(z.string()),bin:z.number().int().nonnegative().nullable(),outlier:z.boolean().nullable()})),
  stats:statsSchema.nullable(),outlierAssessment:z.enum(['iqr_1_5','insufficient_sample']),binRule:z.literal('sturges_equal_width_capped_20'),
  bins:z.array(z.object({id:z.string(),lower:numeric,upper:numeric,upperInclusive:z.boolean(),count:z.number().int().nonnegative(),entityIds:z.array(z.string()),sourceIds:z.array(z.string())})).max(20),
});
export type DistributionAnalysis = z.infer<typeof distributionAnalysisSchema>;

/** Type 7: h=(n−1)p, linear interpolation of exact, sorted observations.
 * Each building is equally weighted; no outlier removal or display pagination. */
export function buildingDistribution(snapshot: FactSnapshot, measure: DistributionMeasure): DistributionAnalysis {
  distributionMeasureSchema.parse(measure);assertComplete(snapshot);assertFieldContext(snapshot,distributionFields(measure));
  const coverage={total:snapshot.rows.length,valid:0,missing:0,invalid:0,conflict:0,unverified:0};
  const observations:DistributionAnalysis['observations']=snapshot.rows.map(row=>{
    if(measure==='rent'||measure==='vacancy'){
      const a=aggregateQuarter({...snapshot,rows:[row],expectedCount:1},measure),excluded=a.excluded[0];
      const state=a.value?'valid':excluded?.state??'missing';coverage[state]++;
      return {entityId:row.id,name:row.name,value:a.value,state,reason:excluded?.reason??null,sourceIds:[...new Set([...a.contributions.flatMap(c=>c.sourceIds),...a.excluded.flatMap(e=>e.sourceIds)])],bin:null,outlier:null};
    }
    const f=getFact(row,measure);coverage[f.state]++;
    return {entityId:row.id,name:row.name,value:f.state==='valid'?out(f.value):null,state:f.state,reason:f.state==='valid'?null:f.reason,sourceIds:f.sources.map(s=>s.id),bin:null,outlier:null};
  });
  const valid=observations.filter(o=>o.value!==null).sort((a,b)=>from(a.value!).compare(from(b.value!))||a.entityId.localeCompare(b.entityId));
  const values=valid.map(o=>from(o.value!));let stats:DistributionAnalysis['stats']=null;const bins:DistributionAnalysis['bins']=[];
  if(values.length){
    const n=values.length;
    const quantile=(percent:number)=>{const numerator=(n-1)*percent,index=Math.floor(numerator/100),fraction=Decimal.fraction(BigInt(numerator%100),BigInt(100));return values[index].add((values[Math.min(index+1,n-1)].subtract(values[index])).multiply(fraction));};
    const min=values[0],max=values[n-1],q1=quantile(25),median=quantile(50),q3=quantile(75),iqr=q3.subtract(q1),distance=iqr.multiply(Decimal.parse('1.5')!);
    const lowerFence=q1.subtract(distance),upperFence=q3.add(distance);
    valid.forEach((o,i)=>{o.outlier=n<4?null:values[i].compare(lowerFence)<0||values[i].compare(upperFence)>0;});
    const inside=values.filter((_,i)=>valid[i].outlier!==true);
    const sum=values.reduce((a,b)=>{const next=a.add(b);if(next.numerator.toString(2).length>16384||next.denominator.toString(2).length>16384)throw new Error('QUERY_SCOPE_REQUIRES_BACKGROUND_JOB');return next;},Decimal.zero());
    stats={min:out(min),p05:out(quantile(5)),q1:out(q1),median:out(median),q3:out(q3),p95:out(quantile(95)),max:out(max),mean:out(sum.divide(Decimal.parse(n)!)),lowerFence:out(lowerFence),upperFence:out(upperFence),lowerWhisker:out(inside[0]),upperWhisker:out(inside[inside.length-1])};
    const count=min.compare(max)===0?1:Math.min(20,Math.ceil(Math.log2(n)+1));const width=max.subtract(min).divide(Decimal.parse(count)!);
    for(let i=0;i<count;i++)bins.push({id:`bin/${i}`,lower:out(min.add(width.multiply(Decimal.parse(i)!))),upper:out(i===count-1?max:min.add(width.multiply(Decimal.parse(i+1)!))),upperInclusive:i===count-1,count:0,entityIds:[],sourceIds:[]});
    valid.forEach(o=>{const v=from(o.value!);const index=bins.findIndex(b=>v.compare(from(b.lower))>=0&&(v.compare(from(b.upper))<0||b.upperInclusive&&v.compare(from(b.upper))===0));if(index<0)throw new Error('DISTRIBUTION_BIN_INVARIANT');o.bin=index;bins[index].count++;bins[index].entityIds.push(o.entityId);bins[index].sourceIds.push(...o.sourceIds);});
    bins.forEach(b=>{b.sourceIds=[...new Set(b.sourceIds)];});
  }
  return {version:'building-distribution-type7/1',measure,unit:distributionUnit(measure),coverage,observations,stats,outlierAssessment:valid.length<4?'insufficient_sample':'iqr_1_5',binRule:'sturges_equal_width_capped_20',bins};
}
