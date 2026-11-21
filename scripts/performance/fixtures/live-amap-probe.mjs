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
  const probe = window.__liveAmapProbe = { created: 0, events: [], calls: [], stages: [], initialCameras: [] };
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
