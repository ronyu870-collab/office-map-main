/* AMap transport/geometry substitute only. Marker artwork, HTML, event handlers,
 * zoom hierarchy, collision layout, and CSS are loaded from production source. */
const cache = {};
function loadModule(id) {
  if (cache[id]) return cache[id].exports;
  const entry = window.fixtureModules[id];
  if (!entry) throw new Error(`Unexpected fixture module: ${id}`);
  const record = { exports: {} };
  cache[id] = record;
  new Function('require', 'module', 'exports', entry.code)(name => loadModule(entry.imports[name]), record, record.exports);
  return record.exports;
}

const container = document.querySelector('#map-container');
const events = target => {
  const handlers = new Map();
  target.on = (name, handler) => { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler); };
  target.off = (name, handler) => handlers.get(name)?.delete(handler);
  target.emit = (name, event) => handlers.get(name)?.forEach(handler => handler(event));
  return target;
};
const position = (element, lnglat) => {
  element.style.left = `${lnglat[0] * container.clientWidth}px`;
  element.style.top = `${lnglat[1] * container.clientHeight}px`;
};
const opacity = (element, value) => {
  element.style.opacity = String(value);
  element.style.visibility = value > 0 ? 'visible' : 'hidden';
};

class Pixel { constructor(x, y) { this.x = x; this.y = y; } }
class Size { constructor(width, height) { this.width = width; this.height = height; } }
class Marker {
  constructor(options) {
    events(this); this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'amap-marker fixture-marker';
    this.element.style.zIndex = String(options.zIndex ?? 0);
    if (typeof options.content === 'string') this.element.innerHTML = options.content;
    else this.element.append(options.content);
    this.element.style.transform = options.anchor === 'center' ? 'translate(-50%, -50%)' : `translate(${options.offset?.x ?? 0}px, ${options.offset?.y ?? 0}px)`;
    position(this.element, options.position);
    this.setOpacity(options.opacity ?? 1);
    // The SDK turns one DOM click into one marker event. Keyboard handlers on
    // production buttons prevent their synthetic click when they handle Enter.
    this.element.addEventListener('click', event => { event.stopPropagation(); this.emit('click', { originEvent: event }); });
  }
  setOpacity(value) { opacity(this.element, value); }
  show() { this.element.hidden = false; }
  hide() { this.element.hidden = true; }
}
class LabelMarker {
  constructor(options) {
    events(this); this.options = options;
    this.element = document.createElement('div');
    this.element.className = 'fixture-label';
    this.element.dataset.id = options.name;
    position(this.element, options.position);
    if (options.icon) {
      this.element.classList.add('fixture-label-icon');
      const image = document.createElement('img');
      image.src = options.icon.image;
      [image.width, image.height] = options.icon.size;
      image.alt = options.name;
      this.element.append(image);
      this.element.style.transform = 'translate(-50%, -50%)';
    } else {
      this.element.textContent = options.text.content;
      this.element.style.transform = `translate(${options.text.offset[0]}px, -50%)`;
      Object.assign(this.element.style, { fontSize: `${options.text.style.fontSize}px`, fontWeight: options.text.style.fontWeight, color: options.text.style.fillColor });
    }
    this.element.addEventListener('click', event => { event.stopPropagation(); this.emit('click', { originEvent: event }); });
  }
  setOpacity(value) { opacity(this.element, value); }
  setzIndex(value) { this.element.style.zIndex = String(value); }
}
class LabelsLayer {
  constructor(options) {
    this.element = document.createElement('div'); this.element.className = 'fixture-layer';
    this.element.style.zIndex = String(options.zIndex); this.setOpacity(options.opacity);
  }
  add(markers) { for (const marker of [markers].flat()) this.element.append(marker.element); }
  clear() { this.element.replaceChildren(); }
  setOpacity(value) { opacity(this.element, value); }
}
class MassMarks {
  constructor(data, options) {
    events(this); this.element = document.createElement('div'); this.element.className = 'fixture-layer fixture-mass';
    this.element.style.zIndex = String(options.zIndex);
    for (const item of data) {
      const style = options.style[item.style]; const image = document.createElement('img');
      image.className = 'fixture-dot'; image.src = style.url; image.width = style.size.width; image.height = style.size.height;
      image.dataset.id = item.id; position(image, item.lnglat); image.style.transform = 'translate(-50%, -50%)';
      image.addEventListener('click', event => { event.stopPropagation(); this.emit('click', { data: item, originEvent: event }); });
      this.element.append(image);
    }
    this.setOpacity(options.opacity);
  }
  setMap(map) { if (map) map.add(this); else this.element.remove(); }
  clear() { this.element.replaceChildren(); }
  setOpacity(value) { opacity(this.element, value); }
}

