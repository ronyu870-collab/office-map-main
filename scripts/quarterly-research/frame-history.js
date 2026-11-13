// A srcdoc frame resolves relative fragments against its parent's base URL.
// Keep the incumbent report's hash history inside its own document instead.
(() => {
  if (location.href.split('#')[0] !== 'about:srcdoc') return;
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = (state, title, url) => {
      const target = url == null ? url : String(url);
      const local = target?.startsWith('#') ? 'about:srcdoc' + target : target;
      return original(state, title, local);
    };
  }
})();
