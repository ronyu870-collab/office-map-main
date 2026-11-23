import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BuildingBasicCard } from '../components/BuildingBasicCard';
import type { BuildingMetric } from '@/src/types';

const metric={record_year:2026,record_quarter:3,net_effective_rent:146.16,vacancy_rate:.211,total_area:80000} as BuildingMetric;
it('keeps future planning and expected dates distinct from linked stock history',()=>{
  render(<BuildingBasicCard building={{id:'f',name:'未来甲楼',_dataType:'future',launch_year:2027,launch_quarter:'Q2',total_area:50000,completion_year:2009,metrics:[metric]}} />);
  expect(screen.getByText('规划总体量')).toBeVisible();expect(screen.getByText('50,000')).toBeVisible();
  expect(screen.getByText(/2027.*Q2/)).toBeVisible();
  expect(screen.queryByText('2009')).not.toBeInTheDocument();expect(screen.queryByText('146.16')).not.toBeInTheDocument();
  expect(screen.queryByText('2026Q3')).not.toBeInTheDocument();
});
it('uses one-decimal rent and meaningful LEED labels without duplicating identity fields',()=>{
  render(<BuildingBasicCard building={{id:'s',name:'存量甲楼',grade:'A',submarket:'CBD',leed_certification:'N',metrics:[metric]}} />);
  expect(screen.getByText('146.2')).toBeVisible();expect(screen.getByText('未认证')).toBeVisible();
  expect(screen.queryByText('LEED N')).not.toBeInTheDocument();
  expect(screen.queryByText('楼宇等级')).not.toBeInTheDocument();expect(screen.queryByText('子市场')).not.toBeInTheDocument();
});
it('preserves pending and missing planning values, and keyboard opening',()=>{
  const open=vi.fn();render(<BuildingBasicCard building={{id:'p',name:'待核实甲楼',_dataType:'future',status:'pending'}} onClick={open} />);
  expect(screen.getByText('规划总体量')).toBeVisible();
  expect(screen.getByText('待核实项目')).toBeVisible();expect(screen.queryByText('入市时间')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button'),{key:'Enter'});expect(open).toHaveBeenCalledOnce();
});
