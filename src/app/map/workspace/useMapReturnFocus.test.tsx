import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMapReturnFocus } from './useMapReturnFocus';

function Harness({ ready = true, title = true, hidden = false, editing = false }) {
  useMapReturnFocus(ready);
  return <><input aria-label="继续搜索" autoFocus={editing}/>{title ? <section className="workspace-building" hidden={hidden}><header className="workspace-panel-header"><h2 tabIndex={-1}>当前项目</h2></header></section> : null}</>;
}
beforeEach(() => vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('restores the current project title once without scrolling or later refocusing', () => {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  const view=render(<Harness/>);const title=screen.getByRole('heading',{name:'当前项目'});
  expect(title).toHaveFocus();expect(focus).toHaveBeenCalledWith({preventScroll:true});
  title.blur();view.rerender(<Harness/>);expect(title).not.toHaveFocus();
});
it('leaves an ordinary direct entry alone', () => {
  render(<Harness ready={false}/>);expect(screen.getByRole('heading')).not.toHaveFocus();
});
it('does not replace a control that already owns focus', () => {
  render(<Harness editing/>);expect(screen.getByRole('textbox',{name:'继续搜索'})).toHaveFocus();
});
it('waits for the restored project to be mounted and exposed', async () => {
  const view=render(<Harness title={false}/>);view.rerender(<Harness hidden/>);
  expect(screen.getByRole('heading',{hidden:true})).not.toHaveFocus();
  view.rerender(<Harness/>);await waitFor(()=>expect(screen.getByRole('heading')).toHaveFocus());
});
it.each(['pointerdown','keydown'])('yields to a newer %s action before the title arrives', async type => {
  const view=render(<Harness title={false}/>);
  if(type==='pointerdown')fireEvent.pointerDown(document.body);else fireEvent.keyDown(document.body,{key:'Tab'});
  view.rerender(<Harness/>);await Promise.resolve();expect(screen.getByRole('heading')).not.toHaveFocus();
});
it('disconnects a pending restoration when the map unmounts', async () => {
  const view=render(<Harness title={false}/>);view.unmount();
  const other=render(<div className="workspace-building"><header className="workspace-panel-header"><h2 tabIndex={-1}>另一个工作区</h2></header></div>);
  await Promise.resolve();expect(screen.getByRole('heading')).not.toHaveFocus();other.unmount();
});
