import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const base = new URL(process.argv[2]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const baseline = process.argv.includes('--baseline');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const XLSX = require('xlsx');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'progress@example.test', app_metadata: {}, user_metadata: {} };
const colleague = '34567890-1111-4111-8111-111111111111';
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const [year, month] = new Date().toISOString().slice(0, 7).split('-').map(Number);
const calendarQuarter = Math.ceil(month / 3);
const quarter = calendarQuarter === 3 ? 2 : 3;
const stamp = new Date(Date.UTC(year, (quarter - 1) * 3, 7, 10)).toISOString();
const buildings = Array.from({ length: 600 }, (_, i) => ({
  id: `building-${i}`, name: `隔离楼宇 ${i}`, grade: i === 0 ? 'P' : 'A', submarket: 'CBD', sort_order: i === 0 ? 2 : 1,
}));
const assignments = buildings.map(({ id }, i) => ({ building_id: id, user_id: i < 2 ? user.id : colleague }));
assignments.push({ building_id: buildings[0].id, user_id: user.id }, { building_id: 'inactive-building', user_id: user.id });
const records = buildings.slice(0, 300).map(({ id }, i) => ({
  building_id: id, user_id: i < 2 ? user.id : colleague, created_at: stamp,
}));
const batch = [
  { id: 'first', ...records[0], asking_rent: 100 },
  { id: 'second', ...records[0], asking_rent: 108 },
  { id: 'third', ...records[1], asking_rent: 105 },
].map(row => ({ ...row, record_year: year, record_quarter: quarter }));
const settings = [{ key: 'current_submission_year', value: String(year) }, { key: 'current_submission_quarter', value: String(quarter) }];
const snapshot = process.env.PERF_SUBMISSION_SCREENSHOT_DIR;
const results = [];

function gate() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}

async function until(page, condition, label) {
  for (let i = 0; i < 160; i++) {
    if (condition()) return;
    await page.waitForTimeout(25);
  }
  assert.ok(condition(), label);
}

