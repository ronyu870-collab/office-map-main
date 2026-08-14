export type FrameRequest = (callback: () => void) => number;
export type FrameCancel = (frameId: number) => void;

export interface LatestFrameScheduler {
  schedule(task: () => void): void;
  cancel(): void;
}

/**
 * 将同一帧内的连续任务合并为最后一次。
 * 适合把昂贵的绘制工作移出输入事件，同时保持下一帧立即生效。
 */
export function createLatestFrameScheduler(
  requestFrame: FrameRequest,
  cancelFrame: FrameCancel,
): LatestFrameScheduler {
  let frameId: number | null = null;
  let latestTask: (() => void) | null = null;

  return {
    schedule(task) {
      latestTask = task;
      if (frameId !== null) return;

      frameId = requestFrame(() => {
        frameId = null;
        const taskToRun = latestTask;
        latestTask = null;
        taskToRun?.();
      });
    },
    cancel() {
      latestTask = null;
      if (frameId === null) return;
      cancelFrame(frameId);
      frameId = null;
    },
  };
}
