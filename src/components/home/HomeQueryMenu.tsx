'use client';

import * as React from 'react';
import styles from './HomeQueryMenu.module.css';

type Props = {
  label: React.ReactNode; children: React.ReactNode; onOpen?: () => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
  ariaLabel?: string; disabled?: boolean; commandMenu?: boolean;
  triggerClassName?: string; historyId?: string;
};
const OPEN_EVENT = 'query-menu-open';

/** The native top layer removes ancestor clipping without moving DOM outside
 * the active workspace (inert, focus traps, React events and CSS still apply).
 * Only the open menu owns listeners/observers. Forms retain native semantics. */
export function HomeQueryMenu(props: Props) {
  const { label, children, ariaLabel, disabled, commandMenu, triggerClassName, historyId } = props;
  const [localOpen, setLocalOpen] = React.useState(false);
  const open = props.open ?? localOpen;
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const latest = React.useRef(props);
  const lastCommand = React.useRef(false);
  React.useLayoutEffect(() => { latest.current = props; });
  const change = React.useCallback((next: boolean, restore = false) => {
    if (restore && panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    setLocalOpen(next);
    latest.current.onOpenChange?.(next);
  }, []);
  const show = (last = false) => { lastCommand.current = last; if (!disabled) { latest.current.onOpen?.(); change(true); } };

  React.useLayoutEffect(() => {
    const node = panel.current, button = trigger.current, owner = root.current;
    if (!open || !node || !button || !owner) return;
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: owner }));
    // Browsers support Popover across the supported evergreen engines. The
    // inline fallback also keeps non-layout component tests usable.
    if (node.showPopover) { node.popover = 'manual'; node.showPopover(); }
    const workspace = owner.closest<HTMLElement>('#colliers-ai');
    const mode = workspace?.dataset.mode;
    const parent = owner.parentElement;
    let frame = 0;
    const close = (restore = true) => change(false, restore);
    const measure = () => {
      frame = 0;
      if (!node.showPopover) return; // Non-layout DOM environments have no Popover API.
      if (!button.isConnected || button.closest('[hidden], [inert]') || disabled
        || workspace?.dataset.mode !== mode || workspace?.dataset.transitioning === 'true'
        || owner.parentElement !== parent) { close(); return; }
      const viewport = window.visualViewport;
      const vLeft = viewport?.offsetLeft ?? 0, vTop = viewport?.offsetTop ?? 0;
      const box = workspace?.getBoundingClientRect();
      const left = Math.max(vLeft, box?.left ?? vLeft) + 8;
      const right = Math.min(vLeft + (viewport?.width ?? innerWidth), box?.right ?? Infinity) - 8;
      const top = Math.max(vTop, box?.top ?? vTop) + 8;
      const bottom = Math.min(vTop + (viewport?.height ?? innerHeight), box?.bottom ?? Infinity) - 8;
      const anchor = button.getBoundingClientRect();
      if (right <= left || bottom <= top || anchor.bottom < top || anchor.top > bottom) { close(); return; }
      const scrollTop = node.scrollTop, scrollLeft = node.scrollLeft;
      node.style.minWidth = `${Math.min(210, right - left)}px`;
      node.style.maxWidth = `${Math.min(320, right - left)}px`;
      // Measure intrinsic content after horizontal wrapping, unconstrained by
      // the previous placement's height. Border-box dimensions own positioning.
      node.style.maxHeight = `${bottom - top}px`;
      const height = Math.min(node.scrollHeight + node.offsetHeight - node.clientHeight, bottom - top);
      const below = Math.max(0, bottom - anchor.bottom - 4), above = Math.max(0, anchor.top - top - 4);
      const upwards = below < height && above > below;
      const available = upwards ? above : below;
      if (available < 1) { close(); return; }
      node.style.maxHeight = `${Math.min(360, available)}px`;
      const actual = node.getBoundingClientRect();
      node.style.left = `${Math.max(left, Math.min(anchor.right - actual.width, right - actual.width))}px`;
      node.style.top = `${upwards ? anchor.top - 4 - actual.height : anchor.bottom + 4}px`;
      node.dataset.placement = upwards ? 'above' : 'below';
      // Intrinsic sizing temporarily expands the scrollport and can clamp its
      // offset. Preserve the user’s position across observer-driven placement.
      node.scrollTop = scrollTop; node.scrollLeft = scrollLeft;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !owner.contains(event.target)) close(false); };
    const another = (event: Event) => { if ((event as CustomEvent).detail !== owner) close(false); };
    const focusout = (event: FocusEvent) => { if (event.relatedTarget instanceof Node && !owner.contains(event.relatedTarget)) close(false); };
    // Native bubble handling precedes the detail panel's native listener, even
    // for content living inside its stable portal host.
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (!commandMenu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const items = Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      const item = items[next];
      item?.focus({ preventScroll: true });
      if (item) {
        const target = item.getBoundingClientRect(), bounds = node.getBoundingClientRect();
        if (target.bottom > bounds.bottom) node.scrollTop += target.bottom - bounds.bottom;
        else if (target.top < bounds.top) node.scrollTop += target.top - bounds.top;
      }
    };
    // Focus/scrollIntoView can queue a scroll event before the opening click.
    // Compare positions captured at open, so that old event cannot dismiss the
    // new menu; only a subsequent movement of its own anchor path does.
    const scrollPositions = new Map<Element, { top: number; left: number }>();
    const scroll = (event: Event) => {
      const target = event.target === document ? document.scrollingElement : event.target;
      if (!(target instanceof Element)) return;
      const previous = scrollPositions.get(target);
      if (previous && (Math.abs(previous.top - target.scrollTop) > .5 || Math.abs(previous.left - target.scrollLeft) > .5)) {
        const anchor = button.getBoundingClientRect();
        // Nested restoration/scroll anchoring can compensate offsets without
        // moving the trigger. Dismiss only when its visible position changes.
        if (Math.abs(anchor.top - scrollAnchor.top) > .5 || Math.abs(anchor.left - scrollAnchor.left) > .5) close();
        else scrollPositions.set(target, { top: target.scrollTop, left: target.scrollLeft });
      }
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(node); observer?.observe(button); if (workspace) observer?.observe(workspace);
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      if (button.closest('[hidden], [inert]') || workspace?.dataset.mode !== mode || workspace?.dataset.transitioning === 'true' || owner.parentElement !== parent) close();
    });
    if (workspace) mutations?.observe(workspace, { attributes: true, subtree: true, attributeFilter: ['hidden', 'inert', 'data-mode', 'data-transitioning'] });
    measure();
    // Initial popover placement can itself flush nested scroll restoration.
    // Capture both the anchor and offsets from that same, placed layout.
    const scrollAnchor = button.getBoundingClientRect();
    for (let ancestor = owner.parentElement; ancestor; ancestor = ancestor.parentElement) {
      scrollPositions.set(ancestor, { top: ancestor.scrollTop, left: ancestor.scrollLeft });
    }
    if (commandMenu) {
      const commands = node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      commands[lastCommand.current ? commands.length - 1 : 0]?.focus({ preventScroll: true });
    }
    owner.addEventListener('keydown', keydown);
    owner.addEventListener('focusout', focusout);
    document.addEventListener('pointerdown', outside);
    document.addEventListener(OPEN_EVENT, another);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', schedule);
    viewportEvents('addEventListener');
    function viewportEvents(method: 'addEventListener' | 'removeEventListener') {
      window.visualViewport?.[method]('resize', schedule);
      window.visualViewport?.[method]('scroll', schedule);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect(); mutations?.disconnect();
      if (node.hidePopover && node.matches(':popover-open')) node.hidePopover();
      node.removeAttribute('popover');
      owner.removeEventListener('keydown', keydown); owner.removeEventListener('focusout', focusout);
      document.removeEventListener('pointerdown', outside); document.removeEventListener(OPEN_EVENT, another);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', schedule);
      viewportEvents('removeEventListener');
    };
  }, [open, disabled, commandMenu, change]);

  return <div ref={root} className={styles.menu} data-query-menu>
    <button ref={trigger} id={`${id}-trigger`} type="button" className={`${styles.trigger} ${triggerClassName ?? ''}`}
      aria-label={ariaLabel} disabled={disabled} data-history-actions={historyId}
      aria-expanded={open} aria-controls={id} aria-haspopup={commandMenu ? 'menu' : undefined}
      onClick={() => open ? change(false) : show()}
      onKeyDown={event => {
        if (commandMenu && !open && !event.nativeEvent.isComposing && event.keyCode !== 229 && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(event.key === 'ArrowUp'); }
      }}>{label}</button>
    <div ref={panel} id={id} className={styles.body} hidden={!open} data-query-menu-panel
      role={commandMenu ? 'menu' : 'group'} aria-label={commandMenu ? ariaLabel : undefined} aria-labelledby={commandMenu ? undefined : `${id}-trigger`}
      onClick={event => {
        const action = event.target instanceof Element ? event.target.closest('button') : null;
        if (action && !action.disabled && !action.hasAttribute('data-menu-keep-open')) change(false, true);
      }}>{children}</div>
  </div>;
}

/** Menus keep their DOM mounted; return flows must focus the visible trigger. */
export function queryActionFocus(action: HTMLElement | null) {
  const menu = action?.closest('[data-query-menu-panel]');
  const destination = menu?.hasAttribute('hidden') ? menu.parentElement?.querySelector<HTMLElement>('[aria-expanded]') : action;
  destination?.focus({ preventScroll: true });
}
