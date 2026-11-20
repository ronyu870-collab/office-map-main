/** Resize the live SDK canvas without changing geographic zoom or recreating layers. */
export function observeMapCanvas(container: HTMLElement, map: { resize?: () => void; getCenter?: () => unknown; setCenter?: (center: any, immediately?: boolean) => void }) {
  let frame: number | null = null;
  let size = '';
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(() => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const rect = container.getBoundingClientRect();
      const next = `${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (!rect.width || !rect.height || size === next) return;
      size = next;
      const center = map.getCenter?.();
      map.resize?.();
      if (center) map.setCenter?.(center, true);
    });
  });
  observer.observe(container);
  return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
}
