import * as React from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSurfaceMotion } from './workspaceMotion';

it('reverses an unfinished surface transition from its visible position and opacity', () => {
  type RunningAnimation = { cancel: ReturnType<typeof vi.fn>; playState: string; currentTime: number };
  const animations: RunningAnimation[] = [];
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => RunningAnimation>(() => {
    const animation = { cancel: vi.fn(), playState: 'running', currentTime: 60 };
    animations.push(animation); return animation;
  });
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ opacity: '0.72', transform: 'matrix(1, 0, 0, 1, 7, 0)', clipPath: 'none' } as CSSStyleDeclaration);
  function Surface({ open }: { open: boolean }) {
    const ref = React.useRef<HTMLElement>(null);
    useSurfaceMotion(ref, open, false, 'building:compact:360');
    return <aside ref={ref} />;
  }
  try {
    const result = render(<Surface open={false} />);
    result.rerender(<Surface open />);
    result.rerender(<Surface open={false} />);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(animate.mock.calls[1][0][0]).toMatchObject({ opacity: '0.72', transform: 'matrix(1, 0, 0, 1, 7, 0)' });
    result.unmount();
  } finally {
    computed.mockRestore();
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});

it('keeps the visible clip and opacity when a size transition is interrupted by another size', () => {
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => { cancel: ReturnType<typeof vi.fn>; playState: string }>(() => ({ cancel: vi.fn(), playState: 'running' }));
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ opacity: '0.82', transform: 'matrix(1,0,0,1,8,0)', clipPath: 'inset(0px 20px 30px 0px)' } as CSSStyleDeclaration);
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 0, width: 360, height: 500 } as DOMRect);
  function Surface({ width }: { width: number }) {
    const ref = React.useRef<HTMLElement>(null);
    useSurfaceMotion(ref, true, false, String(width));
    return <aside ref={ref} />;
  }
  try {
    const result = render(<Surface width={360} />);
    bounds.mockReturnValue({ left: 80, top: 0, width: 380, height: 500 } as DOMRect);
    result.rerender(<Surface width={380} />);
    bounds.mockReturnValue({ left: 60, top: 0, width: 400, height: 500 } as DOMRect);
    result.rerender(<Surface width={400} />);
    expect(animate.mock.calls.at(-1)?.[0][0]).toMatchObject({ opacity: '0.82', clipPath: 'inset(0px 20px 30px 0px)' });
    result.unmount();
  } finally {
    computed.mockRestore(); bounds.mockRestore();
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});

it('tracks direct manipulation without animating or replaying a stale size on release', () => {
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => { cancel: ReturnType<typeof vi.fn>; playState: string }>(() => ({ cancel: vi.fn(), playState: 'running' }));
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  function Surface({ width, dragging }: { width: number; dragging: boolean }) {
    const ref = React.useRef<HTMLElement>(null);
    useSurfaceMotion(ref, true, false, String(width), { disabled: dragging });
    return <aside ref={ref} />;
  }
  try {
    const result = render(<Surface width={360} dragging={false} />);
    result.rerender(<Surface width={380} dragging />);
    result.rerender(<Surface width={400} dragging />);
    result.rerender(<Surface width={400} dragging={false} />);
    expect(animate).not.toHaveBeenCalled();
    result.unmount();
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});

it('rebases a fullscreen crop onto the smaller sheet when expansion is immediately reversed', () => {
  const animate = vi.fn<(frames: Keyframe[], options: KeyframeAnimationOptions) => { cancel: ReturnType<typeof vi.fn>; playState: string }>(() => ({ cancel: vi.fn(), playState: 'running' }));
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  vi.stubGlobal('DOMMatrixReadOnly', class { m41 = 0; m42 = 0; });
  const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ opacity: '1', transform: 'matrix(1,0,0,1,0,0)', clipPath: 'inset(0px 0px 700px 0px)' } as CSSStyleDeclaration);
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 390, height: 200 } as DOMRect);
  function Surface({ height }: { height: number }) {
    const ref = React.useRef<HTMLElement>(null);
    useSurfaceMotion(ref, true, true, String(height));
    return <aside ref={ref} />;
  }
  try {
    const result = render(<Surface height={200} />);
    bounds.mockReturnValue({ left: 0, top: 0, width: 390, height: 900 } as DOMRect);
    result.rerender(<Surface height={900} />);
    bounds.mockReturnValue({ left: 0, top: 0, width: 390, height: 400 } as DOMRect);
    result.rerender(<Surface height={400} />);
    expect(animate.mock.calls.at(-1)?.[0][0].clipPath).toBe('inset(0 0px 200px 0)');
    result.unmount();
  } finally {
    computed.mockRestore(); bounds.mockRestore(); vi.unstubAllGlobals();
    if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});
