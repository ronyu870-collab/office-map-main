import assert from 'node:assert/strict';

export async function verifyMetricsDraftNavigation(page, { width, base, userId, projectId }) {
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
  await page.route('https://example.supabase.co/rest/v1/user_roles*', route => route.fulfill({ headers, json: [{ role: 'admin', session_id: userId }] }));
  await page.route('https://example.supabase.co/rest/v1/rpc/resolve_building_id', route => {
    assert.equal(route.request().postDataJSON().p_id, projectId);
    return route.fulfill({ headers, json: projectId });
  });
  await page.route('https://example.supabase.co/rest/v1/buildings*', route => route.fulfill({ headers, json: { id: projectId, name: 'CBD甲楼', total_area: 10000 } }));
  let writes = 0;
  await page.route('https://example.supabase.co/rest/v1/building_metrics*', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 403, headers, json: { error: 'isolated writes forbidden' } }); }
    return route.fulfill({ headers, json: { id: 'metric-edit-test', building_id: projectId, asking_rent: 8, management_fee: 30, face_rent: 180, rent_free_period: 3, vacant_area: 1000, updated_at: '2026-11-23T00:00:00Z' } });
  });
  const dialogs = [];
  const handleDialog = async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); };
  page.on('dialog', handleDialog);
  const openEditor = async () => {
    const panel = page.getByRole('region', { name: 'CBD甲楼楼宇详情', exact: true });
    await panel.getByRole('tab', { name: '行情', exact: true }).click();
    await panel.getByRole('button', { name: '编辑指标', exact: true }).click();
    const input = page.locator('[data-building-metrics-edit] input').first();
    await input.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-building-metrics-edit] input')?.value === '8', undefined, { timeout: 10000 });
    const editor = page.locator('[data-building-metrics-edit]');
    for (const label of ['报价租金', '物业费', '表面租金', '免租期（月）', '空置面积', '年份', '季度']) {
      assert.equal(await editor.getByLabel(label, { exact: true }).count(), 1, `${label} has an associated control`);
    }
    await editor.getByText('报价租金', { exact: true }).click();
    assert.ok(await input.evaluate(element => document.activeElement === element), 'native label click focuses the editable field');
    return input;
  };
  try {
    console.log('metrics draft', width, 'opening');
    await page.goto(new URL(`/map?building=${projectId}`, base).href);
    const input = await openEditor();
    console.log('metrics draft', width, 'loaded original');
    await input.fill('9');
    const address = page.url();
    await page.reload({ timeout: 2000, waitUntil: 'commit' }).catch(error => { if (!/ERR_ABORTED|Timeout|interrupted|canceled/i.test(error.message)) throw error; });
    assert.deepEqual(dialogs, ['beforeunload']);
    assert.equal(page.url(), address);
    assert.equal(await input.inputValue(), '9', 'cancel refresh retains the actual metric draft');
    console.log('metrics draft', width, 'refresh cancelled');
    await page.getByRole('button', { name: '关闭指标编辑', exact: true }).click();
    const warning = page.getByRole('dialog', { name: '未保存的更改', exact: true });
    await warning.getByRole('button', { name: '继续编辑', exact: true }).click();
    console.log('metrics draft', width, 'continued editing');
    assert.equal(await input.inputValue(), '9');
    await page.keyboard.press('Escape');
    await warning.getByRole('button', { name: '放弃更改', exact: true }).click();
    await input.waitFor({ state: 'detached' });
    console.log('metrics draft', width, 'discarded');
    await page.reload();
    assert.deepEqual(dialogs, ['beforeunload'], 'discarding the modal removes the native guard');
    const reverted = await openEditor();
    await reverted.fill('9');
    await reverted.fill('8');
    await page.reload();
    assert.deepEqual(dialogs, ['beforeunload'], 'reverting the value removes the native guard');
    console.log('metrics draft', width, 'revert cleared guard');
    assert.equal(writes, 0);
    return { width, metricsDraftNavigation: { refreshCancelled: true, draftRetained: true, keepEditingRetainsDraft: true, discardAndRevertReleaseGuard: true, namedControls: 7, nativeLabelFocus: true, namedCloseAction: true, writes, dialogs } };
  } finally { page.off('dialog', handleDialog); }
}
