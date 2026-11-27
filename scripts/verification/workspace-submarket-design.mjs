import assert from 'node:assert/strict';
import { installSyntheticMap } from '../performance/fixtures/map-adapter.mjs';

// Provide the public overlay APIs needed by the active V3 renderer. Tile/GPU
// behavior is outside this isolated business-and-layout regression.
function installNativeOverlays() {
  const BaseMap = window.AMap.Map, BaseMarker = window.AMap.Marker;
  const coordinates = value => Array.isArray(value) ? value : [value.getLng?.() ?? value.lng, value.getLat?.() ?? value.lat];
  class Marker extends BaseMarker {
    constructor(options) { super(options); this.options = options; }
    setOpacity(value) { this.content.style.opacity = value; }
  }
  class LabelsLayer { constructor() { this.markers = []; } add(markers) { this.markers.push(...[].concat(markers)); } remove() {} clear() { this.markers = []; } setOpacity() {} }
  class MassMarks extends BaseMarker { constructor() { super({}); } setMap() {} clear() {} setOpacity() {} }
  class LabelMarker extends BaseMarker { constructor(options) { super({}); this.options = options; } setOpacity() {} }
  window.AMap.LngLat = class { constructor(lng, lat) { this.lng = lng; this.lat = lat; } getLng() { return this.lng; } getLat() { return this.lat; } };
  window.AMap.Marker = Marker; window.AMap.LabelsLayer = LabelsLayer;
  window.AMap.MassMarks = MassMarks; window.AMap.LabelMarker = LabelMarker;
  window.AMap.Map = class extends BaseMap {
    constructor(id, options) { super(id, options); this.host = document.getElementById(id); this.zoom = 11; this.center = [116.4, 39.94]; this.markers = new Set(); window.__submarketMap = this; window.__submarketMapInstances = (window.__submarketMapInstances ?? 0) + 1; }
    getContainer() { return this.host; }
    lngLatToContainer(point) { return super.lngLatToContainer(coordinates(point)); }
    position() { for (const marker of this.markers) { if (!marker.options?.position) continue; const coordinate = marker.options.position; const point = Array.isArray(coordinate) ? coordinate : [coordinate.getLng?.() ?? coordinate.lng, coordinate.getLat?.() ?? coordinate.lat]; if (!point.every(Number.isFinite)) continue; const p = this.lngLatToContainer(point); marker.content.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;transform:translate(-50%,-50%);`; } }
    add(objects) { super.add(objects); for (const object of [].concat(objects)) this.markers.add(object); this.position(); }
    remove(objects) { super.remove(objects); for (const object of [].concat(objects)) this.markers.delete(object); }
    setZoomAndCenter(zoom, center) { this.emit('zoomstart'); super.setZoomAndCenter(zoom, coordinates(center)); this.position(); this.emit('zoomend'); }
    setCenter(center) { this.center = coordinates(center); this.position(); this.emit('moveend'); }
    resize() { this.position(); }
  };
}

export async function verifySubmarketDesign(context, { base, width, stock }) {
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.stack));
  // Region centers are from the read-only production catalog check; asset and
  // metric rows below are synthetic and never enter the production database.
  const areas = [
    ['通惠河传媒走廊', 116.51813,39.90654], ['望京-酒仙桥',116.48324,39.99600],
    ['丰台科技园',116.30214,39.82607], ['东城商务区',116.42604,39.92177],
    ['CBD',116.46342,39.91027], ['上地',116.31249,40.04658], ['丽泽',116.32785,39.86588],
    ['中关村',116.32715,39.97725], ['亚奥',116.40568,39.98505], ['亦庄',116.53554,39.78477],
    ['北清路',116.22279,40.07554], ['四季青',116.25896,39.95206], ['燕莎',116.45988,39.95145],
    ['玉渊潭',116.28677,39.92823], ['通州',116.66822,39.91444], ['金融街',116.35914,39.91624],
  ];
  const selected = width >= 1200 ? areas : areas.slice(0,4);
  const names = selected.map(area=>area[0]);
  const places = selected.map(area=>area.slice(1));
  // Synthetic buildings have new identities. Do not inherit identity-bound
  // photo records from the CBD fixture: research now previews them on visibility.
  const rows = names.map((name, i) => ({ ...stock[0], id: `design-${i}`, name: `${name}测试楼`, submarket: name, grade: ['丰台科技园','上地','四季青','北清路'].includes(name) ? 'BP' : 'A',
    photos: [], location_lng: places[i][0], location_lat: places[i][1],
    building_metrics: stock[0].building_metrics.map((m, index) => ({ ...m, id: `design-metric-${i}-${index}`, building_id: `design-${i}`, net_effective_rent: i === 3 ? null : 205.3, vacancy_rate: i === 3 ? .163 : .12 })) }));
  assert.ok(rows.every(row => !row.photos.length && row.building_metrics.every(metric => metric.building_id === row.id)), 'design fixtures never inherit another building’s assets');
  try {
    await page.route('https://webapi.amap.com/maps**', route => route.fulfill({ contentType: 'application/javascript', body: `(${installSyntheticMap})();(${installNativeOverlays})();` }));
    await page.route('**/api/map/data**', route => {
      const url = new URL(route.request().url());
      return route.fulfill({ json: url.searchParams.get('mode') === 'future' ? { future_supplies: [] } : { buildings: rows, display_overrides: [] } });
    });
    await page.goto(new URL('/map', base).href);
    await page.locator('#map-container[data-marker-tier="submarket"] [data-submarket="通惠河传媒走廊"]').waitFor();
    const modes = ['default', 'rent', 'vacancy', 'leed'];
    const setMode = async mode => {
      const select = page.getByRole('combobox', { name: '地图显示模式', exact: true });
      if (await select.isVisible()) await select.selectOption(mode);
      else await page.getByRole('group', { name: '地图显示模式' }).getByRole('button', { name: { default: '项目', rent: '租金', vacancy: '空置', leed: 'LEED' }[mode], exact: true }).click();
    };
    for (const mode of modes) {
      await setMode(mode);
      await page.locator(`.map-submarket-bubble[data-render-mode="${mode}"][data-submarket="通惠河传媒走廊"]`).waitFor();
      await page.waitForTimeout(300); // Let the existing 180ms surface/collision motion settle.
      const bubbles = await page.locator('#map-container .map-submarket-bubble').evaluateAll(elements => elements.filter(e => getComputedStyle(e).display !== 'none').map(e => {
        const box = e.getBoundingClientRect(), name = e.querySelector('.map-submarket-bubble__name');
        const css = getComputedStyle(e), nameBox = name.getBoundingClientRect();
        return { name: name.textContent, text: e.textContent, width: box.width, height: box.height, background: css.backgroundColor, nameWidth: name.scrollWidth, nameClient: name.clientWidth, nameHeight: name.scrollHeight, nameClientHeight: name.clientHeight,
          fits: nameBox.left >= box.left && nameBox.right <= box.right && [...e.querySelectorAll('span')].every(s => s.scrollWidth <= s.clientWidth + 1), alpha: css.opacity };
      }));
      for (const name of names) {
        const bubble = bubbles.find(b => b.name === name);
        assert.ok(bubble, `${name} rendered by active native overlay in ${mode}`);
        assert.ok(Math.abs(bubble.width - bubble.height) < 0.5, 'circle remains square within browser subpixel rounding'); assert.ok(bubble.fits && bubble.nameHeight <= bubble.nameClientHeight + 1, `${name} text fits ${JSON.stringify(bubble)}`);
        assert.match(bubble.background, /^rgb\(/, 'solid fill without alpha');
        assert.equal(bubble.alpha,'1','the displayed bubble is fully opaque');
        assert.ok(!bubble.text.includes('¥—') && !bubble.text.includes('甲乙级 0'), 'no meaningless financial placeholders or zero office inventory');
      }
      if (mode === 'default') assert.ok(bubbles.find(b => b.name === '丰台科技园').text.includes('产业园 1 个'));
      assert.deepEqual(errors, [], 'active native overlay has no runtime errors');
      if (mode === 'vacancy') assert.equal(await page.locator('[data-submarket="东城商务区"] .map-submarket-bubble__primary').textContent(), '16.3%');
      await page.screenshot({ path: `/tmp/map-submarket-design-${width}-${mode}.png` });
    }
    await setMode('default');
    const target = page.locator('.map-submarket-bubble[data-render-mode="default"][data-submarket="通惠河传媒走廊"]');
    await target.focus(); await target.press('Enter');
    await page.waitForFunction(() => document.querySelector('.map-submarket-bubble[data-submarket="通惠河传媒走廊"]')?.getAttribute('aria-pressed') === 'true');
    await setMode('rent');
    await page.locator('.map-submarket-bubble[data-render-mode="rent"][data-submarket="通惠河传媒走廊"][aria-pressed="true"]').waitFor({state:'attached'});
    await page.getByRole('button', {name:'清空',exact:true}).click();
    for (const mode of ['vacancy','leed','rent','default']) await setMode(mode);
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.map-submarket-bubble[data-submarket="通惠河传媒走廊"]').count(), 1, 'rapid changes dispose replaced layers');
    assert.equal(await page.locator('.map-submarket-bubble[data-submarket="通惠河传媒走廊"]').getAttribute('aria-pressed'), 'false', 'clearing scope removes selection');
    assert.deepEqual(errors, [], 'selection and quick mode changes have no runtime errors');
    assert.equal(await page.evaluate(() => window.__submarketMapInstances), 1, 'mode updates reuse the map');
    return { width, submarketDesign: true, names, modes, solidFill: true, completeLongNames: true, keyboardSelection: true, quickModesStable: true, mapInstances: 1 };
  } finally { await page.close(); }
}
