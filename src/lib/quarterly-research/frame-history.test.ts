import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const bridge = readFileSync('scripts/quarterly-research/frame-history.js', 'utf8');
describe('private frame history adapter', () => {
  it('preserves focus state and normalizes fragments before native URL validation', () => {
    // The real srcdoc navigation is browser-verified. jsdom does not implement
    // opaque about: history rewriting; this fixture checks the adapter boundary.
    const native = vi.fn((state: unknown, _title: string, url: string | undefined) => {
      const resolved = url && new URL(url, 'https://synthetic.invalid/quarterly-research');
      if (resolved && resolved.href.split('#')[0] !== 'about:srcdoc') throw new DOMException('Cannot rewrite srcdoc to its parent URL', 'SecurityError');
      return state;
    });
    const history = { pushState: native, replaceState: native };
    expect(() => history.replaceState(null, '', '#space')).toThrow();
    runInNewContext(bridge, { history, location: { href: 'about:srcdoc' } });
    const state = { focus: 'synthetic-region' };
    history.pushState(state, '', '#space?focus=synthetic-region');
    expect(native).toHaveBeenLastCalledWith(state, '', 'about:srcdoc#space?focus=synthetic-region');
    history.replaceState(null, '', 'about:srcdoc#space');
    expect(native).toHaveBeenLastCalledWith(null, '', 'about:srcdoc#space');
    expect(() => history.pushState(null, '', 'https://external.invalid/')).toThrow();
  });
  it('leaves standalone report history unchanged', () => {
    const native = vi.fn(), history = { pushState: native, replaceState: native };
    runInNewContext(bridge, { history, location: { href: 'https://synthetic.invalid/report' } });
    expect(history.replaceState).toBe(native);
  });
});
