// The app still imports its real loader and runs its real MapController. The
// remote AMap response uses an isolated DOM adapter, not a GPU or live tiles.
export function installSyntheticMap() {
  class Events {
    listeners = new Map();
    on(event, fn) { const current = this.listeners.get(event) ?? new Set(); current.add(fn); this.listeners.set(event, current); }
    off(event, fn) { this.listeners.get(event)?.delete(fn); }
    emit(event, value) { for (const fn of this.listeners.get(event) ?? []) fn(value); }
  }
  class Marker extends Events {
    constructor(options) {
      super();
      this.content = document.createElement('div');
      if (typeof options.content === 'string') this.content.innerHTML = options.content;
      else if (options.content instanceof Element) this.content.append(options.content);
      this.content.onclick = originEvent => this.emit('click', { originEvent });
    }
    show() { this.content.hidden = false; }
    hide() { this.content.hidden = true; }
    setExtData(value) { this.ext = value; }
    getExtData() { return this.ext; }
    setzIndex() {}
  }
  class MapFixture extends Events {
    constructor(id) {
      super();
      this.root = document.createElement('div');
      this.root.className = 'amap-maps';
      this.root.style.cssText = 'position:absolute;inset:0';
      this.layer = document.createElement('div');
      this.layer.className = 'amap-layer';
      this.root.append(this.layer);
      document.getElementById(id).append(this.root);
      setTimeout(() => { this.layer.classList.add('fixture-tile-ready'); this.emit('complete'); }, 40);
    }
    getZoom() { return this.zoom ?? 15; }
    getCenter() {
      const [lng, lat] = this.center ?? [116.46, 39.9];
      return { lng, lat, getLng: () => lng, getLat: () => lat };
    }
    setZoomAndCenter(zoom, center) { this.zoom = zoom; this.center = center; }
    getLayers() { return [this.layer]; }
    resize() {}
    add(objects) { for (const object of [].concat(objects)) if (object?.content) this.layer.append(object.content); }
    remove(objects) { for (const object of [].concat(objects)) object?.content?.remove(); }
    destroy() { this.root.remove(); }
  }
  class InfoWindow extends Events {
    constructor(options) { super(); this.content = options.content; }
    open(map) {
      this.frame = document.createElement('div');
      this.frame.className = 'amap-info';
      this.frame.style.cssText = 'position:absolute;left:12px;top:150px;z-index:400';
      this.setContent(this.content);
      map.root.append(this.frame);
    }
    setContent(content) {
      this.content = content;
      if (!this.frame) return;
      if (content instanceof Element) this.frame.replaceChildren(content);
      else this.frame.innerHTML = content ?? '';
    }
    getContent() { return this.content; }
    getVisible() { return this.frame?.isConnected ?? false; }
    close() {
      if (!this.frame?.isConnected) return;
      this.frame.remove();
      this.emit('close');
    }
  }
  window.AMap = { Map: MapFixture, Marker, InfoWindow, Pixel: class {}, Size: class {}, LngLat: class {} };
  window.___onAPILoaded();
}
