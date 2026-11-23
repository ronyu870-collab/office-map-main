// Observe the actual SDK without replacing camera/rendering behavior. Install
// before the remote SDK assigns its namespace (Map may be assigned later).
export async function waitForLiveAmapTiles(page, network) {
  if (network.tileOK > 0) return;
  await page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.ok() && /(^|\.)(amap\.com|amap\.cn|autonavi\.com|autonavi\.cn|gaode\.com)$/.test(url.hostname)
      && /\/tile\/|\/get_tile$/.test(url.pathname);
  }, { timeout: 15000 });
}

export function installLiveAmapProbe() {
  const probe = window.__liveAmapProbe = { created: 0, events: [], calls: [], stages: [], initialCameras: [], markerCalls: [] };
  window.__colliersNavigationProbe = {
    recordMapStage(stage) { probe.stages.push({ stage, at: performance.now() }); },
  };
  const instrument = namespace => {
    if (!namespace || namespace.__probe) return;
    Object.defineProperty(namespace, '__probe', { value: true });
    const wrap = Constructor => typeof Constructor !== 'function' ? Constructor : new Proxy(Constructor, {
      construct(target, args, newTarget) {
        const options = args[1];
        probe.initialCameras.push({ zoom: options?.zoom, center: Array.isArray(options?.center) ? [...options.center] : null });
        const map = Reflect.construct(target, args, newTarget);
        probe.map = window.__workspaceMap = map;
        probe.created++;
        for (const name of ['resize', 'setCenter', 'setZoomAndCenter', 'setBounds', 'destroy']) {
          const method = map[name];
          if (typeof method !== 'function') continue;
          map[name] = function (...values) {
            probe.calls.push({ name, at: performance.now() });
            return Reflect.apply(method, this, values);
          };
        }
        for (const name of ['complete', 'movestart', 'moveend', 'zoomstart', 'zoomend', 'resize']) {
          map.on(name, () => probe.events.push({ name, at: performance.now() }));
        }
        return map;
      },
    });
    const wrapLabel = Constructor => typeof Constructor !== 'function' ? Constructor : new Proxy(Constructor, {
      construct(target, args, newTarget) {
        const marker = Reflect.construct(target, args, newTarget);
        for (const methodName of ['setzIndex', 'setOpacity']) {
          const method = marker[methodName];
          if (typeof method !== 'function') continue;
          marker[methodName] = function (...values) {
            probe.markerCalls.push({ name: args[0]?.name, method: methodName, values, at: performance.now() });
            return Reflect.apply(method, this, values);
          };
        }
        return marker;
      },
    });
    let labelConstructor = wrapLabel(namespace.LabelMarker);
    Object.defineProperty(namespace, 'LabelMarker', {
      configurable: true,
      get() { return labelConstructor; },
      set(value) { labelConstructor = wrapLabel(value); },
    });
    let constructor = wrap(namespace.Map);
    Object.defineProperty(namespace, 'Map', {
      configurable: true,
      get() { return constructor; },
      set(value) { constructor = wrap(value); },
    });
  };
  let amap = window.AMap;
  instrument(amap);
  Object.defineProperty(window, 'AMap', {
    configurable: true,
    get() { return amap; },
    set(value) { amap = value; instrument(value); },
  });
}

export function beginLiveAmapSample() {
  const p = window.__liveAmapProbe;
  const sample = p.sample = { start: performance.now(), intervals: [], activeIntervals: [], longTasks: [], calls: p.calls.length, events: p.events.length, created: p.created };
  sample.observer = new PerformanceObserver(list => sample.longTasks.push(...list.getEntries().map(x => ({ startTime: x.startTime, duration: x.duration }))));
  sample.observer.observe({ type: 'longtask' });
  let previous;
  const frame = now => {
    if (sample.done) return;
    if (previous !== undefined) {
      sample.intervals.push(now - previous);
      if (now - sample.start <= 1000) sample.activeIntervals.push(now - previous);
    }
    previous = now;
    sample.frame = requestAnimationFrame(frame);
  };
  sample.frame = requestAnimationFrame(frame);
}

export function finishLiveAmapSample() {
  const p = window.__liveAmapProbe, s = p.sample;
  s.done = true; cancelAnimationFrame(s.frame);
  s.longTasks.push(...s.observer.takeRecords().map(task => ({ startTime: task.startTime, duration: task.duration })));
  s.observer.disconnect();
  const frames = s.intervals.sort((a,b) => a-b), active = s.activeIntervals.sort((a,b)=>a-b);
  const calls = p.calls.slice(s.calls), events = p.events.slice(s.events);
  const command = calls.filter(x=>['setCenter','setZoomAndCenter','setBounds'].includes(x.name)).at(-1);
  const end = events.filter(x=>['moveend','zoomend'].includes(x.name)).at(-1);
  return { startTime: s.start, endTime: performance.now(), elapsedMs: performance.now()-s.start, frames: frames.length, frameP95Ms: frames[Math.floor(frames.length*.95)] ?? null,
    firstSecondFrameP95Ms: active[Math.floor(active.length*.95)] ?? null,
    intervalsOver33Ms: frames.filter(x=>x>33.4).length, longestFrameMs: frames.at(-1) ?? null, longTasksMs: s.longTasks,
    resizeCalls: calls.filter(x=>x.name==='resize').length, newMapInstances: p.created-s.created,
    cameraEndMs: end ? end.at-s.start : null,
    cameraAfterLastCommandMs: end && command && end.at >= command.at ? end.at-command.at : null };
}
