import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { IconButton } from '../IconButton';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it('delays the first pointer hint, skips delay across the toolbar, and dismisses on Escape/click', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
  render(<><IconButton variant="ghost" label="放大">+</IconButton><IconButton variant="ghost" label="缩小">−</IconButton></>);
  const first = screen.getByRole('button', { name: '放大' });
  const second = screen.getByRole('button', { name: '缩小' });
  fireEvent.pointerEnter(first, { pointerType: 'mouse' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(450));
  expect(screen.getByRole('tooltip')).toHaveTextContent('放大');
  expect(first).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
  fireEvent.pointerLeave(first, { pointerType: 'mouse' });
  fireEvent.pointerEnter(second, { pointerType: 'mouse' });
  expect(screen.getByRole('tooltip')).toHaveTextContent('缩小');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(second).not.toHaveAttribute('aria-describedby');
  fireEvent.pointerEnter(first, { pointerType: 'mouse' });
  fireEvent.click(first);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
it('does not show touch hover hints and clears pending work on unmount', () => {
  vi.useFakeTimers();
  const { unmount } = render(<IconButton variant="ghost" label="关闭">×</IconButton>);
  const button = screen.getByRole('button', { name: '关闭' });
  fireEvent.pointerEnter(button, { pointerType: 'touch' });
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerEnter(button, { pointerType: 'mouse' });
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves the original toolbar parent and forwards the native button ref', () => {
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  render(<div data-testid="toolbar"><IconButton ref={ref} label="返回" onClick={click}>←</IconButton></div>);
  const button = screen.getByRole('button', { name: '返回' });
  expect(ref.current).toBe(button);
  expect(button.parentElement).toBe(screen.getByTestId('toolbar'));
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
});
