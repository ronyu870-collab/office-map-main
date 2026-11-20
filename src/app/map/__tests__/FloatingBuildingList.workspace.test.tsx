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
