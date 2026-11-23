import { describe, expect, it } from 'vitest';
import { createDefaultFilterState, filterFutureSupplies } from '../mapDomain';
import type { NumericCondition } from '@/src/components/SidebarFilter';

const base = {id:'future',name:'未来楼',district:'朝阳区',submarket:'CBD',grade:'A',launch_year:2027,owner:'示例业主',property_management:'Example Property',total_area:50000};
const condition = (field:NumericCondition['field'],value:NumericCondition['value'],operator:NumericCondition['operator']='>='):NumericCondition => ({id:field,field,value,operator});
const run = (rows:Record<string,unknown>[],conditions:NumericCondition[]) => filterFutureSupplies(rows,{...createDefaultFilterState(),numericFilters:conditions},'');

describe('future supply multiple conditions',()=>{
  it('applies case-insensitive owner and property includes, together as AND',()=>{
    expect(run([base,{...base,id:'other',owner:'其他业主'},{...base,id:'no-property',property_management:null}],[condition('owner',' 示例 '),condition('property_management','property')]).map(x=>x.id)).toEqual(['future']);
  });
  it.each(['total_area','net_effective_rent','vacancy_rate','vacant_area','management_fee'] as const)('missing %s is not a zero and does not match <= or = zero',field=>{
    const rows=[undefined,null,'','  ',Number.NaN,Infinity].map((value,i)=>({...base,id:String(i),[field]:value}));
    expect(run(rows,[condition(field,0,'<=')])).toEqual([]);
    expect(run(rows,[condition(field,0,'=')])).toEqual([]);
    expect(run([{...base,[field]:0}],[condition(field,0,'=')])).toEqual([{...base,[field]:0}]);
  });
  it.each([['>=',50000,true],['>',50000,false],['<=',50000,true],['<',50000,false],['=',50000,true],['>',49000,true],['<',51000,true]] as const)('uses planned total area with %s %s', (operator,value,matches)=>{
    expect(run([base],[condition('total_area',value,operator)]).length).toBe(matches?1:0);
  });
  it('preserves the percentage unit and does not borrow stock metrics',()=>{
    const supply={...base,vacancy_rate:0.125,metrics:[{net_effective_rent:200}]};
    expect(run([supply],[condition('vacancy_rate',12.5,'=')])).toEqual([supply]);
    expect(run([supply],[condition('net_effective_rent',0,'>=')])).toEqual([]);
  });
  it('ignores unfinished blank conditions but intersects complete conditions with other filters',()=>{
    const rows=[base,{...base,id:'pending',status:'pending',owner:null,property_management:null}];
    expect(run(rows,[condition('net_effective_rent','')])).toEqual(rows);
    expect(run(rows,[condition('owner','示例'),condition('total_area',60000)])).toEqual([]);
    const state={...createDefaultFilterState(),futureSupplyGrades:['pending'],numericFilters:[condition('owner','示例')]};
    expect(filterFutureSupplies(rows,state,'')).toEqual([]);
  });
});