let zoom = 11.2;
const calls = { building: [], future: [], zoom: [] };
const map = events({
  getZoom: () => zoom,
  add: items => [items].flat().forEach(item => container.append(item.element)),
  remove: items => [items].flat().forEach(item => item.element.remove()),
  setZoomAndCenter(value, center) {
    calls.zoom.push({ value, center }); this.emit('zoomstart'); zoom = value; this.emit('zoomchange'); this.emit('zoomend');
  },
});
const controller = {
  map, AMap: { Marker, Pixel, Size, LabelMarker, LabelsLayer, MassMarks }, futureMarkers: [],
  renderMarkers() {}, clearMarkers() {}, updateVisibilityByZoom() {},
  openBuildingInfoWindow: id => calls.building.push(id),
  openFutureSupplyInfoWindow: supply => calls.future.push(supply.id),
  showHoverTooltip() {}, hideHoverTooltip() {}, showFutureSupplyHoverTooltip() {},
  infoWindow: { close() {} },
};
const future = loadModule('src/services/fixtureFutureMethods.ts').FutureMethods;
for (const method of Object.getOwnPropertyNames(future.prototype)) {
  if (method !== 'constructor') controller[method] = future.prototype[method];
}
loadModule('src/app/map/runtime/mapVisualHierarchyV3.ts').installMapVisualHierarchyV3(controller, container);
loadModule('src/app/map/runtime/mapSubmarketCollisionAvoidance.ts').installSubmarketCollisionAvoidance(map, container);

const building = (id, name, submarket, lng, lat, rent, vacancy, grade, leed) => ({
  id, name, submarket, grade, leed_certification: leed, location_lng: lng, location_lat: lat,
  metrics: [{ id: `metric-${id}`, building_id: id, record_year: 2026, record_quarter: 2, net_effective_rent: rent, vacancy_rate: vacancy, total_area: 100000, vacant_area: vacancy * 100000 }],
});
const buildings = [
  building('stock-a', '合成甲', 'CBD', .27, .28, 305, .08, 'A', 'Gold'),
  building('stock-b', '合成乙', '中关村', .60, .33, 188, .18, 'B', 'Silver'),
  building('stock-c', '合成丙', '合成超长子市场名称用于窄屏完整换行', .48, .63, 1000, .30, 'BP', 'Platinum'),
];
const supplies = [
  { id: 'future-quarter', name: '合成未来项目', location_lng: .68, location_lat: .48, launch_year: 2027, launch_quarter: 'Q3', status: 'planned', type: 'A', leed_certification: 'Gold' },
  { id: 'future-pending', name: '合成待核实项目', location_lng: .25, location_lat: .78, launch_year: 2028, status: 'pending', type: 'pending' },
];

const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
const visible = element => {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && element.getBoundingClientRect().width > 0;
};
const svgInfo = image => {
  const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.split(',')[1]), 'image/svg+xml');
  return { text: svg.querySelector('text')?.textContent, font: Number(svg.querySelector('text')?.getAttribute('font-size')), rectangles: svg.querySelectorAll('rect').length, width: image.width, height: image.height, source: image.src };
};
window.markerFixture = {
  calls,
  async set(mode, targetZoom) {
    zoom = targetZoom; controller.renderMarkers(buildings, mode); controller.updateVisibilityByZoom(); controller.renderFutureMarkers(supplies, mode);
    document.querySelector('[data-state]').textContent = `${mode} / zoom ${targetZoom}`;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const deadline = performance.now() + 5000;
    let stable = 0;
    while (stable < 3) {
      await new Promise(resolve => setTimeout(resolve, 70));
      const cards = [...container.querySelectorAll('.map-submarket-bubble')].filter(visible);
      const settled = !container.classList.contains('map-marker-swapping') && cards.every(card => {
        if (card.dataset.collisionX === undefined) return false;
        const transform = new DOMMatrix(getComputedStyle(card).transform);
        return Math.abs(transform.m41 - Number(card.dataset.collisionX)) < .1 && Math.abs(transform.m42 - Number(card.dataset.collisionY)) < .1;
      });
      stable = settled ? stable + 1 : 0;
      if (performance.now() > deadline) throw new Error('Marker collision/transition did not settle');
    }
    await Promise.all([...container.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
  },
  inspect() {
    const cards = [...container.querySelectorAll('.map-submarket-bubble')].filter(visible).map(element => ({
      name: element.title, tag: element.tagName, box: rect(element), heading: rect(element.querySelector('.map-submarket-bubble__name')),
      metrics: [...element.querySelectorAll('.map-submarket-bubble__primary,.map-submarket-bubble__secondary')].map(metric => ({ text: metric.textContent, font: parseFloat(getComputedStyle(metric).fontSize), box: rect(metric) })),
    }));
    const details = [...container.querySelectorAll('.fixture-label-icon img')].filter(visible).map(svgInfo);
    const futures = [...container.querySelectorAll('.map-future-marker')].filter(visible).map(element => {
      const core = element.querySelector('.map-future-marker__core'); const time = element.querySelector('.map-future-marker__time');
      return { id: element.dataset.futureSupplyId, name: element.getAttribute('aria-label'), box: rect(element), glyph: core.textContent, outline: getComputedStyle(core).borderTopStyle, core: rect(core), time: time.textContent, timeVisible: visible(time), font: parseFloat(getComputedStyle(time).fontSize) };
    });
    const selected = container.querySelector('.map-selected-marker'); const artwork = selected?.querySelector('img'); const ring = selected?.querySelector('.map-selected-marker__ring');
    return { tier: container.dataset.markerTier, cards, details, futures, selected: selected ? { box: rect(selected), source: artwork?.src, animation: getComputedStyle(selected).animationName, ringAnimation: ring ? getComputedStyle(ring).animationName : null, ring: ring ? rect(ring) : null } : null, overflow: document.documentElement.scrollWidth > innerWidth + 1, map: rect(container) };
  },
};
