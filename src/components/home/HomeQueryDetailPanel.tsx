'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/src/components/ui/Button';
import { panelControls } from './useQueryPanelLayout';
import styles from './HomeQueryDetailPanel.module.css';

type Selection = { id: string; title: string; returnFocus: () => void };
type DetailContext = { active: Selection | null; target: HTMLDivElement | null;
  open: (id: string, title: string, trigger: HTMLElement) => void; close: () => void;
  setTarget: (node: HTMLDivElement | null) => void; onOpen: (callback: () => void) => () => void };
const Context = React.createContext<DetailContext | null>(null);
export function HomeQueryDetailProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<Selection | null>(null);
  const [target, setTarget] = React.useState<HTMLDivElement | null>(null);
  const listeners = React.useRef(new Set<() => void>());
  const onOpen = React.useCallback((callback: () => void) => {
    listeners.current.add(callback);
    return () => { listeners.current.delete(callback); };
  }, []);
  const open = React.useCallback((id: string, title: string, trigger: HTMLElement) => {
    const label = trigger.getAttribute('aria-label'), text = trigger.textContent;
    const owner = trigger.closest('[data-result-id]')?.getAttribute('data-result-id');
    const returnFocus = () => {
      if (trigger.isConnected && !trigger.closest('[hidden], [inert]')) { trigger.focus({ preventScroll: true }); return; }
      const scope = owner ? Array.from(document.querySelectorAll('[data-result-id]')).find(node => node.getAttribute('data-result-id') === owner) : document;
      const replacement = Array.from(scope?.querySelectorAll<HTMLElement>('button, summary') ?? []).find(node =>
        !node.closest('[hidden], [inert]') && (label ? node.getAttribute('aria-label') === label : node.textContent === text));
      replacement?.focus({ preventScroll: true });
    };
    listeners.current.forEach(callback => callback());
    setActive({ id, title, returnFocus });
  }, []);
  const previous = React.useRef<Selection | null>(null);
  React.useLayoutEffect(() => {
    if (!active) previous.current?.returnFocus();
    previous.current = active;
  }, [active]);
  const close = React.useCallback(() => setActive(null), []);
  const value = React.useMemo(() => ({ active, target, open, close, setTarget, onOpen }), [active, target, open, close, onOpen]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useQueryDetail = () => React.useContext(Context);

/** One shared workspace slot for sources, tables and charts. All content is
 * supplied from the current immutable result; opening a panel never fetches. */
export function HomeQueryDetailPanel({ drawer }: { drawer: boolean }) {
  const detail = useQueryDetail();
  const panel = React.useRef<HTMLElement>(null);
  const titleId = React.useId();
  const activeId = detail?.active?.id;
  const close = detail?.close;
  const setTarget = detail?.setTarget;
  const targetRef = React.useCallback((node: HTMLDivElement | null) => setTarget?.(node), [setTarget]);
  React.useLayoutEffect(() => {
    const node = panel.current;
    if (!activeId || !node || !close) return;
    (node.querySelector<HTMLElement>('[data-detail-autofocus]') ?? node).focus({ preventScroll: true });
    // Portal events follow the React parent tree, not the physical aside.
    // Handle keyboard containment on the actual panel DOM for every artifact.
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        const menu = event.target instanceof Element ? event.target.closest('details[open]') : null;
        event.preventDefault(); event.stopPropagation();
        if (menu instanceof HTMLDetailsElement) { menu.open = false; menu.querySelector('summary')?.focus(); }
        else close();
      }
      if (drawer && event.key === 'Tab') {
        const controls = panelControls(node), focused = document.activeElement as HTMLElement;
        const index = controls.indexOf(focused);
        event.preventDefault(); event.stopPropagation();
        const next = index >= 0 ? controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]
          : event.shiftKey ? [...controls].reverse().find(control => !!(focused.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING)) ?? controls.at(-1)
            : controls.find(control => !!(focused.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? controls[0];
        (next ?? node).focus();
      }
    };
    node.addEventListener('keydown', keydown);
    return () => node.removeEventListener('keydown', keydown);
  }, [activeId, drawer, close]);
  if (!detail) return null;
  return <aside ref={panel} className={styles.panel} hidden={!detail.active} data-drawer={drawer}
    role={drawer ? 'dialog' : 'region'} aria-modal={drawer || undefined} aria-labelledby={titleId} tabIndex={-1}
    >
    <header><h3 id={titleId}>{detail.active?.title}</h3><Button variant="ghost" onClick={detail.close}>返回对话</Button></header>
    <div className={styles.content} ref={targetRef} />
  </aside>;
}

/** View state belongs to the caller, outside this switch, so returning from
 * the workspace retains filters, selection, pagination and chart settings. */
export function HomeQueryDetailContent({ id, children }: { id: string; children: React.ReactNode }) {
  const detail = useQueryDetail();
  const placeholder = React.useRef<HTMLDivElement>(null);
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const expanded = detail?.active?.id === id;
  const target = detail?.target;
  const mount = React.useCallback((node: HTMLDivElement | null) => {
    placeholder.current = node;
    if (node) setHost(current => current ?? document.createElement('div'));
  }, []);
  React.useLayoutEffect(() => () => host?.remove(), [host]);
  React.useLayoutEffect(() => {
    // React owns the portal children. Only its empty host is moved between two
    // slots; the portal target never changes, so nested state, pending downloads,
    // scroll positions and chart instances all survive workspace transitions.
    const destination = expanded && target ? target : placeholder.current;
    if (host && destination && host.parentElement !== destination) {
      destination.appendChild(host);
      // Source content is mounted only after an explicit evidence action;
      // this also supports the inline fallback without a workspace provider.
      host.querySelector<HTMLElement>('[data-detail-autofocus]')?.focus({ preventScroll: true });
    }
  }, [expanded, target, host]);
  return <><div ref={mount} hidden={expanded && !!target} />{host && createPortal(children, host)}</>;
}
