/** Native document scrolling; this controller only observes, keeps wheel/touch passive and settles full desktop scenes after a gesture. */
export function mountReportNavigation(root: HTMLElement): () => void {
  const header = root.querySelector<HTMLElement>('[data-report-header]');
  const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-report-chapter]'));
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-chapter-link]'));
  const progress = root.querySelector<HTMLElement>('[data-reading-progress]');
  let frame: number | null = null;
  let disposed = false;
  const previousHeader = document.documentElement.style.getPropertyValue('--occupier-header');

  function update() {
    frame = null;
    if (disposed) return;
    const headerHeight = header?.getBoundingClientRect().height || 72;
    root.style.setProperty('--report-header-height', `${headerHeight}px`);
    document.documentElement.style.setProperty('--occupier-header', `${headerHeight}px`);
    const readingLine = headerHeight + Math.max(48, (window.innerHeight - headerHeight) * .25);
    let active = 'cover';
    for (const chapter of chapters) {
      const box = chapter.getBoundingClientRect();
      if (!prefersReducedMotion && box.bottom >= 0 && box.top <= window.innerHeight) {
        chapter.style.setProperty('--scene-offset', `${Math.max(-12, Math.min(12, (headerHeight - box.top) * .035))}px`);
      }
      // Fitting desktop scenes reveal after arrival, not while their edge is entering.
      // Oversized/mobile scenes reveal individual groups as the reader reaches them.
      const available = window.innerHeight - headerHeight;
      if (box.top <= headerHeight + 4 && box.bottom > headerHeight + available * .5 && !chapter.dataset.entered) {
        chapter.dataset.entered = 'true';
        if (window.innerWidth >= 1000 && box.height <= available + 3) {
          chapter.querySelectorAll<HTMLElement>('[data-reveal]').forEach(target => {
            target.dataset.visible = 'true';
            revealObserver?.unobserve(target);
          });
        }
      }
      if (chapter.getBoundingClientRect().top <= readingLine) active = chapter.dataset.reportChapter || 'cover';
    }
    for (const link of links) {
      if (link.dataset.chapterLink === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    root.dataset.activeChapter = active;
    const box = root.getBoundingClientRect();
    const distance = Math.max(1, box.height - window.innerHeight);
    const fraction = Math.min(1, Math.max(0, -box.top / distance));
    if (progress) progress.style.transform = `scaleX(${fraction})`;
  }

  function schedule() {
    if (!disposed && frame === null) frame = window.requestAnimationFrame(update);
  }

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  let snapping = false;
  let gestureStart = -1;
  let delta = 0;
  let lastWheel = 0;
  function cancelSettle() {
    clearTimeout(settleTimer);
    clearTimeout(animationTimer);
    gestureStart = -1;
    delta = 0;
    if (snapping) window.scrollTo({ top: window.scrollY, behavior: 'instant' });
    snapping = false;
  }
  function onWheel(event: WheelEvent) {
    if (window.innerWidth < 1000 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    if (window.getSelection()?.toString()) return;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest('input, textarea, select, [contenteditable="true"]')) return;
    // Nested scrollable controls own their gesture.
    for (let el = element; el && el !== root; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2) return;
    }
    const now = performance.now();
    const headerHeight = header?.getBoundingClientRect().height || 64;
    if (snapping) cancelSettle();
    if (gestureStart < 0 || now - lastWheel > 400) {
      gestureStart = chapters.reduce((best, chapter, index) =>
        Math.abs(chapter.getBoundingClientRect().top - headerHeight) <
        Math.abs(chapters[best].getBoundingClientRect().top - headerHeight) ? index : best, 0);
      delta = 0;
    }
    lastWheel = now;
    delta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
    clearTimeout(settleTimer);
    const start = gestureStart;
    if (!chapters[start] || chapters[start].getBoundingClientRect().height > window.innerHeight - headerHeight + 3) return;
    settleTimer = setTimeout(() => {
      if (disposed || window.getSelection()?.toString()) return;
      const step = Math.abs(delta) >= 40 ? Math.sign(delta) : 0;
      const destination = chapters[Math.max(0, Math.min(chapters.length - 1, start + step))];
      const top = Math.max(0, destination.getBoundingClientRect().top + window.scrollY - headerHeight);
      gestureStart = -1;
      delta = 0;
      snapping = true;
      window.scrollTo({ top, behavior: prefersReducedMotion ? 'instant' : 'smooth' });
      animationTimer = setTimeout(() => { snapping = false; }, 750);
    }, 160);
  }
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('pointerdown', cancelSettle, { passive: true });
  window.addEventListener('keydown', cancelSettle);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);

  // Progressive enhancement: every chart remains fully readable without JavaScript.
  const revealTargets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
  const prefersReducedMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealObserver = !prefersReducedMotion && typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const section = entry.target.closest('section');
          const available = window.innerHeight - (header?.getBoundingClientRect().height || 64);
          if (window.innerWidth >= 1000 && section && section.getBoundingClientRect().height <= available + 3) continue;
          (entry.target as HTMLElement).dataset.visible = 'true';
          revealObserver?.unobserve(entry.target);
        }
      }, { threshold: .3, rootMargin: '0px 0px -24px 0px' })
    : null;
  if (revealObserver) {
    root.dataset.animated = 'true';
    for (const target of revealTargets) revealObserver.observe(target);
  } else {
    for (const target of revealTargets) target.dataset.visible = 'true';
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(root);
  if (header) observer?.observe(header);

  // The authenticated report mounts after the browser's first hash-scroll attempt.
  // Restore only this report's known anchors, once, without changing URL/history.
  let hash = '';
  try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch { /* Ignore malformed hashes. */ }
  const target = chapters.find(chapter => chapter.id === hash);
  const anchorFrame = target ? window.requestAnimationFrame(() => {
    if (!disposed) {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      schedule();
    }
  }) : null;
  schedule();

  return () => {
    disposed = true;
    if (previousHeader) document.documentElement.style.setProperty('--occupier-header', previousHeader);
    else document.documentElement.style.removeProperty('--occupier-header');
    for (const chapter of chapters) {
      chapter.style.removeProperty('--scene-offset');
      delete chapter.dataset.entered;
    }
    cancelSettle();
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointerdown', cancelSettle);
    window.removeEventListener('keydown', cancelSettle);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', schedule);
    revealObserver?.disconnect();
    delete root.dataset.animated;
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (anchorFrame !== null) window.cancelAnimationFrame(anchorFrame);
  };
}
