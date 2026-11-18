'use client';

import * as React from 'react';

type ReadingPosition = { top: number; key?: string; offset?: number };
export type QueryWorkspaceMode = 'compact' | 'focus' | 'expanded';
type Transition = { from: DOMRect; radius: string; composer?: DOMRect; editor?: DOMRect;
  reading: ReadingPosition; mode: QueryWorkspaceMode; ticket: number };
const DURATION = 300;

function resizeEditor(node: HTMLTextAreaElement | null, mode: QueryWorkspaceMode) {
  if (!node) return;
  node.style.height = 'auto';
  node.style.height = `${Math.max(mode === 'compact' ? 28 : 56, Math.min(node.scrollHeight, 200))}px`;
}

function readPosition(node: HTMLDivElement | null): ReadingPosition {
  if (!node) return { top: 0 };
  const top = node.getBoundingClientRect().top;
  const message = Array.from(node.querySelectorAll<HTMLElement>('[data-query-turn]'))
    .find(item => item.getBoundingClientRect().bottom > top + 1);
  return { top: node.scrollTop, key: message?.dataset.queryTurn,
    offset: message ? message.getBoundingClientRect().top - top : undefined };
}

function restorePosition(node: HTMLDivElement | null, position: ReadingPosition) {
  if (!node) return;
  const message = position.key && Array.from(node.querySelectorAll<HTMLElement>('[data-query-turn]'))
    .find(item => item.dataset.queryTurn === position.key);
  node.scrollTop = message && position.offset !== undefined
    ? node.scrollTop + message.getBoundingClientRect().top - node.getBoundingClientRect().top - position.offset
    : position.top;
}

function visibleControls(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(
    ':is(button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"]))',
  )).filter(node => {
    if (node.closest('[hidden], [inert], details:not([open]) > :not(summary)')) return false;
    // Keyboard-sized viewports hide the auxiliary footer with CSS. A child can
    // still report display:list-item inside a display:none ancestor.
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (current === surface) break;
    }
    return true;
  });
}

/** A single DOM/React tree changes its bounds. No portal, router, query or session
 * key participates in a mode switch. The placeholder preserves the homepage. */
