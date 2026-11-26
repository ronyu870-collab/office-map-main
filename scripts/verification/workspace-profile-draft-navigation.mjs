import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

// Real browser dialogs and history against the production editor. Transport and
// administrator identity are isolated; this never writes a production profile.
export async function verifyProfileDraftNavigation(page, { width, base, userId }) {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
  await page.route('https://example.supabase.co/rest/v1/user_roles*', route => route.fulfill({ headers, json: [{ role: 'admin', session_id: userId }] }));
  let saves = 0;
  const trackSave = request => { if (new URL(request.url()).pathname === '/api/map/submarket' && request.method() === 'PUT') saves++; };
  page.on('request', trackSave);
  const dialogs = [];
  let accept = false;
  const handleDialog = async dialog => { dialogs.push(dialog.type()); await (accept ? dialog.accept() : dialog.dismiss()); };
  page.on('dialog', handleDialog);
  const navigate = async action => {
    try { await action(); }
    catch (error) { if (!/ERR_ABORTED|Timeout|interrupted|canceled/i.test(error.message)) throw error; }
  };
  const openEditor = async () => {
    await page.waitForFunction(() => window.__workspaceMap?.getCenter());
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('map-submarket-open', { detail: { name: 'CBD' } })));
    const panel = page.getByRole('region', { name: 'CBD', exact: true });
    await panel.getByText('国际商务集聚区', { exact: true }).waitFor();
    await clickWorkspaceAction(page, '维护资料');
    return panel.getByLabel('一句话定位', { exact: true });
  };
  try {
    await page.goto(new URL('/map?draftNavigation=prior', base).href);
    await page.goto(new URL('/map?draftNavigation=current', base).href);
    const input = await openEditor();
    await input.fill('未保存的导航保护回归');
    let currentURL = page.url();
    await navigate(() => page.reload({ timeout: 2000, waitUntil: 'commit' }));
    assert.deepEqual(dialogs, ['beforeunload'], 'native refresh protects actual edits');
    assert.equal(await input.inputValue(), '未保存的导航保护回归');
    await navigate(() => page.goBack({ timeout: 2000, waitUntil: 'commit' }));
    assert.deepEqual(dialogs, ['beforeunload', 'beforeunload'], 'cross-document history uses native unload protection once');
    assert.equal(page.url(), currentURL);
    assert.equal(await input.inputValue(), '未保存的导航保护回归');
    await page.evaluate(() => {
      const address = new URL(location.href);
      address.searchParams.set('draftNavigation', 'same-document');
      history.pushState({ ...history.state }, '', address);
    });
    currentURL = page.url();
    await navigate(() => page.goBack({ timeout: 2000, waitUntil: 'commit' }));
    assert.deepEqual(dialogs, ['beforeunload', 'beforeunload', 'confirm'], 'same-document history cancellation prompts once');
    assert.equal(page.url(), currentURL);
    assert.equal(await input.inputValue(), '未保存的导航保护回归');

    const home = page.locator('a[href="/"]:visible');
    const compactNavigation = !await home.count();
    if (compactNavigation) await page.locator('.map-header-navigation-mobile summary').click();
    await home.first().click();
    assert.deepEqual(dialogs, ['beforeunload', 'beforeunload', 'confirm', 'confirm'], 'actual home link prompts once');
    assert.equal(page.url(), currentURL);
    assert.equal(await input.inputValue(), '未保存的导航保护回归');
    if (compactNavigation) await page.keyboard.press('Escape');

    // Discarding the editor unmounts its guard. Reload must then proceed without
    // a stale native dialog or an accidental profile write.
    accept = true;
    await page.getByRole('region', { name: 'CBD', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    assert.equal(dialogs.at(-1), 'confirm');
    const afterDiscard = dialogs.length;
    await page.reload();
    assert.equal(dialogs.length, afterDiscard, 'unmount removes navigation protection');
    const cleanInput = await openEditor();
    await cleanInput.fill('可撤销的修改');
    await cleanInput.fill('国际商务集聚区');
    await page.reload();
    assert.equal(dialogs.length, afterDiscard, 'restoring the original value removes the guard');
    const leavingInput = await openEditor();
    await leavingInput.fill('确认离开的未保存修改');
    if (!await home.count()) await page.locator('.map-header-navigation-mobile summary').click();
    await home.first().click();
    await page.waitForURL(address => address.pathname === '/');
    assert.equal(dialogs.length, afterDiscard + 1, 'accepting the real link does not prompt a second time');
    assert.equal(dialogs.at(-1), 'confirm');
    assert.equal(saves, 0, 'cancelled navigation and discarded drafts never save');
    return { width, profileDraftNavigation: { nativeRefreshCancelled: true, crossDocumentAndSameDocumentHistoryCancelled: true, homeLinkCancelledAndAccepted: true, draftRetained: true, unmountAndRevertRemoveGuard: true, saves, dialogs } };
  } finally {
    page.off('dialog', handleDialog);
    page.off('request', trackSave);
  }
}
