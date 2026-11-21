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
