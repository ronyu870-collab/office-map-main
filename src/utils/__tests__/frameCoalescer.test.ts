import { describe, expect, it, vi } from 'vitest';

import { createLatestFrameScheduler } from '@/src/utils/frameCoalescer';

describe('createLatestFrameScheduler', () => {
  it('同一帧内只执行最后一次任务', () => {
    const callbacks = new Map<number, () => void>();
    let nextFrameId = 1;
    const requestFrame = vi.fn((callback: () => void) => {
      const frameId = nextFrameId++;
      callbacks.set(frameId, callback);
      return frameId;
    });
    const cancelFrame = vi.fn((frameId: number) => {
      callbacks.delete(frameId);
    });
    const run = vi.fn();
    const scheduler = createLatestFrameScheduler(requestFrame, cancelFrame);

    scheduler.schedule(() => run('第一次'));
    scheduler.schedule(() => run('第二次'));
    scheduler.schedule(() => run('最后一次'));

    expect(requestFrame).toHaveBeenCalledTimes(1);
    callbacks.get(1)?.();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('最后一次');
  });

  it('取消后不再执行等待中的任务', () => {
    const callbacks = new Map<number, () => void>();
    const requestFrame = (callback: () => void) => {
      callbacks.set(1, callback);
      return 1;
    };
    const cancelFrame = vi.fn((frameId: number) => {
      callbacks.delete(frameId);
    });
    const run = vi.fn();
    const scheduler = createLatestFrameScheduler(requestFrame, cancelFrame);

    scheduler.schedule(run);
    scheduler.cancel();
    callbacks.get(1)?.();

    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(run).not.toHaveBeenCalled();
  });
});
