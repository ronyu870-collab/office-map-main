// The same command stays reachable in compact action menus and desktop headers.
export async function clickWorkspaceAction(page, name) {
  const action = page.getByRole('button', { name, exact: true });
  if (!await action.isVisible()) await page.locator('.map-workspace-right .workspace-mobile-tools > summary:visible').click();
  await action.click();
}

/** Enter the gallery's open state, regardless of the desktop default or a restored mobile state.
 * Never click an already expanded gallery: that cancels its authorized in-flight read. */
export async function ensureWorkspacePhotoOpen(detail) {
  const trigger = detail.getByRole('button', { name: /看图/ });
  await trigger.waitFor({ state: 'visible' });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await detail.locator('[data-building-photo-trigger][aria-expanded="true"]').waitFor({ state: 'visible' });
  await detail.locator('[data-building-photo-gallery]:not([hidden])').waitFor({ state: 'visible' });
  return trigger;
}
