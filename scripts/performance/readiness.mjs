export const mapStartupStages = ['authorized', 'controller_ready', 'sdk_start', 'sdk_ready', 'tiles_complete',
  'visual_ready', 'stock_read_start', 'stock_data_ready', 'stock_render_start', 'stock_render_returned'];

// Runs inside the browser. Selectors are an explicit, reviewed scenario contract;
// absence of a spinner alone never proves business content is usable.
export function observeNavigation(contract) {
  const documentStart = contract.action === 'open' || contract.action === 'reload';
  if (documentStart && (location.origin !== contract.destination_origin ||
    location.pathname !== contract.destination_pathname || window !== window.top)) return;
  const result = {
    time_origin: performance.timeOrigin, start: documentStart ? 0 : null,
    feedback_ms: null, shell_ms: null, content_usable_ms: null,
    fresh_data_ms: null, map_tiles_ms: null, map_markers_ms: null,
    long_task_count: null, long_task_total_ms: null, status: documentStart ? 'running' : 'waiting',
  };
  const mapStages = contract.map_stage_names ? new Set(contract.map_stage_names) : null;
  if (mapStages) result.map_stages_ms = Object.fromEntries([...mapStages].map(stage => [stage, null]));
  const recordMapStage = mapStages ? (stage) => {
    if (stopped || result.status !== 'running' || result.start === null || !mapStages.has(stage)
      || result.map_stages_ms[stage] !== null || location.origin !== contract.destination_origin
      || location.pathname !== contract.destination_pathname || window !== window.top) return;
    result.map_stages_ms[stage] = performance.now() - result.start;
  } : undefined;
  let stopped = false;
  let frame;
  let longTasks;
  const recordLongTasks = (entries) => {
    for (const entry of entries) {
      if (result.start === null || entry.startTime + entry.duration <= result.start) continue;
      result.long_task_count += 1;
      result.long_task_total_ms += entry.startTime + entry.duration - Math.max(result.start, entry.startTime);
    }
  };
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    result.long_task_count = 0;
    result.long_task_total_ms = 0;
    longTasks = new PerformanceObserver(list => recordLongTasks(list.getEntries()));
    longTasks.observe({ type: 'longtask', buffered: documentStart });
  }
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    document.removeEventListener('click', start, true);
    if (longTasks) {
      recordLongTasks(longTasks.takeRecords());
      longTasks.disconnect();
    }
  };
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
        stop();
      } else {
        for (const [field, selector] of [
          ['feedback_ms', contract.feedback], ['shell_ms', contract.shell],
          ['content_usable_ms', contract.content], ['fresh_data_ms', contract.fresh],
          ['map_tiles_ms', contract.map_tiles], ['map_markers_ms', contract.map_markers],
        ]) {
          if (result[field] === null && visible(selector)) result[field] = elapsed;
        }
        if (result.content_usable_ms !== null && (!contract.fresh || result.fresh_data_ms !== null)
          && (!contract.map_tiles || result.map_tiles_ms !== null) && (!contract.map_markers || result.map_markers_ms !== null)) {
          result.status = 'success';
          stop();
        } else if (elapsed >= contract.timeout_ms) {
          result.status = 'timeout';
          stop();
        }
      }
    }
    if (!stopped) frame = requestAnimationFrame(paint);
  };
  const start = (event) => {
    if (result.start !== null || !event.target?.closest?.(contract.trigger)) return;
    result.start = performance.now();
    if (contract.require_content_transition && visible(contract.content)) {
      result.status = 'preexisting_content';
      stop();
      return;
    }
    result.status = 'running';
  };
  if (!documentStart) document.addEventListener('click', start, true);
  frame = requestAnimationFrame(paint);
  // Deliberately nonpersistent; only this controlled collector reads it.
  window.__colliersNavigationProbe = {
    result,
    stop,
    recordMapStage,
  };
}
