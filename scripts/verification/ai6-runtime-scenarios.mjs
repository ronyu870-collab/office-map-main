// Only supplier responses are synthetic. Login, authority, snapshots, encrypted
// archives, recovery and built HTTP artifact downloads use the disposable stack.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import sharp from 'sharp';
import { loadAgentHandler } from './ai5-export-scenarios.mjs';
import { grantQuery } from '../../supabase/tests/ai-query-authority/database.mjs';
import { grantBusiness } from '../../supabase/tests/ai-business-research/fixture.mjs';

export async function verifyAi6Runtime({ db, app, fixture, service, keys, output, check, person, artifact, recover, events, decrypt, exportCaps }) {
  const handle = await loadAgentHandler(output);
  const originalFetch = globalThis.fetch, previous = new Map();
  const env = values => { for (const [key, value] of Object.entries(values)) { previous.set(key, process.env[key]); process.env[key] = value; } };
  env({ DEEPSEEK_API_KEY: 'synthetic-ai6-only', DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_CHAT_MODEL: 'deepseek-flash', DEEPSEEK_API_BASE_URL: 'https://api.deepseek.com',
    AI_PROVIDER_QUICK: 'deepseek', AI_PROVIDER_PROFESSIONAL: 'deepseek', AI_MODEL_FALLBACK_ENABLED: 'false', AI_AGENT_MAX_TOKENS: '60000', AI_AGENT_MAX_ESTIMATED_USD: '.25' });
  const ids = Array.from({ length: 5 }, () => randomUUID());
  let mode = 'forbid', calls = 0, controller;
  const queryPlan = { operation: 'group_aggregate', metric: 'rent', groupBy: 'submarket', scope: { inventory: 'all_authorized' }, period: { year: 2026, quarter: 2 } };
  globalThis.fetch = async (url, init) => {
    if (new URL(String(url)).hostname !== 'api.deepseek.com') return originalFetch(url, init);
    calls++;
    assert.notEqual(mode, 'forbid', 'deterministic task contacted a supplier');
    const body = JSON.parse(init.body);
    if (body.messages.some(m => m.role === 'tool')) {
      if (mode === 'cancel') { controller.abort(); init.signal.throwIfAborted(); }
      return Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 });
    }
    return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: randomUUID(), type: 'function', function: { name: 'execute_query_plan', arguments: JSON.stringify({ plan: queryPlan }) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 30 } });
  };
  async function submit(who, question, extra = {}) {
    calls = 0; controller = new AbortController();
    const started = performance.now();
    const before = fixture.semanticCalls() + fixture.calls();
    const request = new Request(app + '/api/intelligence/query/agent', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, signal: controller.signal,
      body: JSON.stringify({ idempotencyKey: randomUUID(), question, conversation: { id: randomUUID() }, ...extra }) });
    // Core fast paths exercise the built Next route over real HTTP. Fault
    // injection uses that same handler with a synthetic supplier transport.
    const response = mode === 'forbid' ? await originalFetch(request)
      : await handle(request, { client: service, keys, enabled: true });
    calls += fixture.semanticCalls() + fixture.calls() - before;
    const body = await response.json(), durationMs = Math.round(performance.now() - started);
    console.log('AI6_EXECUTION_SAMPLE ' + JSON.stringify({ question, status: response.status, durationMs,
      supplierCalls: calls, toolCalls: body.agent?.toolCalls, route: body.agent?.executionRoute, executionStatus: body.agent?.executionStatus }));
    return { status: response.status, body, calls, durationMs };
  }
  const grant = (who, caps = exportCaps) => grantQuery({ setup: db }, who.id, { capabilities: caps,
    fields: ['height', 'netEffectiveRent', 'totalArea', 'vacantArea'], allBuildings: false, buildingIds: ids.slice(0, 4) });
  let owner, other, grouped;
  const photoBucket = service.storage.from('building-sales-materials');
  const storedPhotos = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      await db.query('insert into public.buildings(id,name,submarket,grade,tracking_scope) values($1,$2,$3,$4,$5)',
        [ids[i], `合成AI6-${i + 1}`, i === 2 ? '金融街' : 'CBD', i === 1 ? 'B' : 'A', i === 2 ? 'reference_only' : 'tracked']);
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft,is_locked,locked_at,locked_by)
        values($1,2026,2,10000,$2,$3,false,true,now(),$1)`, [ids[i], [80, 120, 200, null, 999][i], [0, 1000, 2000, null, 0][i]]);
    }
    owner = await person('admin', 'ai6-owner'); other = await person('admin', 'ai6-other'); await grant(owner); await grant(other);
    await check('AI6 / 全部获权按子市场保留非跟踪楼宇、缺失与正式加权口径，零模型调用', async () => {
      grouped = await submit(owner, '2026Q2全部获权楼宇净有效租金按子市场比较');
      assert.equal(grouped.status, 200, JSON.stringify(grouped.body)); assert.equal(grouped.calls, 0);
      assert.equal(grouped.body.agent.modelCalls, 0); assert.equal(grouped.body.agent.executionRoute, 'deterministic_query');
      assert.equal(grouped.body.result.parameters.executedPlan.scope.inventory, 'all_authorized');
      const value = (result, market) => result.table.rows.find(r => r.cells.name.value === market).cells.value.value.numeric;
      assert.equal(value(grouped.body.result, 'CBD'), 100); assert.equal(value(grouped.body.result, '金融街'), 200);
      const encoded = JSON.stringify(grouped.body.result);
      assert.ok(encoded.includes(ids[2]), 'non-tracked authorized source was dropped');
      assert.ok(!encoded.includes(ids[4]), 'ungranted source escaped');
      assert.deepEqual((await recover(owner, grouped.body.requestId)).body.result, grouped.body.result);
      assert.equal((await recover(other, grouped.body.requestId)).status, 403);
      const vacancy = await submit(owner, '2026Q2全部获权楼宇空置率按子市场比较');
      assert.equal(vacancy.status, 200, JSON.stringify(vacancy.body)); assert.equal(vacancy.calls, 0);
      assert.equal(value(vacancy.body.result, 'CBD'), .05); assert.equal(value(vacancy.body.result, '金融街'), .2);
      const periods = await submit(owner, '你能够查询哪些季度');
      assert.equal(periods.status, 200, JSON.stringify(periods.body)); assert.equal(periods.calls, 0);
      assert.match(periods.body.message, /2026Q2/); assert.match(periods.body.message, /不代表每栋楼/);
    });
    const buildingContext = async (who, reply, options = {}) => {
      const response = await originalFetch(app + '/api/intelligence/query/buildings', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token },
        body: JSON.stringify({ requestId: reply.requestId, resultId: reply.result.resultId, action: 'buildings', ...options }) });
      return { status: response.status, body: await response.json() };
    };
    const address = '合成路 8 号', metro = '楼书记录可前往合成地铁站';
    const dossiers = [[0, '合成国贸大厦A座（三期）', 80], [1, '合成海岳大厦B座', 120], [3, '合成通运中心A座', null]];
    await check('AI6 D1 / 三栋楼宇档案通过真实登录读取楼书、正式季度和私有 Storage 原图', async () => {
      const reader = await person('admin', 'ai6-dossier-sample');
      await grant(reader);
      await grantBusiness(db, reader.id, { modules: ['profile'], fields: ['address', 'metro'], allBuildings: false, buildingIds: [ids[0]] });
      for (const [index, label] of dossiers) await db.query('update public.buildings set former_names=$2,location_lng=116.46,location_lat=39.91 where id=$1',
        [ids[index], JSON.stringify([label])]);
      await db.query('insert into public.building_brochure_data(building_id,address,metro_access) values($1,$2,$3)', [ids[0], address, metro]);
      const photos = new Map();
      for (const [index, color] of [[0, '#254358'], [1, '#69553e']]) {
        const id = randomUUID(), path = `building-photos/v1/${ids[index]}/${id}/photo.png`;
        const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer();
        const digest = createHash('sha256').update(bytes).digest('hex');
        const source = `https://example.com/ai6-fixture/building-${index}`;
        const uploaded = await photoBucket.upload(path, bytes, { contentType: 'image/png', upsert: false });
        assert.equal(uploaded.error, null, 'fixture must be installed in private Storage');
        storedPhotos.push({ id, path });
        await db.query(`insert into public.building_photos(id,building_id,image_url,source_url,source_name,caption,photo_kind,storage_path,width,height,sha256,file_size,status)
          values($1,$2,$3,$4,'合成照片出处','合成楼宇照片','exterior',$5,32,24,$6,$7,'ready')`,
          [id, ids[index], `${source}/original.png`, source, path, digest, bytes.length]);
        photos.set(index, { id, source, path, digest });
      }
      const location = await submit(reader, '合成国贸大厦A座（三期）在哪个子市场？');
      assert.equal(location.status, 200, JSON.stringify(location.body)); assert.equal(location.calls, 0);
      assert.match(location.body.message, /^[^。！？\n]*CBD[^。！？\n]*。$/u);
      const photoRequests = [];
      for (const [index, label, rent] of dossiers) {
        const response = await submit(reader, `介绍${label}，并附上照片、地址和最新正式季度净有效租金、空置率`);
        assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.calls, 0);
        assert.deepEqual(response.body.result.table.rows.map(row => row.entityId), [ids[index]]);
        const [row] = response.body.result.table.rows;
        if (rent === null) assert.equal(row.cells.netEffectiveRent?.kind ?? 'unknown', 'unknown');
        else assert.equal(row.cells.netEffectiveRent.value.numeric, rent);
        const context = await buildingContext(reader, response.body);
        assert.equal(context.status, 200, JSON.stringify(context.body));
        assert.deepEqual(context.body.buildings.map(row => row.id), [ids[index]]);
        const photo = photos.get(index);
        assert.equal(context.body.buildings[0].photo?.id ?? null, photo?.id ?? null);
        assert.equal(context.body.photoAccess, undefined, 'directory only returns photo metadata');
        if (photo) {
          const options = { buildingId: ids[index], photoId: photo.id, limit: 1 };
          const signed = await buildingContext(reader, response.body, options);
          assert.equal(signed.status, 200, JSON.stringify(signed.body));
          const access = signed.body.photoAccess;
          assert.equal(access.source_url, photo.source);
          assert.equal(access.source_name, '合成照片出处');
          assert.equal(access.is_preview, false);
          const signedUrl = new URL(access.url);
          assert.equal(signedUrl.hostname, '127.0.0.1');
          assert.ok(signedUrl.pathname.endsWith(`/object/sign/building-sales-materials/${photo.path}`));
          assert.ok(signedUrl.searchParams.has('token'));
          const image = await originalFetch(signedUrl, { redirect: 'error' });
          assert.equal(image.status, 200);
          assert.match(image.headers.get('content-type'), /^image\/png\b/);
          const bytes = Buffer.from(await image.arrayBuffer());
          assert.equal(createHash('sha256').update(bytes).digest('hex'), photo.digest);
          const decoded = await sharp(bytes).metadata();
          assert.equal(decoded.width, 32); assert.equal(decoded.height, 24);
          assert.ok((await reader.client.storage.from('building-sales-materials').download(photo.path)).error, 'private original must not be directly accessible');
          const delivery = (await events(signed.body.attemptId)).find(event => event.kind === 'response_generated');
          const audited = decrypt(delivery).content.result.buildingMetadata;
          assert.equal(audited.photoSource.sourceUrl, photo.source);
          assert.equal(JSON.stringify(audited).includes(signedUrl.searchParams.get('token')), false);
          photoRequests.push({ reply: response.body, options });
        }
        if (index === 0) {
          const dossier = response.body.answerSelection.results.find(item => item.role === 'supporting').result;
          assert.equal(dossier.table.rows[0].cells.address.value, address);
          assert.ok(dossier.sources.some(source => source.table === 'building_brochure_data' && source.field === 'address'));
          assert.equal((await buildingContext(other, response.body)).status, 403);
        } else assert.ok(!JSON.stringify(response.body).includes(address));
      }
      const [first, second] = photoRequests;
      for (const denied of [await buildingContext(other, first.reply, first.options),
        await buildingContext(reader, first.reply, { ...first.options, photoId: second.options.photoId })]) {
        assert.equal(denied.status, 403); assert.equal(denied.body.photoAccess, undefined);
      }
      await db.query("update public.building_photos set status='archived' where id=$1", [first.options.photoId]);
      const retired = await buildingContext(reader, first.reply, first.options);
      assert.equal(retired.status, 403); assert.equal(retired.body.photoAccess, undefined);
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [reader.id]);
      const revoked = await buildingContext(reader, second.reply, second.options);
      assert.equal(revoked.status, 403); assert.equal(revoked.body.photoAccess, undefined);
    });
    await check('AI6 D3 / 真实办公初筛把楼书交通、候选地图和待核验的步行距离分开交付', async () => {
      const broker = await person('admin', 'ai6-site-broker');
      await grant(broker);
      await grantBusiness(db, broker.id, { modules: ['profile'], fields: ['metro'], allBuildings: false, buildingIds: [ids[0]] });
      const response = await submit(broker, '金融企业在CBD选址租赁2000平方米，预算300元/平方米/月，只看甲级，地铁步行800米内，重视形象并给出地图');
      assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.calls, 0);
      assert.deepEqual(response.body.result.table.rows.map(row => row.entityId), [ids[0]]);
      assert.equal(response.body.answerSelection.status, 'partial');
      assert.match(response.body.answerSelection.notice, /2000 ㎡连续可租面积/);
      assert.match(response.body.answerSelection.notice, /尚无可核验的 800 米步行路径/);
      const dossier = response.body.answerSelection.results.find(item => item.role === 'supporting').result;
      assert.equal(dossier.table.rows[0].cells.metro.value, metro);
      assert.deepEqual(response.body.result.parameters.agentMap.buildingIds, [ids[0]]);
      const selected = await buildingContext(broker, response.body, { mapSelection: true });
      assert.equal(selected.status, 200, JSON.stringify(selected.body));
      assert.deepEqual(selected.body.buildings.map(row => [row.id, row.located]), [[ids[0], true]]);
      assert.equal((await buildingContext(other, response.body, { mapSelection: true })).status, 403);
      const walking = await submit(broker, '步行不超过800米的办公选址');
      assert.equal(walking.status, 200, JSON.stringify(walking.body)); assert.equal(walking.calls, 0);
      assert.equal(walking.body.agent.executionStatus, 'limited');
      assert.equal(walking.body.result, undefined);
      assert.match(walking.body.message, /800 米.*目标地铁站.*直线距离初筛/);
    });
    await check('AI6 T16 / 站点和获权楼宇的直线初筛同源交付地图、Excel、历史和撤权', async () => {
      const walker = await person('admin', 'ai6-metro-screening');
      await grant(walker);
      const publicMap = JSON.parse(await readFile(new URL('../../public/data/beijing_map_data.json', import.meta.url), 'utf8'));
      const stationLine = publicMap.subways.find(line => line.stations.some(item => item.name === '国贸'));
      const station = stationLine.stations.find(item => item.name === '国贸');
      const [lng, lat] = station.center;
      // One point coincides with the station. The second is 0.001 degrees
      // north (about 111 metres). Put both an ungranted and a reference-only
      // point inside the radius, plus a tracked building without coordinates.
      for (const [index, latitude] of [[0, lat], [1, lat + .001], [2, lat], [3, null], [4, lat]])
        await db.query('update public.buildings set location_lng=$2,location_lat=$3 where id=$1', [ids[index], latitude === null ? null : lng, latitude]);
      const response = await submit(walker, '地铁国贸站步行不超过800米的办公选址，给出地图链接');
      assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.calls, 0);
      assert.equal(response.body.agent.executionStatus, 'partial');
      assert.equal(response.body.answerSelection.status, 'partial');
      assert.match(response.body.message, /2 栋.*直线 800 米.*另有 1 栋.*实际步行路线待核验/);
      const { result, requestId } = response.body;
      assert.deepEqual(result.table.rows.map(row => [row.entityId, row.cells.metroStation.value, row.cells.metroStraightLine.value.numeric]),
        [[ids[0], '国贸站', 0], [ids[1], '国贸站', 111]]);
      const refs = result.table.rows[0].cells.metroStraightLine.sourceIds.map(id => result.sources.find(source => source.id === id));
      assert.deepEqual(refs.map(source => [source.table, source.recordId, source.rawValue]),
        [['buildings', ids[0], null], ['map_subway_stations', station.id, `国贸站 · ${stationLine.name} · ${station.center.join(', ')}`]]);
      const nearest = await submit(walker, '在CBD，地铁站步行不超过800米的办公选址，不要地图');
      assert.equal(nearest.status, 200, JSON.stringify(nearest.body)); assert.equal(nearest.calls, 0);
      assert.equal(nearest.body.result.parameters.agentMap, undefined);
      assert.deepEqual(nearest.body.result.table.rows.map(row => [row.entityId, row.cells.metroStation.value]), [[ids[0], '国贸站'], [ids[1], '国贸站']]);
      const selected = await buildingContext(walker, response.body, { mapSelection: true });
      assert.equal(selected.status, 200, JSON.stringify(selected.body));
      assert.deepEqual(selected.body.buildings.map(row => row.id), ids.slice(0, 2));
      const request = { requestId, resultId: result.resultId, action: 'export', format: 'xlsx' };
      const generated = await submit(walker, '把刚才的结果导出Excel',
        { conversation: { id: response.body.conversation.id, parentRequestId: requestId } });
      assert.equal(generated.status, 200, JSON.stringify(generated.body)); assert.equal(generated.calls, 0);
      assert.deepEqual(generated.body.result.parameters.metroScreeningBindings, [result.parameters.metroScreening]);
      const downloadable = await artifact(walker, { ...request, requestId: generated.body.requestId, resultId: generated.body.result.resultId });
      assert.equal(downloadable.status, 200);
      const workbook = XLSX.read(downloadable.bytes, { type: 'array' });
      const table = XLSX.utils.sheet_to_json(workbook.Sheets['数据'], { header: 1 });
      const distanceColumn = table[0].findIndex(label => String(label).includes('距站点直线距离'));
      assert.notEqual(distanceColumn, -1);
      assert.deepEqual(table.slice(1).map(row => row[distanceColumn]), [0, 111]);
      assert.equal((await recover(walker, requestId)).body.result.resultId, result.resultId);
      assert.equal((await recover(other, requestId)).status, 403);
      await db.query('update public.buildings set location_lat=location_lat+.002 where id=$1', [ids[1]]);
      assert.equal((await artifact(walker, request)).status, 403);
      await db.query('update public.buildings set location_lat=$2 where id=$1', [ids[1], lat + .001]);
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [walker.id]);
      assert.equal((await buildingContext(walker, response.body, { mapSelection: true })).status, 403);
    });
    await check('AI6 / 三市场澄清及六轮排名使用真实登录、正式快照与可读工作簿', async () => {
      const catalog = [
        { market: 'CBD', grade: 'P', rent: 260, area: 30000, vacancy: 6000 },
        { market: 'CBD', grade: 'A', rent: 210, area: 10000, vacancy: 1200 },
        { market: 'CBD', grade: 'A', rent: 190, area: 20000, vacancy: 3000 },
        { market: '金融街', grade: 'A', rent: 225, area: 20000, vacancy: 2000 },
        { market: '金融街', grade: 'B', rent: 230, area: 10000, vacancy: 500 },
        { market: '望京-酒仙桥', grade: 'A', rent: 175, area: 15000, vacancy: 1500 },
      ].map((row, i) => ({ ...row, id: randomUUID(), name: `合成续问楼宇-${i + 1}` }));
      for (const row of catalog) {
        await db.query('insert into public.buildings(id,name,submarket,grade,tracking_scope) values($1,$2,$3,$4,$5)',
          [row.id, row.name, row.market, row.grade, 'tracked']);
        await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft,is_locked,locked_at,locked_by)
          values($1,2026,2,$2,$3,$4,false,true,now(),$1)`, [row.id, row.area, row.rent, row.vacancy]);
      }
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft,is_locked)
        values($1,2026,3,30000,999,0,true,false)`, [catalog[0].id]);
      const analyst = await person('admin', 'ai6-multiturn');
      await grantQuery({ setup: db }, analyst.id, { capabilities: exportCaps, fields: ['netEffectiveRent', 'totalArea', 'vacantArea'],
        allBuildings: false, buildingIds: catalog.map(row => row.id) });
      const ask = async (question, parent) => {
        const run = await submit(analyst, question, parent ? { conversation: { id: parent.conversation.id, parentRequestId: parent.requestId } } : {});
        assert.equal(run.status, 200, JSON.stringify(run.body));
        assert.equal(run.calls, 0);
        return run.body;
      };
      const clarify = await ask('比较2026Q2 CBD、金融街和望京的租金、空置率和市场存量，按子市场列出表格');
      assert.match(clarify.message, /请选择要比较的指标/);
      const grouped = await ask('净有效租金', clarify);
      assert.equal(grouped.result.table.rows.length, 3);
      for (const row of grouped.result.table.rows) {
        const sample = catalog.filter(item => item.market === row.cells.name.value);
        const area = sample.reduce((sum, item) => sum + item.area, 0);
        const rent = sample.reduce((sum, item) => sum + item.rent * item.area, 0) / area;
        const vacancy = sample.reduce((sum, item) => sum + item.vacancy, 0) / area;
        for (const [key, expected, unit] of [['value', rent, 'CNY/m2/month'], ['vacancy_value', vacancy, 'ratio'], ['totalArea_value', area, 'm2']]) {
          assert.equal(row.cells[key].value.numeric, expected);
          assert.equal(grouped.result.table.columns.find(column => column.key === key).unit, unit);
          assert.ok(row.cells[key].sourceIds.length > 0);
        }
        for (const key of ['usedCount', 'vacancy_usedCount', 'totalArea_usedCount']) assert.equal(row.cells[key].value.numeric, sample.length);
      }
      const start = await ask('CBD最新正式季度净有效租金前两栋');
      const idsIn = reply => reply.result.table.rows.map(row => row.entityId);
      assert.deepEqual(start.result.parameters.executedPlan.period, { year: 2026, quarter: 2 });
      assert.deepEqual(idsIn(start), [catalog[0].id, catalog[1].id]);
      const strict = await ask('只保留甲级', start);
      assert.deepEqual(idsIn(strict), [catalog[1].id, catalog[2].id]);
      const projected = await ask('再加空置率和建筑面积', strict);
      assert.deepEqual(idsIn(projected), idsIn(strict));
      assert.deepEqual(projected.result.table.rows.map(row => row.cells.vacancy.value.numeric), [.12, .15]);
      assert.equal(projected.answerSelection.status, 'partial');
      const moved = await ask('金融街呢', projected);
      assert.deepEqual(idsIn(moved), [catalog[3].id]);
      assert.deepEqual(moved.result.parameters.executedPlan.scope.submarkets, ['金融街']);
      const compared = await ask('把这两个子市场并排比较', moved);
      const expectedIds = [projected.result.resultId, moved.result.resultId];
      assert.deepEqual(compared.answerSelection.results.map(item => item.result.resultId), expectedIds);
      assert.deepEqual((await recover(analyst, compared.requestId)).body.answerSelection.results.map(item => item.result.resultId), expectedIds);
      const exported = await ask('把刚才的对比导出 Excel', compared);
      assert.deepEqual(exported.result.parameters.agentExport.selection.resultIds, expectedIds);
      const download = { requestId: exported.requestId, resultId: exported.result.resultId, action: 'export', format: 'xlsx' };
      const file = await artifact(analyst, download);
      assert.equal(file.status, 200);
      const book = XLSX.read(file.bytes, { type: 'array' });
      const values = book.SheetNames.filter(name => !['来源', '口径与快照'].includes(name))
        .flatMap(name => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1 }).flat());
      for (const index of [1, 2, 3]) assert.ok(values.includes(catalog[index].name));
      for (const index of [0, 4, 5]) assert.ok(!values.includes(catalog[index].name));
      assert.equal((await artifact(other, download)).status, 403);
      const licensed = await person('admin', 'ai6-dossier-projection');
      const licensedIds = [catalog[0].id, catalog[1].id];
      await grantQuery({ setup: db }, licensed.id, { capabilities: exportCaps, fields: ['netEffectiveRent', 'totalArea', 'vacantArea'],
        allBuildings: false, buildingIds: licensedIds });
      await grantBusiness(db, licensed.id, { modules: ['profile'], fields: ['gfaTotal'], allBuildings: false, buildingIds: licensedIds });
      for (const [index, id] of licensedIds.entries()) await db.query(
        'insert into public.building_brochure_data(id,building_id,gfa_total) values($1,$2,$3)', [randomUUID(), id, 50000 + index * 1000]);
      const base = await submit(licensed, '2026Q2 CBD净有效租金前两栋');
      assert.equal(base.status, 200, JSON.stringify(base.body));
      const projectedGfa = await submit(licensed, '再加空置率和建筑面积', {
        conversation: { id: base.body.conversation.id, parentRequestId: base.body.requestId },
      });
      assert.equal(projectedGfa.status, 200, JSON.stringify(projectedGfa.body));
      assert.equal(projectedGfa.calls, 0);
      assert.equal(projectedGfa.body.answerSelection.status, 'answered');
      assert.deepEqual(idsIn(projectedGfa.body), licensedIds);
      assert.deepEqual(projectedGfa.body.result.table.rows.map(row => row.cells.gfaTotal.value.numeric), [50000, 51000]);
      assert.equal((await recover(licensed, projectedGfa.body.requestId)).status, 200);
      await db.query('update private.ai_business_research_grants set enabled=false where user_id=$1', [licensed.id]);
      assert.equal((await recover(licensed, projectedGfa.body.requestId)).status, 403);
    });
    await check('AI6 / 已重新鉴权的上一轮快照直接生成CSV与图表，不重新查数或调用供应商', async () => {
      const conversation = { id: grouped.body.conversation.id, parentRequestId: grouped.body.requestId };
      const sorted = await submit(owner, '按净有效租金从高到低排列', { conversation });
      assert.equal(sorted.status, 200, JSON.stringify(sorted.body)); assert.equal(sorted.calls, 0);
      assert.equal(sorted.body.result.parameters.agentTableView.sort.direction, 'desc');
      const exported = await submit(owner, '把刚才的结果导出CSV', { conversation });
      assert.equal(exported.status, 200, JSON.stringify(exported.body)); assert.equal(exported.calls, 0);
      assert.ok(exported.body.result.parameters.agentExport); assert.equal(exported.body.agent.toolCalls, 2);
      const chart = await submit(owner, '把刚才的结果画成图', { conversation });
      assert.equal(chart.status, 200, JSON.stringify(chart.body)); assert.equal(chart.calls, 0);
      assert.ok(chart.body.result.parameters.agentChart); assert.equal(chart.body.agent.toolCalls, 2);
      for (const [label, format, extension] of [['PNG', 'png_zip', '.png'], ['SVG', 'svg_zip', '.svg']]) {
        const image = await submit(owner, '导出' + label, { conversation: { id: chart.body.conversation.id, parentRequestId: chart.body.requestId } });
        assert.equal(image.status, 200, JSON.stringify(image.body)); assert.equal(image.calls, 0);
        assert.equal(image.body.agent.executionStatus, 'completed');
        const downloaded = await artifact(owner, { requestId: image.body.requestId, resultId: image.body.result.resultId, action: 'export', format,
          chart: image.body.result.parameters.agentChart.request });
        assert.equal(downloaded.status, 200, JSON.stringify(downloaded.body));
        const zip = await JSZip.loadAsync(downloaded.bytes);
        const file = Object.values(zip.files).find(f => f.name.endsWith(extension)); assert.ok(file);
        if (label === 'PNG') assert.deepEqual([...(await file.async('uint8array')).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        else assert.match(await file.async('string'), /<svg/);
      }
    });
    await check('AI6 / 历史CBD Top10故障生成真实可读Excel，零模型调用且下载检查独立资格', async () => {
      const reply = await submit(owner, '把CBD在2026Q2净有效租金最高的10栋楼导出Excel');
      assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.calls, 0);
      assert.equal(reply.body.agent.executionStatus, 'completed');
      const request = { requestId: reply.body.requestId, resultId: reply.body.result.resultId, action: 'export', format: 'xlsx' };
      const file = await artifact(owner, request); assert.equal(file.status, 200);
      const book = XLSX.read(file.bytes, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
      assert.equal(rows.length, 3); assert.ok(rows[1].includes('合成AI6-2')); assert.ok(rows[1].includes(120));
      assert.ok(rows[2].includes('合成AI6-1')); assert.ok(rows[2].includes(80));
      assert.equal((await artifact(other, request)).status, 403);
      await grant(owner, ['query:catalog', 'query:brochure', 'query:quarter']);
      assert.equal((await artifact(owner, request)).status, 403); await grant(owner);
    });
    await check('AI6 / 连续上下界筛选经加密恢复后导出相同范围，零模型调用且拒绝跨账号与撤权下载', async () => {
      const analyst = await person('admin', 'ai6-filter-owner'); await grant(analyst);
      let reply = await submit(analyst, 'CBD在2026Q2净有效租金最高的10栋楼');
      assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.calls, 0);
      const rows = JSON.stringify(reply.body.result.table.rows), sources = JSON.stringify(reply.body.result.sources);
      for (const question of ['筛选净有效租金至少90元/平方米/月', '筛选净有效租金不超过150元/平方米/月', '筛选净有效租金至少110元/平方米/月', '按租金从低到高排列']) {
        reply = await submit(analyst, question, { conversation: { id: reply.body.conversation.id, parentRequestId: reply.body.requestId } });
        assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.calls, 0);
        assert.equal(JSON.stringify(reply.body.result.table.rows), rows);
        assert.equal(JSON.stringify(reply.body.result.sources), sources);
        const restored = await recover(analyst, reply.body.requestId);
        assert.equal(restored.status, 200); assert.deepEqual(restored.body.result, reply.body.result);
      }
      assert.deepEqual(reply.body.result.parameters.agentTableView.filters.map(f => [f.operator, f.value]), [['lte', '150'], ['gte', '110']]);
      const buildingRequest = { requestId: reply.body.requestId, resultId: reply.body.result.resultId, action: 'buildings', mapSelection: true, offset: 0, limit: 500 };
      const buildings = async who => {
        const response = await originalFetch(app + '/api/intelligence/query/buildings', { method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + who.token }, body: JSON.stringify(buildingRequest) });
        return { status: response.status, body: await response.json() };
      };
      const selected = await buildings(analyst);
      assert.equal(selected.status, 200, JSON.stringify(selected.body));
      assert.deepEqual(selected.body.buildings.map(row => row.id), [ids[1]]);
      assert.equal((await buildings(other)).status, 403);
      const chart = await submit(analyst, '把刚才的结果画成柱状图', { conversation: { id: reply.body.conversation.id, parentRequestId: reply.body.requestId } });
      assert.equal(chart.status, 200, JSON.stringify(chart.body)); assert.equal(chart.calls, 0);
      assert.equal(JSON.stringify(chart.body.result.table.rows), rows);
      const image = await artifact(analyst, { requestId: chart.body.requestId, resultId: chart.body.result.resultId,
        action: 'export', format: 'svg_zip', chart: chart.body.result.parameters.agentChart.request });
      assert.equal(image.status, 200, JSON.stringify(image.body));
      const zip = await JSZip.loadAsync(image.bytes), svg = Object.values(zip.files).find(file => file.name.endsWith('.svg'));
      assert.ok(svg); const rendered = await svg.async('string');
      assert.ok(rendered.includes('合成AI6-2')); assert.ok(!rendered.includes('合成AI6-1'));
      const exported = await submit(analyst, '把刚才的结果导出Excel', { conversation: { id: reply.body.conversation.id, parentRequestId: reply.body.requestId } });
      assert.equal(exported.status, 200, JSON.stringify(exported.body)); assert.equal(exported.calls, 0);
      assert.deepEqual(exported.body.result.table.rows.map(r => r.entityId), [ids[1]]);
      const request = { requestId: exported.body.requestId, resultId: exported.body.result.resultId, action: 'export', format: 'xlsx' };
      const file = await artifact(analyst, request); assert.equal(file.status, 200);
      const book = XLSX.read(file.bytes, { type: 'array' });
      const data = XLSX.utils.sheet_to_json(book.Sheets['数据'], { header: 1 });
      assert.equal(data.length, 2); assert.ok(data[1].includes('合成AI6-2')); assert.ok(data[1].includes(120));
      assert.equal((await artifact(other, request)).status, 403);
      await grant(analyst, ['query:catalog', 'query:brochure', 'query:quarter']);
      assert.equal((await artifact(analyst, request)).status, 403);
      assert.equal((await artifact(analyst, { requestId: chart.body.requestId, resultId: chart.body.result.resultId,
        action: 'export', format: 'svg_zip', chart: chart.body.result.parameters.agentChart.request })).status, 403);
    });
    await check('AI6 / 供应商总结失败仍交付正式结果并可从加密历史恢复', async () => {
      // Earlier query/artifact requests intentionally consume real receipt caps.
      // A separate real actor isolates the supplier-failure behavior without
      // bypassing or increasing the production account admission limit.
      owner = await person('admin', 'ai6-model-owner'); await grant(owner);
      mode = 'fail'; const reply = await submit(owner, '复合核对全部获权楼宇的季度市场资料');
      assert.equal(reply.status, 200, JSON.stringify(reply.body)); assert.equal(reply.body.agent.executionStatus, 'partial');
      assert.ok(reply.body.result); assert.equal(reply.calls, 2);
      assert.deepEqual((await recover(owner, reply.body.requestId)).body.result, reply.body.result);
      const recorded = (await events(reply.body.requestId)).filter(e => e.kind === 'accounting').map(decrypt).map(e => e.content);
      assert.equal(recorded.filter(c => c.protocol === 'agent-model-attempt/1').length, 2);
    });
    await check('AI6 / 请求中断后保留普通正式结果检查点，撤权仍拒绝恢复', async () => {
      mode = 'cancel'; const reply = await submit(owner, '复合核对全部获权楼宇的季度市场资料');
      assert.equal(reply.status, 409, JSON.stringify(reply.body));
      assert.match(reply.body.error, /历史恢复/);
      assert.equal((await recover(owner, reply.body.requestId)).status, 200);
      await db.query('update private.ai_query_grants set enabled=false where user_id=$1', [owner.id]);
      assert.equal((await recover(owner, reply.body.requestId)).status, 403);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (storedPhotos.length) {
      await db.query('delete from public.building_photos where id=any($1::uuid[])', [storedPhotos.map(photo => photo.id)]);
      await photoBucket.remove(storedPhotos.map(photo => photo.path));
    }
  }
}
