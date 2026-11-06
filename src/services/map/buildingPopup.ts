export const BUILDING_POPUP = '.building-popup';
export const BUILDING_POPUP_LAYOUT_EVENT = 'map-building-popup-layout';

export function readBuildingPopupContext(element: Element) {
  const popup = element.closest<HTMLElement>(BUILDING_POPUP);
  const buildingId = popup?.dataset.buildingId;
  if (!popup || !buildingId) return null;
  return { buildingId, buildingName: popup.dataset.buildingName };
}

type LocalAction = 'close' | 'edit' | 'nearby' | 'trend' | 'contact';

export function bindBuildingPopup(root: HTMLElement, onAction: (action: LocalAction) => void) {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const fields = [...root.querySelectorAll<HTMLElement>('[data-popup-value]')];
  const tooltip = doc.createElement('div');
  tooltip.className = 'building-popup-tooltip';
  tooltip.id = 'map-building-popup-full-value';
  tooltip.setAttribute('role', 'tooltip');
  let active: HTMLButtonElement | null = null;
  let pinned = false;
  let leaveTimer: number | undefined;

  function hideValue() {
    view.clearTimeout(leaveTimer);
    active?.removeAttribute('aria-describedby');
    active?.setAttribute('aria-expanded', 'false');
    active = null;
    pinned = false;
    tooltip.remove();
  }

  function showValue(button: HTMLButtonElement, persist: boolean) {
    if (active !== button) hideValue();
    view.clearTimeout(leaveTimer);
    active = button;
    pinned = persist;
    tooltip.textContent = button.textContent;
    if (!tooltip.isConnected) doc.body.append(tooltip);
    button.setAttribute('aria-describedby', tooltip.id);
    button.setAttribute('aria-expanded', 'true');
    const anchor = button.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.max(12, Math.min(anchor.right - width, view.innerWidth - width - 12));
    const above = anchor.top - height - 4;
    const top = above >= 8 ? above : Math.min(anchor.bottom + 4, view.innerHeight - height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function scheduleHide() {
    view.clearTimeout(leaveTimer);
    if (!pinned) leaveTimer = view.setTimeout(hideValue, 160);
  }
  tooltip.addEventListener('pointerenter', () => view.clearTimeout(leaveTimer));
  tooltip.addEventListener('pointerleave', scheduleHide);

  for (const field of fields) {
    const label = field.querySelector<HTMLElement>('.building-popup__value')!;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'building-popup__reveal';
    button.hidden = true;
    button.setAttribute('aria-label', `查看${field.dataset.popupValue}完整内容`);
    button.setAttribute('aria-expanded', 'false');
    const text = label.cloneNode(true) as HTMLElement;
    text.removeAttribute('aria-hidden');
    text.textContent = '';
    button.append(text);
    field.append(button);
    button.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse') showValue(button, active === button && pinned);
    });
    button.addEventListener('pointerleave', event => {
      if (event.pointerType === 'mouse' && active === button) scheduleHide();
    });
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible')) showValue(button, false);
    });
    button.addEventListener('blur', () => {
      if (active === button && !pinned) hideValue();
    });
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (active === button && pinned) hideValue();
      else showValue(button, true);
    });
  }

  function refreshWidths() {
    for (const field of fields) {
      const label = field.querySelector<HTMLElement>('.building-popup__value')!;
      const button = field.querySelector<HTMLButtonElement>('.building-popup__reveal')!;
      const overflow = label.clientWidth > 0 && label.scrollWidth > label.clientWidth + 1;
      if (!overflow && active === button) hideValue();
      field.toggleAttribute('data-overflow', overflow);
      if (overflow) label.setAttribute('aria-hidden', 'true');
      else label.removeAttribute('aria-hidden');
      const buttonText = button.firstElementChild!;
      const value = overflow ? label.textContent : '';
      if (buttonText.textContent !== value) buttonText.textContent = value;
      button.hidden = !overflow;
    }
  }

  function click(event: MouseEvent) {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-popup-action]');
    if (!button) return;
    event.stopPropagation();
    hideValue();
    onAction(button.dataset.popupAction as LocalAction);
  }
  function dismissOutside(event: PointerEvent) {
    if (active && !active.contains(event.target as Node) && !tooltip.contains(event.target as Node)) hideValue();
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || (!active && !root.contains(event.target as Node))) return;
    // The edit sheet and other modal tasks own Escape even if their trigger still has focus.
    if (doc.querySelector('[aria-modal="true"], [data-building-metrics-edit], #__colliers_contact_modal_overlay')) return;
    event.preventDefault();
    event.stopPropagation();
    if (active) hideValue();
    else onAction('close');
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    refreshWidths();
    // A direct marker click has no map moveend. Notify the workbench when the
    // SDK's own wrapper has given the card a real layout.
    if (root.isConnected && entries?.some(entry => entry.target === root)) {
      root.dispatchEvent(new Event(BUILDING_POPUP_LAYOUT_EVENT, { bubbles: true }));
    }
  });
  observer?.observe(root);
  fields.forEach(field => observer?.observe(field));
  // Keep native map gesture handlers from treating card taps or inner scrolls as map clicks.
  const gestureEvents = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'touchmove', 'wheel'] as const;
  const stopMapGesture = (event: Event) => event.stopPropagation();
  gestureEvents.forEach(type => root.addEventListener(type, stopMapGesture, { passive: true }));
  root.addEventListener('click', click);
  doc.addEventListener('pointerdown', dismissOutside, true);
  doc.addEventListener('keydown', escape, true);
  doc.addEventListener('scroll', hideValue, true);
  view.addEventListener('resize', hideValue);
  refreshWidths();

  return {
    hideValue,
    dispose() {
      hideValue();
      observer?.disconnect();
      gestureEvents.forEach(type => root.removeEventListener(type, stopMapGesture));
      root.removeEventListener('click', click);
      doc.removeEventListener('pointerdown', dismissOutside, true);
      doc.removeEventListener('keydown', escape, true);
      doc.removeEventListener('scroll', hideValue, true);
      view.removeEventListener('resize', hideValue);
    },
  };
}