try {
  for (const [width, role] of [[1280, 'admin'], [390, 'admin'], ...baseline ? [] : [[390, 'viewer']]]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width === 390, timezoneId: 'UTC', serviceWorkers: 'block' });
    const waits = { settings: gate(), names: gate(), buildings: gate() };
    const requests = { settings: 0, names: [], buildingNames: 0, futureNames: 0, assignments: [], summary: [], history: [], workbook: [] };
    const violations = [];
    try {
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({ status: 204 }) : route.continue();
        if (url.origin !== 'https://example.supabase.co') return route.abort();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': '*' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers, json: user });
        const table = url.pathname.replace('/rest/v1/', '');
        const select = url.searchParams.get('select')?.replaceAll(' ', '');
        const offset = Number(url.searchParams.get('offset') ?? req.headers().range?.split('-')[0] ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 150);
        const pageRows = rows => rows.slice(offset, offset + Math.min(limit, 150));
        let data = [];
        if (req.headers().authorization !== `Bearer ${token}`) violations.push(table);
        if (table === 'user_roles') {
          if (select === 'user_id,chinese_name,full_name') {
            requests.names.push(offset);
            await waits.names.wait;
            data = pageRows([{ user_id: user.id, chinese_name: '隔离管理员' }, { user_id: colleague, full_name: '隔离同事' }]);
          } else {
            const profile = { role, user_id: user.id, session_id: user.id, full_name: '隔离管理员' };
            data = req.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile];
          }
        } else if (table === 'app_settings') {
          requests.settings++;
          await waits.settings.wait;
          data = settings;
        } else if (table === 'buildings') {
          if (select === 'id,name,grade,submarket,sort_order') {
            requests.buildingNames++;
            await waits.buildings.wait;
          }
          data = pageRows(select === 'id' ? buildings.map(({ id }) => ({ id })) : buildings);
        } else if (table === 'building_assignments') {
          if (select === 'building_id' || select === 'user_id,building_id') requests.assignments.push({ select, offset });
          data = pageRows(select === 'building_id' ? assignments.map(({ building_id }) => ({ building_id })) : assignments);
        } else if (table === 'future_supplies' && select === 'id,name') {
          requests.futureNames++;
        } else if (table === 'rpc/get_quarterly_submission_summary') {
          const params = req.postDataJSON();
          requests.summary.push({ ...params, offset });
          data = pageRows(params.p_year === year && params.p_quarter === quarter ? records : []);
        } else if (table === 'quarterly_submissions') {
          const scope = Object.fromEntries(url.searchParams);
          if (select === '*') requests.workbook.push(scope);
          else requests.history.push(scope);
          if (scope.record_year !== `eq.${year}` || scope.record_quarter !== `eq.${quarter}` || scope.user_id !== `eq.${user.id}` ||
            (select === '*' && !scope.created_at?.includes(stamp))) violations.push('incorrect upload batch scope');
          data = pageRows(batch);
        } else if (table === 'rpc/get_quarterly_rollout_status') {
          data = [];
        } else if (!['GET', 'HEAD'].includes(req.method())) {
          violations.push(`unexpected mutation: ${table}`);
        }
        return route.fulfill({ headers, json: data });
      });
      await context.addInitScript(({ origin, session }) => {
        if (location.origin !== origin) return;
        localStorage.setItem('colliers_trusted_device_until', String(Date.now() + 86_400_000));
        localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
      }, { origin: base.origin, session });

      const page = await context.newPage();
      page.setDefaultTimeout(9000);
      await page.goto(new URL('/admin?section=submissions', base).href, { waitUntil: 'domcontentloaded' });
      const progress = page.getByRole('button', { name: '填报进度', exact: true });
      if (role === 'viewer') {
        await page.waitForURL(new URL('/', base).href);
        assert.equal(await progress.count(), 0);
        assert.equal(requests.summary.length + requests.assignments.length + requests.names.length, 0);
        results.push({ width, role, protectedReads: 0 });
        continue;
      }

      await until(page, () => requests.settings > 0 && requests.names.length > 0 && requests.buildingNames > 0, 'initial directories and settings requested');
      await progress.click();
      const card = page.getByText('记录覆盖率', { exact: true }).first().locator('..');
      const settingsControl = baseline ? page.locator('select').last() : page.getByLabel('查看填报季度');
      await settingsControl.waitFor();
      if (baseline) {
        await until(page, () => requests.assignments.filter(req => req.offset === assignments.length).length === 2, 'old progress paginates both assignment streams before settings');
        assert.deepEqual([...new Set(requests.summary.map(r => r.p_quarter))], [calendarQuarter]);
      } else {
        assert.equal(requests.assignments.length + requests.summary.length, 0, 'configured period gates all automatic progress reads');
      }
      const speculativeAssignmentRequests = requests.assignments.length;
      const settingsReleasedAt = performance.now();
      waits.settings.release();
      await until(page, () => requests.summary.some(req => req.p_quarter === quarter && req.offset === records.length), 'configured period is read through final page');
      const namesPending = await card.count() === 0;
      if (baseline) {
        assert.equal(namesPending, true, 'old coverage remains hidden while names are pending');
        if (snapshot) await page.screenshot({ path: join(snapshot, `submission-directory-pending-before-${width}.png`) });
        waits.names.release();
        waits.buildings.release();
      } else {
        await card.getByText('50%', { exact: true }).waitFor();
        await page.getByText('正在加载人员明细…', { exact: true }).waitFor();
        if (snapshot) await page.screenshot({ path: join(snapshot, `submission-directory-pending-after-${width}.png`) });
        waits.names.release();
      }
      await card.getByText('50%', { exact: true }).waitFor();
      const configuredCoverageMs = Math.round(performance.now() - settingsReleasedAt);
      const expand = page.getByRole('button', { name: '查看 隔离管理员 的上传记录' });
      await expand.waitFor();
      const assignmentRequests = requests.assignments.length;
      const directoryRequests = requests.names.length;
      const initialFutureNamesRequests = requests.futureNames;
      assert.equal(assignmentRequests, baseline ? 24 : 6, 'only one complete capped assignment stream for the configured quarter');
      assert.equal(directoryRequests, baseline ? 6 : 2, 'a single paginated directory is shared');
      assert.equal(initialFutureNamesRequests, baseline ? 1 : 0, 'future names are only needed on relevant tabs');
      assert.deepEqual(await expand.locator('xpath=../..').getByRole('cell').allTextContents().then(cells => cells.slice(2, 5)), ['2', '2', '100%']);
      const observation = { width, role, speculativeAssignmentRequests, assignmentRequests, directoryRequests, initialFutureNamesRequests,
        coverageVisibleWhileNamesPending: !baseline, configuredCoverageMs };
      if (baseline && width === 390) {
        await assert.rejects(expand.click({ trial: true, timeout: 650 }), /intercepts pointer events/);
        results.push({ ...observation, historyReachable: false, workbookRows: 0 });
        continue;
      }
      await expand.click();
      const downloadButton = page.getByRole('button', { name: /2项/ });
      await downloadButton.waitFor();
      if (!baseline) {
        assert.equal(await downloadButton.isDisabled(), true);
        assert.equal(requests.workbook.length, 0);
        await page.getByText('上传记录（楼宇目录就绪后可下载）', { exact: true }).waitFor();
        waits.buildings.release();
      }
      await page.getByRole('button', { name: /含甲级.*2项/ }).waitFor();
      const downloaded = page.waitForEvent('download');
      await downloadButton.click();
      const file = await downloaded;
      assert.match(file.suggestedFilename(), new RegExp(`^${year}Q${quarter}_.*_隔离管理员_.*_含甲级\\.xlsx$`));
      const workbook = XLSX.readFile(await file.path());
      assert.deepEqual(workbook.SheetNames, ['填报数据']);
      assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['填报数据']).map(row => [row['项目名称'], row['年份'], row['季度'], row['报价租金']]), [
        ['隔离楼宇 1', year, quarter, 105], ['隔离楼宇 0', year, quarter, 108],
      ]);
      assert.deepEqual(violations, []);
      if (snapshot) await page.screenshot({ path: join(snapshot, `submission-workbook-${baseline ? 'before' : 'after'}-${width}.png`) });
      if (!baseline) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await settingsControl.selectOption(String(calendarQuarter));
        await card.getByText('0%', { exact: true }).waitFor();
        assert.equal(await downloadButton.count(), 0, 'changing the quarter closes upload history');
        await page.getByRole('button', { name: '草稿管理', exact: true }).click();
        await until(page, () => requests.futureNames > 0, 'drafts load the future project names on demand');
      }
      results.push({ ...observation, historyReachable: true, workbookRows: 2 });
    } finally {
      Object.values(waits).forEach(wait => wait.release());
      await context.close();
    }
  }
  console.log(JSON.stringify({ status: 'pass', baseline, browser: browser.version(), year, quarter, results }, null, 2));
} finally { await browser.close(); }
