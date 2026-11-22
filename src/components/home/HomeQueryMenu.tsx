'use client';
import * as React from 'react';
import styles from './HomeQueryMenu.module.css';
/** A lightweight native disclosure with consistent dismissal and focus rules. */
export function HomeQueryMenu({ label, children, onOpen }: { label: React.ReactNode; children: React.ReactNode; onOpen?: () => void }) {
  const root = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const outside = (event: PointerEvent) => { if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <details ref={root} className={styles.menu} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus();
  }}>
    <summary onClick={() => { if (!root.current?.open) onOpen?.(); }}>{label}</summary>
    <div className={styles.body}>{children}</div>
  </details>;
}
