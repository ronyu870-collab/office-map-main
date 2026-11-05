/** Observe native scrolling. No wheel/touch/key capture, no forced pagination. */
export function mountReportNavigation(root: HTMLElement): () => void {
  const header = root.querySelector<HTMLElement>('[data-report-header]');
  const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-report-chapter]'));
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-chapter-link]'));
  const progress = root.querySelector<HTMLElement>('[data-reading-progress]');
  const costSteps = Array.from(root.querySelectorAll<HTMLElement>('[data-cost-step]'));
  const charts = Array.from(root.querySelectorAll<HTMLElement>('[data-animate-chart]'));
  let frame: number | null = null;
  let disposed = false;
  let chartObserver: IntersectionObserver | null = null;
  const preference = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function configureMotion() {
    if (disposed) return;
    chartObserver?.disconnect();
    chartObserver = null;
    if (preference?.matches || typeof IntersectionObserver === 'undefined') {
      root.dataset.motion = 'reduce';
      charts.forEach(chart => { chart.dataset.revealed = 'true'; });
      return;
    }
    root.dataset.motion = 'on';
    chartObserver = new IntersectionObserver(entries => {
      if (disposed) return;
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.revealed = 'true';
          chartObserver?.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    charts.filter(chart => !chart.dataset.revealed).forEach(chart => chartObserver?.observe(chart));
  }
  configureMotion();
  preference?.addEventListener?.('change', configureMotion);
  function update() {
    frame = null;
    if (disposed) return;
    const headerHeight = header?.getBoundingClientRect().height || 76;
    root.style.setProperty('--report-header-height', `${headerHeight}px`);
    const readingLine = headerHeight + Math.max(48, (window.innerHeight - headerHeight) * .25);
    let active = 'cover';
    for (const chapter of chapters) if (chapter.getBoundingClientRect().top <= readingLine) active = chapter.dataset.reportChapter || 'cover';
    for (const link of links) {
      if (link.dataset.chapterLink === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    root.dataset.activeChapter = active;
    let costStep = '0';
    for (const step of costSteps) if (step.getBoundingClientRect().top <= readingLine + 80) costStep = step.dataset.costStep || '0';
    root.dataset.costStep = costStep;
    const box = root.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height - window.innerHeight)));
    if (progress) progress.style.transform = `scaleX(${fraction})`;
  }
  function schedule() { if (!disposed && frame === null) frame = window.requestAnimationFrame(update); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(root);
  if (header) observer?.observe(header);
  // Establish measured clearance before restoring a post-authentication deep link.
  root.style.setProperty('--report-header-height', `${header?.getBoundingClientRect().height || 76}px`);
  let hash = '';
  try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch { /* Ignore malformed hashes. */ }
  const target = chapters.find(chapter => chapter.id === hash);
  const anchorFrame = target ? window.requestAnimationFrame(() => {
    if (!disposed) { target.scrollIntoView({ block: 'start', behavior: 'instant' }); schedule(); }
  }) : null;
  schedule();
  return () => {
    disposed = true;
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', schedule);
    preference?.removeEventListener?.('change', configureMotion);
    observer?.disconnect();
    chartObserver?.disconnect();
    root.dataset.motion = 'reduce';
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (anchorFrame !== null) window.cancelAnimationFrame(anchorFrame);
  };
}
