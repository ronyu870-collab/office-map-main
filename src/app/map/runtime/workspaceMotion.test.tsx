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
