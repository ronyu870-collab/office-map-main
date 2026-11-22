// Raw CDP profiles/traces may contain provider credentials. Only explicitly
// selected, sanitized fields leave the diagnostic process.
const redact = value => String(value).replace(/https?:\/\/[^\s)]+/g, '[url]').replace(/[a-f\d]{32,}/gi, '[redacted]');
const publicURL = value => {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? (url.origin + url.pathname).replace(/[a-f\d]{32,}/gi, '[redacted]') : '';
  } catch { return ''; }
};

export function sanitizeErrorStack(error) {
  return { name: /^[A-Za-z ]*Error$/.test(error.name) ? error.name : 'Error',
    frames: String(error.stack ?? '').split('\n').slice(1).filter(line => /^\s+at\s/.test(line)).map(line => line.replace(/https?:\/\/[^\s)]+/g, value => {
      const position = value.match(/:\d+:\d+$/)?.[0] ?? '';
      return publicURL(position ? value.slice(0, -position.length) : value) + position;
    }).replace(/[a-f\d]{32,}/gi, '[redacted]')) };
}

export function sanitizeCpuProfile(profile) {
  return {
    startTime: profile.startTime, endTime: profile.endTime,
    nodes: profile.nodes.map(node => ({
      id: node.id,
      callFrame: { functionName: redact(node.callFrame.functionName), scriptId: node.callFrame.scriptId,
        url: publicURL(node.callFrame.url), lineNumber: node.callFrame.lineNumber, columnNumber: node.callFrame.columnNumber },
      ...(node.hitCount === undefined ? {} : { hitCount: node.hitCount }),
      ...(node.children ? { children: [...node.children] } : {}),
      ...(node.positionTicks ? { positionTicks: node.positionTicks.map(({ line, ticks }) => ({ line, ticks })) } : {}),
    })),
    samples: [...(profile.samples ?? [])], timeDeltas: [...(profile.timeDeltas ?? [])],
  };
}

export function sanitizeMainThreadTrace(trace) {
  const threads = trace.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
  return [
    ...threads.map(({ pid, tid }) => ({ name: 'thread_name', ph: 'M', pid, tid, ts: 0, args: { name: 'CrRendererMain' } })),
    ...trace.filter(event => threads.some(thread => thread.pid === event.pid && thread.tid === event.tid) && event.ph === 'X')
      .map(event => ({ name: redact(event.name), cat: redact(event.cat ?? ''), ph: 'X', pid: event.pid, tid: event.tid, ts: event.ts, dur: event.dur })),
  ];
}

export function summarizeLongTasks({ tasks, profile, trace, navigationStart, origin }) {
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
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      const node = nodes.get(id);
      if (!node) break;
      frames.push(safeFrame(node.callFrame));
      id = parents.get(id);
    }
    return frames;
  };
  let time = profile.startTime;
  // Chrome can emit samples out of timestamp order (negative timeDeltas).
  // DevTools CPUProfileDataModel sorts sample/timestamp pairs before building
  // durations. Count each chronological interval once, from sample to next.
  const points = (profile.samples ?? []).map((id, index) => ({ id, at: time += profile.timeDeltas?.[index] ?? 0 }))
    .sort((a, b) => a.at - b.at);
  // Timeline timestamps and CPU profile times are monotonic microseconds;
  // PerformanceObserver.startTime is milliseconds relative to NavigationStart.
  const mainThreads = trace.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
  const isMain = event => mainThreads.some(thread => thread.pid === event.pid && thread.tid === event.tid);
  return tasks.map(task => {
    const start = navigationStart * 1e6 + task.startTime * 1000, end = start + task.duration * 1000;
    const counts = new Map();
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      const next = points[index + 1]?.at ?? profile.endTime ?? point.at;
      const overlap = Math.max(0, Math.min(next, end) - Math.max(point.at, start));
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
