import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachTitleTooltip } from '../titleTooltip';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('native tooltip ownership', () => {
  it('clears pending hover work and restores native titles when disposed', () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    container.innerHTML = '<button title="查看资料">资料</button>';
    document.body.appendChild(container);
    const button = container.querySelector('button')!;
    const dispose = attachTitleTooltip(container);
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    dispose();
    vi.runAllTimers();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.title).toBe('查看资料');
    expect(button.hasAttribute('data-tooltip')).toBe(false);
  });
  it('dismisses a keyboard tooltip on Escape and removes its event ownership', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button title="查看来源">来源</button>';
    document.body.appendChild(container);
    const dispose = attachTitleTooltip(container);
    const button = container.querySelector('button')!;
    fireEvent.focus(button);
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.style.display).toBe('block');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tooltip.style.display).toBe('none');
    dispose();
    fireEvent.focus(button);
    expect(tooltip.style.display).toBe('none');
  });
});
