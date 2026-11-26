import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FullBuildingList } from '../components/FullBuildingList';

it('marks only the current type and names future area as planning',()=>{
  const noop=vi.fn();
  const {container}=render(<FullBuildingList active buildings={[
    {id:'same',name:'存量同ID',_dataType:'existing'},
    {id:'same',name:'供应同ID',_dataType:'future',total_area:80000},
  ]} queryKey="same" activeFilterChips={[]} compareGroupCount={0} requirementContext={false} competitorContext={false} filterState={null} keyword="" loading={false} error={null} filtersOpen={false} displayOverrides={new Map()} targetBuildingId="same" targetBuildingType="future" onPatchFilters={noop} onBack={noop} onToggleFilters={noop} onKeywordChange={noop} onSearch={noop} onResetFilters={noop} onRetry={noop} onBuildingClick={noop} />);
  const rows=container.querySelectorAll('article');
  expect(rows[0]).not.toHaveAttribute('aria-current');expect(rows[1]).toHaveAttribute('aria-current','true');
  expect(within(rows[1]).getByText('规划总体量')).toBeVisible();expect(within(rows[0]).getByText('统计面积')).toBeVisible();
  expect(screen.getAllByText('目标楼宇')).toHaveLength(1);
  expect(within(rows[1]).queryByText('净有效租金')).not.toBeInTheDocument();expect(within(rows[1]).queryByText('空置率')).not.toBeInTheDocument();
});
