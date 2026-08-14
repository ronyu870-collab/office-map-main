/**
 * 节流函数：限制函数在 interval 毫秒内最多执行一次
 * 
 * @param fn 要节流的函数
 * @param interval 节流间隔（毫秒）
 * @returns 节流后的函数
 * 
 * @example
 * const throttledFn = throttle(() => console.log('called'), 2000);
 * throttledFn(); // 立即执行
 * throttledFn(); // 被忽略（2秒内）
 * setTimeout(() => throttledFn(), 2100); // 执行（超过2秒）
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    
    // 首次调用或距离上次调用已超过间隔时间
    if (now - lastTime >= interval) {
      lastTime = now;
      fn.apply(this, args);
    }
  };
}
