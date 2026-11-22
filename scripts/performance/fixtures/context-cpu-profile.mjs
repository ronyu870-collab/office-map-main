// Chrome emits Profile on the renderer thread and ProfileChunk on a profiler
// thread. Join by process + profile id, never by the chunk's thread id.
export function cpuProfilesFromTrace(trace) {
  const mains = trace.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
  return trace.filter(event => event.name === 'Profile' && mains.some(main => main.pid === event.pid && main.tid === event.tid)).map(start => {
    const chunks = trace.filter(event => event.name === 'ProfileChunk' && event.pid === start.pid && event.id === start.id).sort((a, b) => a.ts - b.ts);
    const nodes = new Map(), parents = new Map(), samples = [], timeDeltas = [];
    for (const event of chunks) {
      const data = event.args?.data;
      for (const node of data?.cpuProfile?.nodes ?? []) {
        const frame = node.callFrame;
        nodes.set(node.id, { id: node.id, callFrame: { functionName: frame.functionName ?? '', scriptId: String(frame.scriptId ?? ''), url: frame.url ?? '',
          lineNumber: frame.lineNumber ?? -1, columnNumber: frame.columnNumber ?? -1 }, children: [] });
        if (node.parent !== undefined) parents.set(node.id, node.parent);
      }
      samples.push(...(data?.cpuProfile?.samples ?? []));
      timeDeltas.push(...(data?.timeDeltas ?? []));
    }
    if (!samples.length || samples.length !== timeDeltas.length || samples.some(id => !nodes.has(id)) || timeDeltas.some(delta => !Number.isFinite(delta))) {
      throw new Error('Incomplete timeline CPU samples');
    }
    for (const [child, parent] of parents) {
      if (!nodes.has(parent)) throw new Error('Incomplete timeline CPU parents');
      nodes.get(parent).children.push(child);
    }
    let at = start.args?.data?.startTime;
    if (!Number.isFinite(at)) throw new Error('Missing timeline CPU clock');
    let endTime = at;
    for (const delta of timeDeltas) { at += delta; endTime = Math.max(endTime, at); }
    return { startTime: start.args.data.startTime, endTime, nodes: [...nodes.values()], samples, timeDeltas };
  });
}

export function observeContextLongTasks() {
  window.__liveAmapContextTasks = [];
  new PerformanceObserver(list => window.__liveAmapContextTasks.push(...list.getEntries().map(task => ({ startTime: task.startTime, duration: task.duration })))).observe({ type: 'longtask', buffered: true });
}

export function scopeContextTasks(tasks, scenarios) {
  return tasks.map(task => ({ ...task, actions: scenarios.filter(sample => task.startTime < sample.endTime && task.startTime + task.duration > sample.startTime).map(sample => sample.name) }));
}
