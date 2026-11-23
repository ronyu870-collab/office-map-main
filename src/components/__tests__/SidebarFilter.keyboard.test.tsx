import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SidebarFilter } from '../SidebarFilter';

const props = () => ({ embedded: true, defaultExpanded: true, districts: ['朝阳区'], submarkets: ['CBD', '望京-酒仙桥'], leeds: ['Gold'], subwayLines: ['地铁1号线'], availableStations: [], onFilterChange: vi.fn() });
it('opens each filter section with native keyboard controls and preserves the open global section when resetting', async () => {
  const user = userEvent.setup(); render(<SidebarFilter {...props()} />);
  for (const name of ['项目类型', '行政区划', '子市场', 'LEED 认证', '地铁通勤辐射圈', '多重筛选']) {
    const toggle = screen.getByRole('button', { name });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus(); await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(panel).toBeVisible();
    await user.keyboard(' '); expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  const global = screen.getByRole('button',{name:'全局筛选'});
  await user.click(screen.getByRole('button',{name:'重置'}));
  expect(global).toHaveAttribute('aria-expanded','true');
});
it('names condition inputs and allows keyboard comparison expansion and independent group removal', async () => {
  const user=userEvent.setup();render(<SidebarFilter {...props()} />);
  await user.click(screen.getByRole('button',{name:'多重筛选'}));
  await user.click(screen.getByRole('button',{name:'添加条件'}));
  expect(screen.getByRole('combobox',{name:'第1项筛选字段'})).toBeVisible();
  expect(screen.getByRole('combobox',{name:'第1项比较方式'})).toBeVisible();
  await user.type(screen.getByRole('spinbutton',{name:'第1项筛选数值'}),'120');
  await user.click(screen.getByRole('button',{name:'移除第1项筛选条件'}));
  expect(screen.queryByRole('spinbutton',{name:'第1项筛选数值'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'添加条件'})).toHaveFocus();
  const comparison=screen.getByRole('button',{name:'项目对比筛选'});
  comparison.focus();await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button',{name:'添加筛选组'}));
  const group=screen.getByRole('button',{name:'组1'});
  group.focus();await user.keyboard(' ');expect(group).toHaveAttribute('aria-expanded','false');
  await user.keyboard('{Enter}');expect(group).toHaveAttribute('aria-expanded','true');
  const panel=document.getElementById(group.getAttribute('aria-controls')!)!;
  await user.click(within(panel).getByRole('checkbox',{name:'望京-酒仙桥'}));
  const remove=screen.getByRole('button',{name:'移除组1'});remove.focus();await user.keyboard('{Enter}');
  expect(screen.queryByRole('button',{name:'组1'})).not.toBeInTheDocument();
  expect(comparison).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('button',{name:'添加筛选组'})).toHaveFocus();
});
