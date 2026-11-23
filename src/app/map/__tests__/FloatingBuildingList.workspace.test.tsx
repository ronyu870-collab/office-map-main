import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FloatingBuildingList from '../components/FloatingBuildingList';

beforeEach(() => vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());
const buildings = [
  { id: 'a', name: '项目甲楼', submarket: 'CBD', metrics: [] },
  { id: 'b', name: '项目乙楼', submarket: 'CBD', metrics: [] },
];
it('keeps list search focus, caret and IME across result updates and restores sorting after detail return', async () => {
  const close = vi.fn();
  const { rerender } = render(<FloatingBuildingList buildings={buildings} onClose={close} />);
  const input = screen.getByRole('searchbox', { name: '搜索当前项目列表' }) as HTMLInputElement;
  const user = userEvent.setup();
  await user.click(input);
  await user.keyboard('项目');
  await waitFor(() => expect(screen.getByRole('button', { name: /项目甲楼 CBD/ })).toBeVisible());
  input.setSelectionRange(1, 1);
  rerender(<FloatingBuildingList buildings={[...buildings]} onClose={close} />);
  expect(screen.getByRole('searchbox', { name: '搜索当前项目列表' })).toBe(input);
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '项目甲' } });
  rerender(<FloatingBuildingList buildings={[...buildings]} onClose={close} />);
  expect(input).toHaveFocus();
  expect(input).toHaveValue('项目甲');
  fireEvent.compositionEnd(input, { data: '甲' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name' } });
  rerender(<FloatingBuildingList active={false} buildings={buildings} onClose={close} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  rerender(<FloatingBuildingList active buildings={buildings} onClose={close} targetBuildingId="a" />);
  expect(input).toHaveValue('项目甲');
  expect(screen.getByRole('combobox')).toHaveValue('name');
  expect(screen.getByRole('button', { name: /项目甲楼 CBD/ })).toHaveAttribute('aria-current', 'true');
});

it('claims Escape once so the parent does not repeat an unsaved-edit confirmation', () => {
  const close = vi.fn();
  render(<FloatingBuildingList buildings={buildings} onClose={close} />);
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  window.dispatchEvent(escape);
  expect(close).toHaveBeenCalledOnce();
  expect(escape.defaultPrevented).toBe(true);
});

it('offers a direct filter adjustment for an empty map result and keeps list-search clearing scoped', async () => {
  const adjust=vi.fn(), close=vi.fn();
  const view=render(<FloatingBuildingList buildings={[]} onClose={close} onAdjustFilters={adjust} />);
  fireEvent.click(screen.getByRole('button',{name:'调整地图筛选'}));expect(adjust).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  view.rerender(<FloatingBuildingList buildings={buildings} onClose={close} onAdjustFilters={adjust} />);
  fireEvent.change(screen.getByRole('searchbox',{name:'搜索当前项目列表'}),{target:{value:'不存在'}});
  fireEvent.click(screen.getByRole('button',{name:'清除列表搜索'}));
  expect(screen.getByRole('button',{name:/项目甲楼 CBD/})).toBeVisible();
  expect(adjust).toHaveBeenCalledOnce();
});

it('identifies the current row by data type as well as ID', () => {
  const same=[{id:'same',name:'存量同ID',_dataType:'existing',metrics:[]},{id:'same',name:'供应同ID',_dataType:'future',metrics:[]}];
  render(<FloatingBuildingList buildings={same} onClose={vi.fn()} targetBuildingId="same" targetBuildingType="future" />);
  expect(screen.getByText('存量同ID').closest('[role="button"]')).not.toHaveAttribute('aria-current');
  expect(screen.getByText('供应同ID').closest('[role="button"]')).toHaveAttribute('aria-current','true');
});

it('does not borrow stock metrics for future rows and reports future hover identity', () => {
  const hover=vi.fn();
  render(<FloatingBuildingList buildings={[{id:'future',name:'规划供应',_dataType:'future',launch_year:2027,launch_quarter:'Q2',total_area:80000,metrics:[{record_year:2026,record_quarter:3,net_effective_rent:999,vacancy_rate:.5,total_area:999}]}]} onClose={vi.fn()} onBuildingHover={hover} />);
  const row=screen.getByRole('button',{name:/规划供应/});
  expect(row).not.toHaveTextContent('999');expect(row).not.toHaveTextContent('50.0%');
  expect(row).toHaveTextContent('规划总体量');expect(row).toHaveTextContent('80,000');
  expect(row).toHaveTextContent('2027年 Q2');expect(row).not.toHaveTextContent('净有效租金');expect(row).not.toHaveTextContent('空置率');
  fireEvent.mouseEnter(row);expect(hover).toHaveBeenCalledWith('future','future');
});

it('releases map hover when the retained list becomes inactive or unmounts',()=>{
  const hover=vi.fn();const view=render(<FloatingBuildingList buildings={buildings} onClose={vi.fn()} onBuildingHover={hover} />);
  fireEvent.mouseEnter(screen.getByText('项目甲楼').closest('[role="button"]')!);
  expect(hover).toHaveBeenLastCalledWith('a','existing');
  view.rerender(<FloatingBuildingList active={false} buildings={buildings} onClose={vi.fn()} onBuildingHover={hover} />);
  expect(hover).toHaveBeenLastCalledWith(null);
  hover.mockClear();view.unmount();expect(hover).toHaveBeenCalledWith(null);
});
