/** Native document scrolling; this controller only observes, never captures wheel/touch. */
export function mountReportNavigation(root: HTMLElement): () => void {
  const header = root.querySelector<HTMLElement>('[data-report-header]');
  const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-report-chapter]'));
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-chapter-link]'));
  const progress = root.querySelector<HTMLElement>('[data-reading-progress]');
  let frame: number | null = null;
  let disposed = false;

  function update() {
    frame = null;
    if (disposed) return;
    const headerHeight = header?.getBoundingClientRect().height || 72;
    root.style.setProperty('--report-header-height', `${headerHeight}px`);
    const readingLine = headerHeight + Math.max(48, (window.innerHeight - headerHeight) * .25);
    let active = 'cover';
    for (const chapter of chapters) {
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

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
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
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', schedule);
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (anchorFrame !== null) window.cancelAnimationFrame(anchorFrame);
  };
}
