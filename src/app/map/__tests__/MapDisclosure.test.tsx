import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MapDisclosure } from '../components/MapDisclosure';

it('closes only the disclosure on Escape and returns focus to its trigger', async () => {
  const exit = vi.fn();
  window.addEventListener('keydown', exit);
  const { container } = render(<MapDisclosure label="市场概览"><p>当前筛选结果：CBD</p></MapDisclosure>);
  const trigger = screen.getByText('市场概览');
  fireEvent.click(trigger);
  await waitFor(() => expect(container.querySelector('details')).toHaveAttribute('open'));
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'));
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(trigger).toHaveFocus();
  expect(exit).not.toHaveBeenCalled();
  window.removeEventListener('keydown', exit);
});

it('keeps one disclosure open and dismisses it on outside pointer input without moving input focus', async () => {
  const { container } = render(<><input aria-label="持续搜索" /><MapDisclosure label="市场概览">统计</MapDisclosure><MapDisclosure label="图例">项目类型</MapDisclosure></>);
  fireEvent.click(screen.getByText('市场概览'));
  await waitFor(() => expect(screen.getByText('市场概览')).toHaveAttribute('aria-expanded', 'true'));
  fireEvent.click(screen.getByText('图例'));
  await waitFor(() => expect(screen.getByText('图例')).toHaveAttribute('aria-expanded', 'true'));
  expect(container.querySelectorAll('details[open]')).toHaveLength(1);
  const input = screen.getByRole('textbox'); input.focus(); fireEvent.pointerDown(input);
  expect(container.querySelectorAll('details[open]')).toHaveLength(0);
  expect(input).toHaveFocus();
});

it('handles immediate Escape after switching disclosures before native toggle events settle', async () => {
  const { container } = render(<><MapDisclosure label="市场概览">统计</MapDisclosure><MapDisclosure label="图例">项目类型</MapDisclosure></>);
  fireEvent.click(screen.getByText('图例'));
  await waitFor(() => expect(screen.getByText('图例')).toHaveAttribute('aria-expanded', 'true'));
  fireEvent.click(screen.getByText('市场概览'));
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(container.querySelectorAll('details[open]')).toHaveLength(0));
  expect(screen.queryByText('统计')).not.toBeInTheDocument();
});

it('focuses compact action choices and returns to the opener after choosing a command', async () => {
  const command = vi.fn();
  const { container } = render(<MapDisclosure label="工作区操作" actionMenu><button onClick={command}>定位当前项目</button></MapDisclosure>);
  const trigger = screen.getByText('工作区操作');
  fireEvent.click(trigger);
  const choice = await screen.findByRole('button', { name: '定位当前项目' });
  await waitFor(() => expect(choice).toHaveFocus());
  fireEvent.click(choice);
  expect(command).toHaveBeenCalledOnce();
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(trigger).toHaveFocus();
});

it('provides an explicit filter-list close action without applying or clearing conditions', async () => {
  const remove = vi.fn();
  const {container}=render(<MapDisclosure label="全部2项条件" heading="生效条件" dismissLabel="关闭条件列表"><button onClick={remove}>移除条件：业主 含 资产管理</button></MapDisclosure>);
  const trigger=screen.getByText('全部2项条件');fireEvent.click(trigger);
  await screen.findByRole('heading',{name:'生效条件'});
  fireEvent.click(screen.getByRole('button',{name:'关闭条件列表'}));
  await waitFor(()=>expect(container.querySelector('details')).not.toHaveAttribute('open'));
  expect(remove).not.toHaveBeenCalled();expect(trigger).toHaveFocus();
});

it('keeps keyboard focus in an open filter list when the focused condition is removed', async () => {
  function Conditions() {
    const [items,setItems]=React.useState(['业主','物业']);
    return <MapDisclosure label="全部条件" heading="生效条件" dismissLabel="关闭条件列表">{items.map(item=><button key={item} onClick={()=>setItems(current=>current.filter(value=>value!==item))}>移除{item}</button>)}</MapDisclosure>;
  }
  render(<Conditions />);fireEvent.click(screen.getByText('全部条件'));
  const remove=await screen.findByRole('button',{name:'移除业主'});remove.focus();fireEvent.click(remove);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'移除业主'})).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'关闭条件列表'})).toHaveFocus();
  expect(screen.getByText('全部条件')).toHaveAttribute('aria-expanded','true');
});

it('lets a newly active workspace handle Escape after the previous disclosure is hidden', async () => {
  const escapeWorkspace = vi.fn();
  function Surface({ hidden }: { hidden: boolean }) {
    return <div onKeyDown={event => { if (event.key === 'Escape') escapeWorkspace(); }}>
      <div hidden={hidden}><MapDisclosure label="图例">项目类型</MapDisclosure></div>
      <button type="button">返回地图</button>
    </div>;
  }
  const { rerender } = render(<Surface hidden={false} />);
  fireEvent.click(screen.getByText('图例'));
  expect(await screen.findByText('项目类型')).toBeVisible();

  rerender(<Surface hidden />);
  const back = screen.getByRole('button', { name: '返回地图' });
  back.focus();
  fireEvent.keyDown(back, { key: 'Escape' });
  expect(escapeWorkspace).toHaveBeenCalledOnce();
  expect(back).toHaveFocus();
});