export function useQueryWorkspace(composingRef: React.RefObject<boolean>) {
  const anchor = React.useRef<HTMLDivElement>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const toggle = React.useRef<HTMLButtonElement>(null);
  const composer = React.useRef<HTMLDivElement>(null);
  const composerSlot = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<{ mode: QueryWorkspaceMode; ticket: number }>({ mode: 'compact', ticket: 0 });
  const mode = state.mode;
  const [floating, setFloating] = React.useState(false);
  const [transitioning, setTransitioning] = React.useState(false);
  const animation = React.useRef<Animation | null>(null);
  const composerAnimation = React.useRef<Animation | null>(null);
  const editorAnimation = React.useRef<Animation | null>(null);
  const releaseComposer = React.useRef<(() => void) | null>(null);
  const pending = React.useRef<Transition | null>(null);
  const ticket = React.useRef(0);
  const modeRef = React.useRef<QueryWorkspaceMode>('compact');
  const floatingRef = React.useRef(false);
  const lockedScroll = React.useRef<Array<{ node: HTMLElement; top: number; left: number }>>([]);
  const reading = React.useRef<ReadingPosition | null>(null);
  const surfaceComposition = React.useRef<HTMLElement | null>(null);
  const clearComposition = React.useCallback(() => { surfaceComposition.current = null; }, []);

  React.useEffect(() => {
    const node = surface.current;
    const start = (event: CompositionEvent) => { surfaceComposition.current = event.target instanceof HTMLElement ? event.target : null; };
    const end = () => { surfaceComposition.current = null; };
    const blur = (event: FocusEvent) => { if (surfaceComposition.current === event.target) surfaceComposition.current = null; };
    node?.addEventListener('compositionstart', start);
    node?.addEventListener('compositionend', end);
    node?.addEventListener('focusout', blur);
    return () => {
      node?.removeEventListener('compositionstart', start);
      node?.removeEventListener('compositionend', end);
      node?.removeEventListener('focusout', blur);
    };
  }, []);

  const syncViewport = React.useCallback(() => {
    const node = surface.current;
    if (!node) return;
    const viewport = window.visualViewport;
    // VisualViewport getters can synchronously flush layout. Read one fresh
    // snapshot before writing inherited CSS variables, including on resize.
    const top = viewport?.offsetTop ?? 0, left = viewport?.offsetLeft ?? 0;
    const height = viewport?.height ?? window.innerHeight;
    const width = viewport?.width ?? (document.documentElement.clientWidth || window.innerWidth);
    node.style.setProperty('--query-viewport-top', `${top}px`);
    node.style.setProperty('--query-viewport-left', `${left}px`);
    node.style.setProperty('--query-viewport-height', `${height}px`);
    node.style.setProperty('--query-viewport-width', `${width}px`);
    node.dataset.viewportCompact = String(height < 500);
  }, []);

  const change = React.useCallback((next: QueryWorkspaceMode) => {
    const node = surface.current, placeholder = anchor.current;
    if (!node || !placeholder || modeRef.current === next) return;
    // A sidebar editor would become hidden on collapse. Let its native IME
    // finish before allowing that action; the main composer stays in every mode.
    if (next === 'compact' && surfaceComposition.current?.isConnected
      && !composer.current?.contains(surfaceComposition.current)) return;
    // Keyboard panning can change a locked ancestor's programmatic scroll.
    // Restore it BEFORE measuring the return destination, not after the last
    // animation frame (which would otherwise produce a second jump).
    if (next === 'compact') lockedScroll.current.forEach(item => {
      item.node.scrollTop = item.top; item.node.scrollLeft = item.left;
    });
    const from = node.getBoundingClientRect();
    const composerFrom = composer.current?.getBoundingClientRect();
    const editorFrom = composer.current?.querySelector('textarea')?.getBoundingClientRect();
    const radius = getComputedStyle(node).borderRadius;
    const position = readPosition(scroller.current);
    // Read the homepage anchor before changing its height. The first expanded
    // layout should not force an extra synchronous layout between these writes.
    const origin = placeholder.getBoundingClientRect();
    syncViewport();
    ticket.current++;
    animation.current?.cancel(); animation.current = null;
    composerAnimation.current?.cancel(); composerAnimation.current = null;
    editorAnimation.current?.cancel(); editorAnimation.current = null;
    releaseComposer.current?.(); releaseComposer.current = null;
    if (!floatingRef.current) placeholder.style.height = `${from.height}px`;
    node.style.setProperty('--query-compact-top', `${origin.top}px`);
    node.style.setProperty('--query-compact-left', `${origin.left}px`);
    node.style.setProperty('--query-compact-width', `${origin.width || from.width}px`);
    pending.current = { from, radius, composer: composerFrom, editor: editorFrom, reading: position, mode: next, ticket: ticket.current };
    reading.current = position;
    modeRef.current = next; floatingRef.current = true;
    setFloating(true); setTransitioning(true); setState({ mode: next, ticket: ticket.current });
  }, [syncViewport]);
  const focus = React.useCallback(() => change('focus'), [change]);
  const expand = React.useCallback(() => change('expanded'), [change]);
  const collapse = React.useCallback(() => change('compact'), [change]);

  React.useLayoutEffect(() => {
    const transition = pending.current, node = surface.current;
    if (!transition || !node) return;
    pending.current = null;
    const editor = composer.current?.querySelector('textarea') ?? null;
    resizeEditor(editor, mode);
    const destination = node.getBoundingClientRect();
    const destinationRadius = getComputedStyle(node).borderRadius;
    restorePosition(scroller.current, transition.reading);
    if (mode === 'compact' && anchor.current) anchor.current.style.height = `${destination.height}px`;
    const finish = () => {
      if (transition.ticket !== ticket.current) return;
      animation.current = null;
      composerAnimation.current?.cancel(); composerAnimation.current = null;
      editorAnimation.current?.cancel(); editorAnimation.current = null;
      releaseComposer.current?.(); releaseComposer.current = null;
      resizeEditor(editor, transition.mode);
      restorePosition(scroller.current, transition.reading); reading.current = null;
      setTransitioning(false);
      if (transition.mode === 'compact') {
        floatingRef.current = false;
        setFloating(false);
        if (anchor.current) anchor.current.style.height = '';
        // An IME owns focus until composition has finished.
        if (!composingRef.current && !surfaceComposition.current?.isConnected) toggle.current?.focus({ preventScroll: true });
      } else if (!node.contains(document.activeElement)) toggle.current?.focus({ preventScroll: true });
    };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!node.animate || reduced || transition.from.width === 0) {
      // No animation support/reduced motion still uses exactly the same tree.
      finish();
      return;
    }
    const bounds = (rect: DOMRect) => ({ top: `${rect.top}px`, left: `${rect.left}px`,
      width: `${rect.width}px`, height: `${rect.height}px` });
    const timing = { duration: DURATION, easing: 'cubic-bezier(.22, 1, .36, 1)' };
    const inputSurface = composer.current, slot = composerSlot.current;
    if (inputSurface?.animate && slot && transition.composer?.width) {
      const target = inputSurface.getBoundingClientRect();
      const targetEditor = editor?.getBoundingClientRect();
      const style = getComputedStyle(inputSurface);
      const padding = { paddingTop: style.paddingTop, paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft };
      const context = editor?.previousElementSibling;
      const contextHeight = context ? context.getBoundingClientRect().bottom - target.top
        - (Number.parseFloat(style.paddingTop) || 0) - 1 + (Number.parseFloat(getComputedStyle(context).marginBottom) || 0) : 0;
      const previousStyle = inputSurface.style.cssText, previousHeight = slot.style.height;
      const previousMinHeight = editor?.style.minHeight, previousShrink = editor?.style.flexShrink;
      // Reserve its final layout, then move the SAME composer independently of
      // the shell's flex reflow. Fixed bounds avoid text/caret scaling and the
      // initial jump that a shell-only animation causes. No cloning or portals.
      slot.style.height = `${target.height}px`;
      Object.assign(inputSurface.style, { position: 'fixed', margin: '0', zIndex: '1',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', ...bounds(target) });
      releaseComposer.current = () => {
        inputSurface.style.cssText = previousStyle; slot.style.height = previousHeight;
        if (editor) { editor.style.minHeight = previousMinHeight ?? ''; editor.style.flexShrink = previousShrink ?? ''; }
      };
      // During the grid-to-column reflow, measured editor insets also preserve
      // the text/caret origin. On completion the ordinary CSS owns layout again.
      const editorInsets = (box: DOMRect, field?: DOMRect) => field ? {
        paddingTop: `${Math.max(0, field.top - box.top - contextHeight - 1)}px`,
        paddingLeft: `${Math.max(0, field.left - box.left - 1)}px`,
        paddingRight: `${Math.max(0, box.right - field.right - 1)}px`,
      } : {};
      const inputMotion = inputSurface.animate([
        { ...bounds(transition.composer), ...padding, ...editorInsets(transition.composer, transition.editor) },
        { ...bounds(target), ...padding, ...editorInsets(target, targetEditor) },
      ], timing);
      composerAnimation.current = inputMotion;
      // Cancellation on reversal, resize or unmount is expected.
      void inputMotion.finished.catch(() => {});
      if (editor?.animate && transition.editor && targetEditor) {
        editor.style.minHeight = '0'; editor.style.flexShrink = '0';
        const fieldMotion = editor.animate([
          { height: `${transition.editor.height}px` }, { height: `${targetEditor.height}px` },
        ], timing);
        editorAnimation.current = fieldMotion;
        void fieldMotion.finished.catch(() => {});
      }
    }
    const motion = node.animate([
      { ...bounds(transition.from), borderRadius: transition.radius },
      { ...bounds(destination), borderRadius: destinationRadius },
    ], timing);
    animation.current = motion;
    void motion.finished.then(finish, () => { /* Reversal/unmount owns the next state. */ });
  }, [state, mode, composingRef]);

  React.useEffect(() => {
    if (!floating) return;
    const viewport = window.visualViewport;
    const resize = () => {
      syncViewport();
      // A keyboard/rotation resize cancels only the geometry animation.
      // Its completion callback still releases the placeholder on collapse.
      composerAnimation.current?.finish();
      editorAnimation.current?.finish();
      animation.current?.finish();
    };
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => {
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
    };
  }, [floating, syncViewport]);

  React.useLayoutEffect(() => {
    if (!floating || !surface.current) return;
    const node = surface.current;
    const outside: Array<{ node: HTMLElement; inert: boolean }> = [];
    const scrollContainers: Array<{ node: HTMLElement; overflow: string; gutter: string; reserveGutter: boolean; top: number; left: number }> = [];
    // Collect style reads before mutating the ancestor path, so first expansion
    // does not alternate inert/overflow writes with computed-style reads.
    // Background isolation still finishes in this same layout effect.
    // Inert only siblings of our ancestor path, never an ancestor of the editor.
    let branch: HTMLElement = node;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          outside.push({ node: sibling, inert: sibling.inert });
        }
      }
      const parentStyle = getComputedStyle(parent);
      if (/(auto|scroll)/.test(parentStyle.overflowY) || parent === document.body) {
        const borders = (Number.parseFloat(parentStyle.borderLeftWidth) || 0) + (Number.parseFloat(parentStyle.borderRightWidth) || 0);
        scrollContainers.push({ node: parent, overflow: parent.style.overflow, gutter: parent.style.scrollbarGutter,
          reserveGutter: parent.offsetWidth - parent.clientWidth - borders > 1,
          top: parent.scrollTop, left: parent.scrollLeft });
      }
      branch = parent;
      if (parent === document.body) break;
    }
    outside.forEach(item => { item.node.inert = true; });
    lockedScroll.current = scrollContainers;
    scrollContainers.forEach(item => {
      if (item.reserveGutter) item.node.style.scrollbarGutter = 'stable';
      item.node.style.setProperty('overflow', 'hidden');
    });
    const keydown = (event: KeyboardEvent) => {
      const activeComposition = surfaceComposition.current;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || composingRef.current
        || (activeComposition?.isConnected && node.contains(activeComposition))) return;
      if (event.key === 'Escape') { event.preventDefault(); collapse(); return; }
      if (event.key !== 'Tab') return;
      const controls = visibleControls(node);
      event.preventDefault();
      if (!controls.length) { node.focus({ preventScroll: true }); return; }
      // Traverse the rendered controls in document order, including when a
      // responsive panel/keyboard has just hidden the previously focused item.
      const active = document.activeElement;
      const index = controls.indexOf(active as HTMLElement);
      let next: HTMLElement;
      if (index >= 0) next = controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length];
      else {
        // Source and summary panels receive programmatic focus with tabIndex=-1.
        // Continue beside that reading position, including the panel's children.
        const ordered = event.shiftKey ? [...controls].reverse() : controls;
        const direction = event.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
        next = (active && node.contains(active)
          ? ordered.find(control => active.compareDocumentPosition(control) & direction) : undefined) ?? ordered[0];
      }
      // Let the browser reveal a target inside a long answer/history scroller.
      // Suppressing scrolling here would leave a valid keyboard focus offscreen.
      next.focus();
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !node.contains(event.target)) toggle.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keydown); document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin);
      outside.forEach(item => { item.node.inert = item.inert; });
      scrollContainers.forEach(item => {
        item.node.style.overflow = item.overflow;
        item.node.style.scrollbarGutter = item.gutter;
        item.node.scrollTop = item.top; item.node.scrollLeft = item.left;
      });
      lockedScroll.current = [];
    };
  }, [floating, collapse, composingRef]);

  React.useEffect(() => () => {
    ticket.current++; animation.current?.cancel(); composerAnimation.current?.cancel(); editorAnimation.current?.cancel(); releaseComposer.current?.();
  }, []);
  const preserveReading = React.useCallback(() => {
    if (reading.current) restorePosition(scroller.current, reading.current);
  }, []);
  return { anchor, surface, scroller, toggle, composer, composerSlot, mode, expanded: mode !== 'compact',
    floating, transitioning, focus, expand, collapse, preserveReading, clearComposition };
}

