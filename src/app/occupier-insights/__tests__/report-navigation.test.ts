import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountReportNavigation } from '../reportNavigation';

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 1200, width: 1200, x: 0, y: top, toJSON: () => ({}) };
}

describe('occupier report native-scroll navigation', () => {
  let root: HTMLElement;
  let scroll = 0;
  let jobs: Map<number, FrameRequestCallback>;
  let nextJob = 0;
  let cleanup: (() => void) | undefined;
  const disconnect = vi.fn();
  const flush = () => { const pending = [...jobs.values()]; jobs.clear(); pending.forEach(job => job(0)); };

  beforeEach(() => {
    scroll = 0;
    jobs = new Map();
    nextJob = 0;
    disconnect.mockClear();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { jobs.set(++nextJob, callback); return nextJob; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { jobs.delete(id); });
    vi.stubGlobal('innerHeight', 900);
    window.history.replaceState(null, '', '/occupier-insights');
    document.body.innerHTML = `<div id="report"><header data-report-header><nav>
      <a href="#factors" data-chapter-link="factors">选址因素</a>
      <a href="#industry" data-chapter-link="industry">行业差异</a>
      <a href="#checklist" data-chapter-link="checklist">看楼清单</a>
      <a href="#sources" data-chapter-link="sources">来源与口径</a>
      </nav><span data-reading-progress></span></header>
      <section id="report-top" data-report-chapter="cover"></section>
      <section id="factors" data-report-chapter="factors"></section>
      <section id="priorities" data-report-chapter="factors"></section>
      <section id="industry" data-report-chapter="industry"></section>
      <section id="checklist" data-report-chapter="checklist"></section>
      <section id="sources" data-report-chapter="sources"></section></div>`;
    root = document.getElementById('report')!;
    vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => rect(-scroll, 5400));
    vi.spyOn(root.querySelector('header')!, 'getBoundingClientRect').mockReturnValue(rect(0, 76));
    root.querySelectorAll('section').forEach((section, index) => {
      vi.spyOn(section, 'getBoundingClientRect').mockImplementation(() => rect(index * 900 - scroll, 900));
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('starts on the cover, without incorrectly selecting the last chapter', () => {
    cleanup = mountReportNavigation(root); flush();
    expect(root.dataset.activeChapter).toBe('cover');
    expect(root.querySelector('[aria-current]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-reading-progress]')!.style.transform).toBe('scaleX(0)');
  });

  it('updates the current chapter while retaining one chapter for both research scenes', () => {
    cleanup = mountReportNavigation(root); flush();
    for (const [position, id] of [[900, 'factors'], [1800, 'factors'], [2700, 'industry'], [3600, 'checklist'], [4500, 'sources']] as const) {
      scroll = position; window.dispatchEvent(new Event('scroll')); flush();
      expect(root.querySelector('[aria-current]')?.getAttribute('data-chapter-link')).toBe(id);
      expect(root.querySelectorAll('[aria-current]')).toHaveLength(1);
    }
    expect(root.querySelector<HTMLElement>('[data-reading-progress]')!.style.transform).toBe('scaleX(1)');
  });

  it('keeps wheel observation passive so native scrolling is never prevented', () => {
    const add = vi.spyOn(window, 'addEventListener');
    cleanup = mountReportNavigation(root);
    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    expect(add).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true });
    expect(add.mock.calls.some(([type]) => type === 'touchmove')).toBe(false);
  });

  it('coalesces scroll events and cancels pending frames on unmount', () => {
    cleanup = mountReportNavigation(root); flush();
    window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('scroll'));
    expect(jobs.size).toBe(1);
    cleanup(); cleanup = undefined;
    expect(jobs.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('scroll'));
    expect(jobs.size).toBe(0);
  });

  it('restores a valid report deep-link after authenticated content mounts', () => {
    const target = document.getElementById('checklist')!;
    target.scrollIntoView = vi.fn();
    window.history.replaceState(null, '', '/occupier-insights#checklist');
    cleanup = mountReportNavigation(root); flush();
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(window.location.hash).toBe('#checklist');
  });

  it('starts desktop chart motion only after the whole scene arrives', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('IntersectionObserver', class {
      observe() {} unobserve() {} disconnect() {}
    });
    const target = document.getElementById('factors')!;
    target.innerHTML = '<figure data-study data-reveal></figure>';
    root.querySelectorAll('section').forEach((section, index) => {
      vi.mocked(section.getBoundingClientRect).mockImplementation(() => rect(76 + index * 824 - scroll, 824));
    });
    cleanup = mountReportNavigation(root); flush();
    scroll = 600; window.dispatchEvent(new Event('scroll')); flush();
    expect(target.querySelector<HTMLElement>('figure')!.dataset.visible).toBeUndefined();
    scroll = 824; window.dispatchEvent(new Event('scroll')); flush();
    expect(target.querySelector<HTMLElement>('figure')!.dataset.visible).toBe('true');
    expect(target.dataset.entered).toBe('true');
    cleanup(); cleanup = undefined;
    expect(target.dataset.entered).toBeUndefined();
  });

  it('ignores malformed and unrelated hashes', () => {
    for (const hash of ['#%E0%A4%A', '#not-a-chapter']) {
      window.history.replaceState(null, '', `/occupier-insights${hash}`);
      expect(() => { cleanup = mountReportNavigation(root); flush(); cleanup(); cleanup = undefined; }).not.toThrow();
    }
  });

  it('works without ResizeObserver and clamps progress outside the document range', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    cleanup = mountReportNavigation(root);
    scroll = -50; flush();
    expect(root.querySelector<HTMLElement>('[data-reading-progress]')!.style.transform).toBe('scaleX(0)');
    scroll = 8000; window.dispatchEvent(new Event('scroll')); flush();
    expect(root.querySelector<HTMLElement>('[data-reading-progress]')!.style.transform).toBe('scaleX(1)');
  });
});
