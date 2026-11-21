import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MapWorkspaceLayout } from '../components/MapWorkspaceLayout';

it('returns keyboard focus to the panel opener when the panel closes', () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1536, height: 800, top: 0, left: 0 } as DOMRect);
  function Workspace() {
    const [open, setOpen] = React.useState(false);
    return <div className="map-workbench"><button aria-label="项目列表" onClick={() => setOpen(true)}>项目列表</button>
      <MapWorkspaceLayout left={null} right={<button onClick={() => setOpen(false)}>关闭列表</button>}
        leftOpen={false} rightOpen={open} focus={false} width={320} onWidthChange={() => {}}>
        <main className="map-workspace-canvas" />
      </MapWorkspaceLayout></div>;
  }
  try {
    render(<Workspace />);
    const opener = screen.getByRole('button', { name: '项目列表' }); opener.focus(); fireEvent.click(opener);
    const close = screen.getByRole('button', { name: '关闭列表' }); close.focus(); fireEvent.click(close);
    expect(opener).toHaveFocus();
  } finally { bounds.mockRestore(); }
});

it('keeps hidden filters current and restores fresh state during a rapid full-list round trip', () => {
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1536, height: 800, top: 0, left: 0 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn() });
  function Filter({ initial }: { initial: string }) {
    const [value] = React.useState(initial);
    return <span>{value}</span>;
  }
  const layout = (left: React.ReactNode, open: boolean) => <MapWorkspaceLayout left={left} right={null}
    leftOpen={open} rightOpen={false} focus={false} width={320} onWidthChange={() => {}}><main /></MapWorkspaceLayout>;
  try {
    const view = render(layout(<Filter initial="旧筛选" />, true));
    view.rerender(layout(null, false));
    view.rerender(layout(<Filter initial="当前筛选" />, true));
    expect(screen.getByText('当前筛选')).toBeInTheDocument();
    view.rerender(layout(<span>关闭后更新</span>, false));
    expect(screen.getByText('关闭后更新')).toBeInTheDocument();
  } finally {
    bounds.mockRestore();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  }
});
