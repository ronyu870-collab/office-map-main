import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const base = new URL(process.argv[2]);
const baseline = process.argv.includes('--baseline');
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'isolated loopback builds only');
const { chromium } = createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ ...(process.env.PERF_BROWSER_CHANNEL === 'chromium' ? {} : { channel: 'chrome' }), headless: true });
const user = { id: '23456789-1111-4111-8111-111111111111', email: 'fixture@example.test', app_metadata: {}, user_metadata: {} };
const expires_at = Math.floor(Date.now() / 1000) + 3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, exp: expires_at, aud: 'authenticated', session_id: user.id })}.fixture`;
const session = { user, expires_at, expires_in: 3600, token_type: 'bearer', refresh_token: 'synthetic', access_token: token };
const projects = Array.from({ length: 622 }, (_, i) => ({
  id: String(i + 1), name: `合成项目 ${i + 1}`, submarket: i % 2 ? '次市场' : '核心市场', grade: 'A', city: '上海', district: '核心区',
  location_lng: 121.4, location_lat: 31.2, completion_year: '2015', leed_certification: i < 2 ? '金级' : 'NULL',
  owner: i === 0 ? 'Alpha Holdings' : 'Alps Holdings', property_management: i === 0 ? '管理示例' : '其他物业',
  contact_phone: '000-000000', leasable_area: 12345, is_active: true, notes: '合成备注'.repeat(12), sort_order: i,
  system_entry_date: '2026-01-01T00:00:00Z', former_names: ['合成历史名称'], project_type: 'stock', is_entered_market: true, tracking_scope: 'tracked',
  building_metrics: Array.from({ length: i === 2 ? 0 : 8 }, (_, j) => ({
    id: i * 8 + j + 1, created_at: '2026-01-01T00:00:00Z', building_id: String(i + 1), total_area: 100,
    asking_rent: 130, management_fee: i === 0 ? 13 : 2, face_rent: 130, rent_free_period: 1, net_effective_rent: j === 3 ? 120 : 50,
    vacancy_rate: 0.1, vacant_area: 10, record_year: j < 4 ? 2026 : 2025, record_quarter: j % 4 + 1,
    is_locked: false, is_draft: false, data_source: '合成来源', locked_at: null, locked_by: null,
    rent_qoq_change: 0.15, rent_yoy_change: 0.24, vacant_area_qoq_change: 0.02, updated_at: '2026-11-01T00:00:00Z',
  })),
}));

function applyPostgrestProjection(select) {
  const [, fields, metricFields] = /^([^()]*)\bbuilding_metrics\(([^()]+)\)$/.exec(select) || [];
  assert.ok(fields && metricFields, 'expected a valid buildings and embedded metrics projection');
  const pick = (obj, columns) => columns.includes('*') ? obj : Object.fromEntries(columns.map(k => {
    assert.ok(Object.hasOwn(obj, k), `unknown fixture column ${k}`);
    return [k, obj[k]];
  }));
  const outer = fields.split(',').map(v => v.trim()).filter(Boolean);
  const inner = metricFields.split(',').map(v => v.trim());
  return projects.map(row => ({ ...pick(row, outer), building_metrics: row.building_metrics.map(metric => pick(metric, inner)) }));
}

const fullPayloadBytes = Buffer.byteLength(JSON.stringify(projects));
const results = [];
try {
  for (const width of [1280, 390]) for (const scenario of ['success', 'failure', 'viewer']) {
    const context = await browser.newContext({ viewport:{width,height:844}, isMobile:width===390, hasTouch:width===390, serviceWorkers:'block' });
    try {
      const calls=[];
      await context.routeWebSocket(/.*/, ws=>ws.close());
      await context.route('**/*', async route=>{
        const req = route.request(); const url = new URL(req.url());
        if (url.origin===base.origin) return url.pathname.startsWith('/api/') ? route.fulfill({status:204}) : route.continue();
        if (url.origin!=='https://example.supabase.co') return route.abort();
        const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, HEAD, OPTIONS','access-control-allow-headers':'*'};
        if(req.method()==='OPTIONS') return route.fulfill({status:204,headers});
        if(url.pathname==='/auth/v1/user') return route.fulfill({headers,json:user});
        if(url.pathname==='/rest/v1/user_roles') return route.fulfill({headers,json:[{role:scenario==='viewer'?'viewer':'admin',user_id:user.id,session_id:user.id,full_name:'合成用户'}]});
        if(url.pathname==='/rest/v1/buildings'){
          assert.equal(req.method(),'GET');
          assert.equal(url.searchParams.get('is_active'),'eq.true');
          assert.equal(url.searchParams.get('tracking_scope'),'eq.tracked');
          const data=applyPostgrestProjection(url.searchParams.get('select'));
          const json=JSON.stringify(data);
          calls.push(Buffer.byteLength(json));
          if(scenario==='failure' && calls.length===1) return route.fulfill({status:400,headers,json:{code:'42501',message:'fixture failed'}});
          return route.fulfill({headers:{...headers,'content-type':'application/json'},body:json});
        }
        return route.fulfill({headers,json:[]});
      });
      await context.addInitScript(({origin,session})=>{
        if(location.origin!==origin)return;
        localStorage.setItem('colliers_trusted_device_until',String(Date.now()+86_400_000));
        localStorage.setItem('sb-example-auth-token',JSON.stringify(session));
      },{origin:base.origin,session});
      const page=await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.goto(new URL('/admin?section=debug',base).href);
      if(scenario==='viewer'){
        await page.waitForURL(u=>u.pathname!=='/admin',{timeout:10000});
        assert.equal(calls.length,0);
        results.push({width,scenario,requests:0});
        continue;
      }
      if(scenario==='failure'){
        if (baseline) {
          await page.getByText('无匹配数据，请调整筛选条件').waitFor();
          results.push({width,scenario,errorMisreportedAsEmpty:true});
          continue;
        }
        await page.getByText('楼宇数据加载失败',{exact:true}).waitFor();
        assert.equal(await page.getByText('无匹配数据，请调整筛选条件').count(),0);
        await page.getByRole('button',{name:'重试'}).click();
      }
      const root=page.getByText('项目数量',{exact:true}).locator('..');
      await root.getByText('622',{exact:true}).waitFor();
      await page.getByText('120.0',{exact:true}).first().waitFor();
      await page.getByText('10.0%',{exact:true}).first().waitFor();
      if (width === 390) {
        const pane = await page.locator('main').last().boundingBox();
        const filters = await page.locator('aside').filter({ hasText: '数据筛选' }).boundingBox();
        assert.ok(pane && filters);
        if (baseline) assert.ok(pane.width < 160, 'baseline side panel squeezes the diagnostic results');
        else assert.ok(pane.width > 350 && pane.y >= filters.y + filters.height, 'diagnostic results use the full narrow viewport below the filters');
      }
      await page.getByRole('button',{name:/展开贡献明细/}).first().click();
      await page.getByText('2026Q4',{exact:true}).first().waitFor();
      await page.getByText('无季度数据',{exact:true}).first().waitFor();
      await page.getByText('多重筛选',{exact:true}).click();
      await page.getByRole('button',{name:/添加筛选条件/}).click();
      await page.getByRole('combobox').first().selectOption('owner');
      const input=page.getByPlaceholder('模糊搜索');
      await input.pressSequentially('Alpa');
      await page.getByText('无匹配数据，请调整筛选条件').waitFor();
      await input.evaluate(e=>e.setSelectionRange(3,3));
      await page.keyboard.type('h');
      await root.getByText('1',{exact:true}).waitFor();
      assert.deepEqual(await input.evaluate(e=>[e===document.activeElement,e.value,e.selectionStart]),[true,'Alpha',4]);
      await input.fill('');
      await root.getByText('622', { exact: true }).waitFor();
      await page.getByRole('combobox').first().selectOption('management_fee');
      const numberInput=page.locator('input[type=number]');
      await numberInput.fill('10');
      await root.getByText('1',{exact:true}).waitFor();
      assert.equal(calls.length,scenario==='failure'?2:1);
      if (!baseline) assert.ok(calls.at(-1) < fullPayloadBytes * 0.55, 'diagnostic projection should trim the fixture response by at least 45%');
      results.push({width,scenario,buildings:622,rawBytes:calls.at(-1),requests:calls.length,focusAndLatestQuarter:true});
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({status: 'pass', browser: browser.version(), baseline, results},null,2));
} finally { await browser.close(); }
