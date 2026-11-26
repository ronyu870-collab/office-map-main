// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installSubmarketCollisionAvoidance } from '../mapSubmarketCollisionAvoidance';

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
it('avoids real sibling workspaces, settles without drift, pauses during gestures and cleans up', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="map-workspace-layout"><aside class="map-workspace-left" data-open="true"></aside><main><div id="map-container" data-marker-tier="submarket"><button class="map-submarket-bubble" style="width:108px;height:108px">CBD</button></div></main></div>';
  const container = document.getElementById('map-container')!;
  const bubble = container.querySelector<HTMLButtonElement>('button')!;
  const panel = document.querySelector<HTMLElement>('aside')!;
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
  container.getBoundingClientRect = () => rect(0, 0, 800, 500);
  panel.getBoundingClientRect = () => rect(0, 0, 300, 500);
  bubble.getBoundingClientRect = () => rect(146 + Number(bubble.dataset.collisionX ?? 0), 196 + Number(bubble.dataset.collisionY ?? 0), 108, 108);
  const callbacks = new Map<string, () => void>();
  const map = { on: (name: string, callback: () => void) => callbacks.set(name, callback), off: (name: string) => callbacks.delete(name) };
  const dispose = installSubmarketCollisionAvoidance(map, container);
  await vi.advanceTimersByTimeAsync(200);
  expect(bubble.getBoundingClientRect().left).toBeGreaterThanOrEqual(308);
  const settled = bubble.dataset.collisionX;
  callbacks.get('moveend')?.(); await vi.advanceTimersByTimeAsync(200);
  expect(bubble.dataset.collisionX).toBe(settled);
  container.classList.add('map-is-moving'); panel.removeAttribute('data-open');
  await vi.advanceTimersByTimeAsync(300);
  expect(bubble.dataset.collisionX).toBe(settled);
  container.classList.remove('map-is-moving'); callbacks.get('moveend')?.();
  await vi.advanceTimersByTimeAsync(250);
  expect(Number(bubble.dataset.collisionX)).toBeLessThan(Number(settled));
  dispose();
  expect(callbacks.size).toBe(0); expect(bubble.dataset.collisionX).toBeUndefined();
  expect(bubble.style.getPropertyValue('--sm-collision-x')).toBe('');
});
