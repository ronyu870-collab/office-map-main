import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useUnsavedNavigation } from './useUnsavedNavigation';

let navigation: EventTarget;
function Surface({ dirty }: { dirty: boolean }) {
  useUnsavedNavigation(dirty);
  return <a href="/map?building=source" onClick={event => event.preventDefault()}>返回项目</a>;
}
beforeEach(() => { navigation = new EventTarget(); vi.stubGlobal('navigation', navigation); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('protects actual edits on links, browser traversal and refresh while cancellation retains the page', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<Surface dirty />);
  fireEvent.click(screen.getByText('返回项目'));
  const traverse = new Event('navigate', { cancelable: true });
  Object.assign(traverse, { navigationType: 'traverse' });
  navigation.dispatchEvent(traverse);
  expect(traverse.defaultPrevented).toBe(true);
  const refresh = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(refresh);
  expect(refresh.defaultPrevented).toBe(true); expect(confirm).toHaveBeenCalledTimes(2);
  confirm.mockReturnValue(true); fireEvent.click(screen.getByText('返回项目'));
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(false);
});
it('does not prompt or add a history entry for an unchanged form', () => {
  const confirm = vi.spyOn(window, 'confirm'); const history = vi.spyOn(window.history, 'pushState');
  render(<Surface dirty={false} />); fireEvent.click(screen.getByText('返回项目'));
  expect(confirm).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
});
