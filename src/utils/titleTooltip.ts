/** Native HTML adapter for the shared tooltip surface. Owns only its container's
 * listeners; callers dispose it on rerender/unmount. React icons use Tooltip. */
let tooltipEl: HTMLDivElement | null = null;
let lastDismissed = -Infinity;

function ensureTooltip(): HTMLDivElement {
  if (tooltipEl?.isConnected) return tooltipEl;
  const el = document.createElement('div');
  el.setAttribute('role', 'tooltip');
  el.style.cssText = 'position:fixed;inset:auto;margin:0;pointer-events:none;' +
    'padding:6px 10px;border:1px solid transparent;border-radius:var(--cd-radius-md);' +
    'font-size:var(--cd-font-size-md);line-height:1.5;color:var(--cd-color-surface);' +
    'background:var(--cd-color-tooltip);max-width:min(280px,calc(100vw - 16px));' +
    'overflow-wrap:anywhere;box-shadow:var(--cd-shadow-panel);display:none;';
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

export function attachTitleTooltip(container: HTMLElement): () => void {
  const targets = Array.from(container.querySelectorAll<HTMLElement>('[title]'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | null = null;
  const listeners: (() => void)[] = [];
  const hide = () => {
    clearTimeout(timer);
    if (!shown) return;
    lastDismissed = Date.now(); shown = null;
    if (tooltipEl) {
      if (tooltipEl.hidePopover && tooltipEl.matches(':popover-open')) tooltipEl.hidePopover();
      tooltipEl.style.display = 'none';
    }
    document.removeEventListener('keydown', escape, true);
    document.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
    window.visualViewport?.removeEventListener('resize', hide);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.isComposing) hide();
  };
  for (const target of targets) {
    const text = target.getAttribute('title');
    if (!text) continue;
    target.removeAttribute('title');
    target.setAttribute('data-tooltip', text);
    const show = () => {
      if (!target.isConnected) return;
      const el = ensureTooltip();
      shown = target; el.textContent = text; el.style.display = 'block';
      if (el.showPopover) { el.popover = 'manual'; el.showPopover(); }
      const box = target.getBoundingClientRect(), size = el.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      el.style.left = `${Math.max(left + 8, Math.min(box.left, left + width - size.width - 8))}px`;
      el.style.top = `${Math.max(top + 8, Math.min(box.top - size.height - 8 >= top + 8 ? box.top - size.height - 8 : box.bottom + 8, top + height - size.height - 8))}px`;
      document.addEventListener('keydown', escape, true);
      document.addEventListener('scroll', hide, true);
      window.addEventListener('resize', hide);
      window.visualViewport?.addEventListener('resize', hide);
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      clearTimeout(timer);
      if (Date.now() - lastDismissed < 600) show(); else timer = setTimeout(show, 450);
    };
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', hide);
    target.addEventListener('focus', show);
    target.addEventListener('blur', hide);
    target.addEventListener('pointerdown', hide);
    listeners.push(() => {
      target.removeEventListener('pointerenter', enter); target.removeEventListener('pointerleave', hide);
      target.removeEventListener('focus', show); target.removeEventListener('blur', hide); target.removeEventListener('pointerdown', hide);
      if (!target.hasAttribute('title')) target.setAttribute('title', text);
      target.removeAttribute('data-tooltip');
    });
  }
  return () => { hide(); listeners.forEach(dispose => dispose()); };
}
