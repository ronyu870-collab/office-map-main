import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'memo@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const notes = Array.from({ length: 120 }, (_, i) => ({
  id: String(i + 1),
  title: i === 0 ? 'Alpha 备忘录' : `备忘录 ${i + 1}`,
  content: `合成备忘录摘要 ${i + 1}\n\n` + '正文夹具。'.repeat(450) + (i === 0 ? '\n\n正文末尾可见' : ''),
  tags: [], is_pinned: i === 0, created_at: '2026-11-10T00:00:00Z',
  updated_at: '2026-11-10T00:00:00Z', updated_by: user.email, created_by: user.email,
}));
const firstTitle = notes[0].title;
const results = [];
const requestedWidth = Number(process.argv.find(arg => arg.startsWith('--width='))?.split('=')[1]);
try {
  const scenarios = [{ width: 1280, missingPreview: false }, { width: 390, missingPreview: false }];
  if (!baseline) scenarios.push({ width: 390, missingPreview: true });
  for (const { width, missingPreview } of scenarios) {
    if (requestedWidth && (width !== requestedWidth || missingPreview)) continue;
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' });
    let releaseTags;
    let releaseDetail;
    const heldTags = new Promise(resolve => { releaseTags = resolve; });
    const heldDetail = new Promise(resolve => { releaseDetail = resolve; });
    try {
      let savedMemo = notes[0];
      let rejectWrite = true;
      const retryDetail = !baseline && !missingPreview;
      const calls = { tags: 0, list: 0, detail: 0, missingPreviewReads: 0, listBytes: 0, writes: 0 };
      await context.routeWebSocket(/.*/, ws => ws.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, HEAD, OPTIONS', 'access-control-allow-headers': '*' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        if (url.pathname === '/rest/v1/user_roles') return route.fulfill({ headers, json: [{ role: 'admin', user_id: user.id, session_id: user.id, full_name: '合成用户' }] });
        if (url.pathname === '/rest/v1/rpc/get_all_memo_tags') {
          calls.tags++;
          await heldTags;
          return route.fulfill({ headers, json: [{ tag: '合成标签' }] });
        }
        if (url.pathname === '/rest/v1/memos') {
          if (request.method() === 'PATCH') {
            calls.writes++;
            if (rejectWrite) return route.fulfill({ status: 400, headers, json: { message: '隔离保存失败' } });
            savedMemo = { ...savedMemo, ...request.postDataJSON() };
            return route.fulfill({ headers, json: savedMemo });
          }
          const id = url.searchParams.get('id');
          if (id) {
            calls.detail++;
            if (retryDetail && calls.detail === 1) return route.fulfill({ status: 502, headers, json: { message: '隔离正文读取失败' } });
            if (retryDetail && calls.detail === 2) {
              assert.equal(id, `eq.${savedMemo.id}`, 'retry must fetch the selected memo');
              await heldDetail;
            }
            const row = id === `eq.${savedMemo.id}` ? savedMemo : notes.find(note => id === `eq.${note.id}`);
            const expectsObject = request.headers().accept?.includes('vnd.pgrst.object');
            return route.fulfill({ headers, json: expectsObject ? row : row ? [row] : [] });
          }
          const term = url.searchParams.get('title')?.replace(/^ilike\.%|%$/g, '').toLowerCase();
          const columns = url.searchParams.get('select').split(',');
          if (missingPreview && columns.includes('content_preview:memo_content_preview')) {
            calls.missingPreviewReads++;
            return route.fulfill({ status: 400, headers, json: { code: '42703', message: 'column memos.memo_content_preview does not exist' } });
          }
          calls.list++;
          const data = notes.filter(note => !term || note.title.toLowerCase().includes(term)).map(note => Object.fromEntries(
            columns.map(field => field === 'content_preview:memo_content_preview'
              ? ['content_preview', Array.from(note.content).slice(0, 100).join('')]
              : [field, note[field]]),
          ));
          const body = JSON.stringify(data);
          if (calls.list === 1) calls.listBytes = Buffer.byteLength(body);
          return route.fulfill({ headers: { ...headers, 'content-type': 'application/json' }, body });
        }
        return route.fulfill({ headers, json: [] });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const list = page.waitForResponse(res => new URL(res.url()).pathname === '/rest/v1/memos' && res.ok());
      await page.goto(new URL('/admin?section=memo', base).href);
      await list;
      const title = page.getByText(firstTitle, { exact: true }).first();
      if (baseline) {
        await page.waitForTimeout(250);
        assert.equal(await title.count(), 0, 'baseline list still waits for tags');
      } else {
        await title.waitFor();
      }
      const beforeTags = await title.count() === 1;
      assert.equal(calls.detail, 0);
      releaseTags();
      await page.getByRole('button', { name: '合成标签', exact: true }).waitFor();
      await title.waitFor();
      await page.getByText(notes[0].content.slice(0, 100).trim(), { exact: false }).first().waitFor();
      const search = page.getByPlaceholder('搜索标题...');
      await search.pressSequentially('Alpa');
      await page.getByText('没有匹配的备忘录').waitFor();
      await search.evaluate(input => input.setSelectionRange(3, 3));
      await page.keyboard.type('h');
      await title.waitFor();
      assert.deepEqual(await search.evaluate(input => [input === document.activeElement, input.value, input.selectionStart]), [true, 'Alpha', 4]);
      assert.equal(calls.detail, 0);
      if (!baseline) assert.equal(calls.tags, 1, 'title searches do not reread all tags');
      await title.click();
      if (retryDetail) {
        const error = page.getByRole('alert').filter({ hasText: '备忘录正文读取失败' });
        const oldState = page.getByText('无法打开备忘录', { exact: true });
        assert.equal(await Promise.race([
          error.waitFor().then(() => 'inline retry'),
          oldState.waitFor().then(() => 'generic empty state'),
        ]), 'inline retry', 'a failed detail read must offer a retry in the same memo');
        const retry = error.getByRole('button', { name: '重试读取正文', exact: true });
        if (process.env.PERF_MEMO_SCREENSHOT_DIR) {
          await page.screenshot({ path: `${process.env.PERF_MEMO_SCREENSHOT_DIR}/memo-detail-retry-${width}.png` });
        }
        const listReads = calls.list;
        await (width === 390 ? retry.tap() : retry.click());
        await page.getByText('正在加载备忘录', { exact: true }).waitFor();
        assert.equal(await retry.count(), 0, 'the pending request cannot be retried twice');
        releaseDetail();
        await page.getByText('正文末尾可见', { exact: true }).waitFor();
        assert.equal(calls.list, listReads, 'retry does not refetch the list');
      }
      await page.getByText('正文末尾可见', { exact: true }).waitFor();
      assert.equal(calls.detail, retryDetail ? 2 : 1);
      if (width === 390) {
        const body = page.getByText('正文末尾可见', { exact: true });
        const heading = page.getByRole('heading', { name: firstTitle, exact: true });
        const { width: headingWidth } = await heading.boundingBox();
        if (baseline) assert.ok(headingWidth < 130, 'baseline columns squeeze the memo body');
        else {
          assert.ok(headingWidth > 280, 'a narrow viewport gives the selected memo the full content width');
          assert.equal(await search.isVisible(), false);
          await page.getByRole('button', { name: '返回备忘录列表' }).click();
          await search.waitFor();
          assert.equal(await search.inputValue(), 'Alpha');
          assert.equal(await body.count(), 0);
          await title.click();
          await body.waitFor();
        }
      }
      if (!baseline) {
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        const editor = page.getByPlaceholder('在此输入 Markdown 内容...');
        await editor.waitFor();
        assert.equal(await editor.inputValue(), notes[0].content);
      }
      assert.equal(calls.writes, 0);
      if (!baseline && !missingPreview) {
        const editor = page.getByPlaceholder('在此输入 Markdown 内容...');
        const revised = '尚未保存的隔离修改';
        const openNav = page.getByRole('button', { name: '打开管理导航' });
        const closeNav = page.getByRole('button', { name: '关闭管理导航', exact: true });
        const switchSection = async () => {
          if (width === 390) await openNav.click();
          await page.getByRole('button', { name: '用户管理', exact: true }).filter({ visible: true }).click();
        };
        await editor.fill(revised);
        await switchSection();
        const failure = page.getByRole('alert').filter({ hasText: '保存失败，当前输入仍保留' });
        assert.equal(await Promise.race([
          failure.waitFor().then(() => 'retained'),
          page.waitForURL('**/admin?section=users').then(() => 'navigated'),
        ]), 'retained', 'the memo must stay open after a rejected autosave');
        if (width === 390) await closeNav.click();
        assert.equal(await editor.inputValue(), revised);
        rejectWrite = false;
        await switchSection();
        await page.waitForURL('**/admin?section=users');
        assert.equal(savedMemo.content, revised, 'navigation waits for the updated memo to be written');
      }
      assert.equal(calls.missingPreviewReads, missingPreview ? calls.list : 0);
      if (!baseline && !missingPreview) assert.ok(calls.listBytes < 100_000, 'memo list should carry previews rather than full bodies');
      results.push({ width, missingPreview, listBeforeTags: beforeTags, detailRetry: retryDetail, ...calls });
    } finally { releaseTags(); releaseDetail(); await context.close(); }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), results }, null, 2));
} finally { await browser.close(); }
