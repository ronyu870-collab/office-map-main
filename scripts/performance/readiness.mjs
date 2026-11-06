// Runs inside the browser. Selectors are an explicit, reviewed scenario contract;
// absence of a spinner alone never proves business content is usable.
export function observeNavigation(contract) {
  const result = {
    time_origin: performance.timeOrigin, start: null,
    feedback_ms: null, shell_ms: null, content_usable_ms: null,
    fresh_data_ms: null, status: 'waiting',
  };
  let stopped = false;
  let frame;
  const visible = (selector) => {
    if (!selector) return false;
    return [...document.querySelectorAll(selector)].some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    });
  };
  const paint = () => {
    if (stopped) return;
    if (result.start !== null) {
      const elapsed = performance.now() - result.start;
      if (contract.error && visible(contract.error)) {
        result.status = 'application_error';
        stopped = true;
      } else {
        for (const [field, selector] of [
          ['feedback_ms', contract.feedback], ['shell_ms', contract.shell],
          ['content_usable_ms', contract.content], ['fresh_data_ms', contract.fresh],
        ]) {
          if (result[field] === null && visible(selector)) result[field] = elapsed;
        }
        if (result.content_usable_ms !== null && (!contract.fresh || result.fresh_data_ms !== null)) {
          result.status = 'success';
          stopped = true;
        } else if (elapsed >= contract.timeout_ms) {
          result.status = 'timeout';
          stopped = true;
        }
      }
    }
    if (!stopped) frame = requestAnimationFrame(paint);
  };
  const start = (event) => {
    if (result.start !== null || !event.target?.closest?.(contract.trigger)) return;
    result.start = performance.now();
    result.status = 'running';
  };
  document.addEventListener('click', start, true);
  frame = requestAnimationFrame(paint);
  // Deliberately nonpersistent; only this controlled collector reads it.
  window.__colliersNavigationProbe = {
    result,
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('click', start, true);
    },
  };
}
