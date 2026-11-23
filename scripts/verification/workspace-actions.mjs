// The same command stays reachable in compact action menus and desktop headers.
export async function clickWorkspaceAction(page, name) {
  const action = page.getByRole('button', { name, exact: true });
  if (!await action.isVisible()) await page.locator('.map-workspace-right .workspace-mobile-tools > summary:visible').click();
  await action.click();
}
