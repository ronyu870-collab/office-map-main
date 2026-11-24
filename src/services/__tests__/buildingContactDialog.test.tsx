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
  expect(screen.getByRole('link',{name:'拨打 010-12345678 转 8001'})).toHaveAttribute('href','tel:01012345678;ext=8001');
  expect(screen.getByRole('link',{name:'拨打 010-87654321'})).toHaveAttribute('href','tel:01087654321');
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

it('keeps multiple named contacts intact and dials each number without names or separators', async()=>{
  const phone='联系人甲 13800138000；联系人乙 13900139000';
  act(()=>{mountBuildingContactDialog('甲楼',phone,vi.fn());});await screen.findByRole('dialog',{name:'甲楼'});
  expect(screen.getByText(phone)).toBeVisible();
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(screen.getByRole('link',{name:'拨打 13800138000'})).toHaveAttribute('href','tel:13800138000');
  expect(screen.getByRole('link',{name:'拨打 13900139000'})).toHaveAttribute('href','tel:13900139000');
});

it.each(['请联系业主','138****8000','12345678901234567890','+44 20 87654321'])('preserves unrecognized contact text without inventing a dial target: %s',async phone=>{
  act(()=>{mountBuildingContactDialog('甲楼',phone,vi.fn());});await screen.findByRole('dialog',{name:'甲楼'});
  expect(screen.getByText(phone)).toBeVisible();expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('normalizes explicit country codes and extensions, and avoids duplicate dial actions',async()=>{
  const phone='+86 13800138000 / +86 13800138000；(010) 12345678 ext. 123；+33123456789';
  act(()=>{mountBuildingContactDialog('甲楼',phone,vi.fn());});await screen.findByRole('dialog',{name:'甲楼'});
  expect(screen.getByText(phone)).toBeVisible();
  expect(screen.getAllByRole('link').map(link=>link.getAttribute('href'))).toEqual(['tel:+8613800138000','tel:01012345678;ext=123','tel:+33123456789']);
});
