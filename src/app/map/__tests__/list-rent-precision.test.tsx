import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BuildingMetric } from '@/src/types';
import { BuildingBasicCard } from '../components/BuildingBasicCard';
import FloatingBuildingList from '../components/FloatingBuildingList';
import { FullBuildingList } from '../components/FullBuildingList';

beforeEach(()=>vi.stubGlobal('IntersectionObserver',class{observe(){}disconnect(){}}));
afterEach(()=>vi.unstubAllGlobals());
const cases=[{value:100,text:'100.0'},{value:0,text:'0.0'},{value:null,text:'—'},{value:146.16,text:'146.2'}];
it.each(['card','compact','full'] as const)('%s preserves a common one-decimal rent display including zero and missing',view=>{
  const noop=vi.fn();
  for(const {value,text} of cases){
    const building={id:'precision',name:'整数租金项目',submarket:'CBD',grade:'A',location_lng:116.46,location_lat:39.91,metrics:[{is_locked:true,is_draft:false,record_year:2026,record_quarter:3,net_effective_rent:value,vacancy_rate:.1,total_area:80000} as BuildingMetric]};
    const tree=view==='card'?<BuildingBasicCard building={building}/>:view==='compact'?<FloatingBuildingList buildings={[building]} onClose={noop}/>:<FullBuildingList active buildings={[building]} queryKey="precision" activeFilterChips={[]} compareGroupCount={0} requirementContext={false} competitorContext={false} filterState={null} keyword="" loading={false} error={null} filtersOpen={false} displayOverrides={new Map()} targetBuildingId={null} onPatchFilters={noop} onBack={noop} onToggleFilters={noop} onKeywordChange={noop} onSearch={noop} onResetFilters={noop} onRetry={noop} onBuildingClick={noop}/>;
    const rendered=render(tree);
    const label=screen.getByText(/^净有效租金/,{selector:'dt'});
    const result=label.parentElement!.querySelector('dd')!;
    expect(result.textContent).toBe(text+(view==='card'?'元/㎡/月':view==='full'&&value!==null?' 元/㎡/月':''));
    expect(screen.getByText(/80,000/)).toBeVisible();
    rendered.unmount();
  }
});
