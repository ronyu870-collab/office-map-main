'use client';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog } from '@/src/components/ui/Dialog';

let closeActive: (() => void) | undefined;
export function closeBuildingContactDialog() { closeActive?.(); }

/** Keep the source visible; only explicit phone numbers become dial targets. */
function dialLinks(value: string) {
  const pattern = /(?<![\d+*])((?:\+86[ -]?)?(?:1[3-9]\d{9}|0\d{2,3}[ -]?\d{7,8}|[48]00[ -]?\d{3}[ -]?\d{4}|[2-9]\d{6,7})|\+[1-9]\d{6,14})(?:\s*(?:转|分机|ext\.?|x|#)\s*(\d{1,6}))?(?![\d*])/gi;
  const links = new Map<string, string>();
  for (const match of value.matchAll(pattern)) {
    const number = match[1].replace(/[^+\d]/g, '');
    const href = `tel:${number}${match[2] ? `;ext=${match[2]}` : ''}`;
    if (!links.has(href)) links.set(href, match[0].trim());
  }
  return [...links].map(([href, label]) => ({ href, label }));
}

function ContactContent({ phone, onDisplayed }: { phone: string; onDisplayed: () => void }) {
  useEffect(onDisplayed, [onDisplayed]);
  const value = phone.trim();
  return <div className="workspace-contact-content">
    {value ? <><dl className="workspace-contact-facts"><div><dt>联系电话</dt><dd>{value}</dd></div></dl>
      {dialLinks(value).map(({href,label}) => <a key={href} href={href} className="workspace-business-action">拨打 {label}</a>)}</> : <p className="workspace-note">暂无联系方式数据</p>}
  </div>;
}

/** Legacy SDK actions share the same dialog, focus and scroll rules as React workspace actions. */
export function mountBuildingContactDialog(name: string, phone: string, onDisplayed: () => void): () => void {
  closeActive?.();
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const host = document.createElement('div');
  host.id = '__colliers_contact_modal_overlay';
  document.body.appendChild(host);
  const root = createRoot(host);
  let active = true;
  const close = () => {
    if (!active) return;
    active = false;
    if (closeActive === close) closeActive = undefined;
    root.unmount();
    host.remove();
  };
  closeActive = close;
  root.render(<Dialog open onOpenChange={open => { if (!open) close(); }} size="sm" layer="map"
    title={<span className="workspace-contact-title">{name}</span>} description="联系方式" closeLabel="关闭联系方式" returnFocusTo={origin}>
    <ContactContent phone={phone} onDisplayed={onDisplayed} />
  </Dialog>);
  return close;
}
