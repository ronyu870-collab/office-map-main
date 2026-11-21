// Only compact, query-free attribution leaves the diagnostic process. Raw CDP
// profiles/traces can contain provider credentials and are never serialized.
export function summarizeLongTasks({ tasks, profile, trace, navigationStart, origin }) {
  const redact = value => String(value).replace(/[a-f\d]{32,}/gi, '[redacted]');
  const safeFrame = frame => {
    let source = frame.url ? 'other' : 'runtime';
    if (frame.url) try {
      const url = new URL(frame.url);
      if (/^https?:$/.test(url.protocol)) source = /(^|\.)(amap\.com|amap\.cn|autonavi\.com|autonavi\.cn|gaode\.com)$/.test(url.hostname)
        ? `amap:${url.hostname}${url.pathname}` : url.origin === origin ? `application:${url.pathname}` : `external:${url.origin}`;
    } catch { /* A non-URL runtime frame has no useful public source. */ }
    return { function: redact(frame.functionName || '(anonymous)'), source: redact(source), line: frame.lineNumber + 1 };
  };
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const stack = id => {
    const frames = [], seen = new Set();
    while (id !== undefined && !seen.has(id) && frames.length < 40) {
      seen.add(id);
      const node = nodes.get(id);
      if (!node) break;
      frames.push(safeFrame(node.callFrame));
      id = parents.get(id);
    }
    return frames;
  };
  let time = profile.startTime;
  const points = (profile.samples ?? []).map((id, index) => ({ id, at: time += profile.timeDeltas?.[index] ?? 0 }));
  // Timeline timestamps and CPU profile times are monotonic microseconds;
  // PerformanceObserver.startTime is milliseconds relative to NavigationStart.
  const mainThreads = trace.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
  const isMain = event => mainThreads.some(thread => thread.pid === event.pid && thread.tid === event.tid);
  return tasks.map(task => {
    const start = navigationStart * 1e6 + task.startTime * 1000, end = start + task.duration * 1000;
    const counts = new Map();
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const previous = index ? points[index - 1].at : profile.startTime;
      const overlap = Math.max(0, Math.min(point.at, end) - Math.max(previous, start));
      if (!overlap) continue;
      const item = counts.get(point.id) ?? { cpuMs: 0, stack: stack(point.id) };
      item.cpuMs += overlap / 1000;
      counts.set(point.id, item);
    }
    return {
      startTime: task.startTime, duration: task.duration,
      topStacks: [...counts.values()].sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 15),
      // Without renderer thread metadata, omit timeline attribution rather than
      // accidentally labeling another thread's GC as this main-thread task.
      trace: trace.filter(event => isMain(event) && event.ph === 'X' && event.dur >= 2000 && event.ts < end && event.ts + event.dur > start)
        .sort((a, b) => b.dur - a.dur).slice(0, 25)
        .map(event => ({ name: redact(event.name), durationMs: event.dur / 1000, offsetMs: (event.ts - start) / 1000 })),
    };
  });
}
