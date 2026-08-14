/**
 * 单例 title tooltip —— 替代浏览器原生 title 属性，消除 ~400ms 延迟。
 *
 * 用法：
 *   import { attachTitleTooltip } from '@/src/utils/titleTooltip';
 *   // InfoWindow open 后
 *   attachTitleTooltip(containerDiv);
 */

let tooltipEl: HTMLDivElement | null = null;

function ensureTooltip(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;z-index:99999;pointer-events:none;' +
    'padding:4px 8px;border-radius:4px;font-size:11px;line-height:1.4;' +
    'color:#fff;background:rgba(15,23,42,0.92);white-space:nowrap;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.18);opacity:0;transition:opacity 80ms;';
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

function show(e: MouseEvent, text: string): void {
  const el = ensureTooltip();
  el.textContent = text;
  const pad = 10;
  let left = e.clientX + pad;
  if (left + el.offsetWidth > window.innerWidth - 8) {
    left = e.clientX - el.offsetWidth - pad;
  }
  el.style.left = `${left}px`;
  el.style.top = `${e.clientY - el.offsetHeight - 6}px`;
  el.style.opacity = '1';
}

function hide(): void {
  if (tooltipEl) tooltipEl.style.opacity = '0';
}

/**
 * 为容器内所有带 title 属性的元素绑定即时 tooltip。
 * 会移除原生 title 并存入 data-tooltip，鼠标离开时恢复。
 */
export function attachTitleTooltip(container: HTMLElement): void {
  const targets = container.querySelectorAll<HTMLElement>('[title]');
  targets.forEach((el) => {
    const text = el.getAttribute('title');
    if (!text) return;
    el.removeAttribute('title');
    el.setAttribute('data-tooltip', text);

    el.addEventListener('mouseenter', (e) => show(e, text));
    el.addEventListener('mousemove', (e) => show(e, text));
    el.addEventListener('mouseleave', hide);
  });
}