/** Follow results only while the reader is at the end. Layout-only changes do
 * not manufacture new messages or move a reader who is reviewing older turns. */
export function useQueryScroll(scrollerRef: React.RefObject<HTMLDivElement | null>, update: unknown, transitioning: boolean) {
  const following = React.useRef(true);
  const [unseen, setUnseen] = React.useState(false);
  const deferredUpdate = React.useRef(false);
  const transitionRef = React.useRef(transitioning);
  React.useLayoutEffect(() => { transitionRef.current = transitioning; }, [transitioning]);
  const toLatest = React.useCallback(() => {
    following.current = true; setUnseen(false);
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [scrollerRef]);
  const onScroll = React.useCallback(() => {
    if (transitionRef.current) return;
    const node = scrollerRef.current;
    if (!node) return;
    following.current = node.scrollHeight - node.clientHeight - node.scrollTop < 72;
    if (following.current) setUnseen(false);
  }, [scrollerRef]);
  React.useLayoutEffect(() => {
    if (transitionRef.current) { deferredUpdate.current = true; return; }
    if (following.current) toLatest();
    else setUnseen(true);
  }, [update, toLatest]);
  React.useLayoutEffect(() => {
    if (transitioning || !deferredUpdate.current) return;
    deferredUpdate.current = false;
    if (following.current) toLatest();
    else setUnseen(true);
  }, [transitioning, toLatest]);
  const followNext = React.useCallback(() => { following.current = true; setUnseen(false); }, []);
  return { onScroll, toLatest, followNext, unseen };
}
