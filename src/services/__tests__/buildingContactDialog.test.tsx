import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { closeBuildingContactDialog, mountBuildingContactDialog } from '../map/buildingContactDialog';
afterEach(() => { act(() => closeBuildingContactDialog()); document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('exposes a named contact task, preserves source text and closes only that layer with focus restored', async () => {
  const trigger=document.createElement('button');trigger.textContent='联系方式';document.body.appendChild(trigger);trigger.focus();
  const name='国际商务中心<长名称>',phone='010-12345678 转 8001 / 010-87654321',displayed=vi.fn();
  act(()=>{mountBuildingContactDialog(name,phone,displayed);});
  const dialog=await screen.findByRole('dialog',{name});
  expect(screen.getByText(phone)).toBeVisible();
  expect(screen.getByRole('link',{name:'拨打'})).toHaveAttribute('href',`tel:${phone}`);
  expect(dialog.querySelector('长名称')).toBeNull();
  expect(displayed).toHaveBeenCalledOnce();
  fireEvent.keyDown(dialog,{key:'Escape'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.getElementById('__colliers_contact_modal_overlay')).toBeNull();
});

it('replaces an open contact task and releases its root and body lock on disposal',async()=>{
  let close!:()=>void;
  act(()=>{mountBuildingContactDialog('甲楼','111',vi.fn());});await screen.findByRole('dialog',{name:'甲楼'});
  act(()=>{close=mountBuildingContactDialog('乙楼','222',vi.fn());});await screen.findByRole('dialog',{name:'乙楼'});
  expect(screen.queryByRole('dialog',{name:'甲楼'})).not.toBeInTheDocument();
  expect(document.querySelectorAll('#__colliers_contact_modal_overlay')).toHaveLength(1);
  expect(document.body.style.overflow).toBe('hidden');
  act(()=>{close();close();});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe('');
});

it.each(['','   ','***'])('does not offer a dial action for unavailable or masked contacts: %s',async phone=>{
  act(()=>{mountBuildingContactDialog('甲楼',phone,vi.fn());});await screen.findByRole('dialog',{name:'甲楼'});
  expect(screen.queryByRole('link',{name:'拨打'})).not.toBeInTheDocument();
  expect(screen.getByText(phone.trim() || '暂无联系方式数据')).toBeVisible();
});

it('owns keyboard focus before the first animation frame so immediate Escape closes the visible task', async () => {
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(() => 1);
  const trigger=document.createElement('button');trigger.textContent='联系方式';document.body.appendChild(trigger);trigger.focus();
  act(()=>{mountBuildingContactDialog('甲楼','111',vi.fn());});
  await screen.findByRole('dialog',{name:'甲楼'});
  expect(screen.getByRole('button',{name:'关闭联系方式'})).toHaveFocus();
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
