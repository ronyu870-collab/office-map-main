// Run against a fresh disposable localhost stack using PITCH_AUTH_STATUS.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import sharp from "sharp";
import { grantQuery } from "../../supabase/tests/ai-query-authority/database.mjs";
import { BUILDINGS } from "../../supabase/tests/ai-query-authority/snapshot-fixture.mjs";
import { grantBusiness, installBusinessFixture } from "../../supabase/tests/ai-business-research/fixture.mjs";
import { grantLeaseResearch, installLeaseResearchFixture, seedLeaseResearch } from "../../supabase/tests/ai-lease-research/fixture.mjs";
import { installPitchDataFixture } from "../../supabase/tests/pitch-studio/business-data-fixture.mjs";
import { verifyPitchBuildingInspectorBrowser, verifyPitchChartRevisionBrowser, verifyPitchFlagshipBrowser,
  verifyPitchImageReplacementBrowser } from "./pitch-workspace-browser.mjs";

assert.equal(process.env.PITCH_TEST_ALLOW_LOCAL, "disposable");
const settings = JSON.parse(await readFile(process.env.PITCH_AUTH_STATUS, "utf8"));
for (const url of [settings.API_URL, settings.DB_URL]) assert.equal(new URL(url).hostname, "127.0.0.1");
const appPort = process.env.PITCH_TEST_APP_PORT ?? "3291";
assert.match(appPort, /^\d{1,5}$/);
assert.ok(Number(appPort) > 0 && Number(appPort) <= 65535);
const app = `http://127.0.0.1:${appPort}`;
const db = new pg.Client({ connectionString: settings.DB_URL });
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, authOptions);
const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: settings.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.ANON_KEY,
  SUPABASE_SECRET_KEY: settings.SERVICE_ROLE_KEY,
  PITCH_STUDIO_ENABLED: "true",
  DEEPSEEK_API_KEY: "",
  OPENAI_API_KEY: "",
  NEXT_PUBLIC_AMAP_KEY: "syntheticfixture",
};
const directory = new URL("../../supabase/migrations/", import.meta.url);
const gallery = 'building-sales-materials';

async function addPhoto(buildingId, index, caption = "隔离合成视觉素材") {
  const id = randomUUID();
  const path = `building-photos/v1/${buildingId}/${id}/isolated-fixture.png`;
  const width = 1120, height = 720;
  const image = await sharp({ create: { width, height, channels: 3,
    background: { r: 36 + index * 19, g: 85, b: 116 } } }).png().toBuffer();
  const uploaded = await service.storage.from(gallery).upload(path, image, { contentType: 'image/png' });
  assert.equal(uploaded.error, null);
  await db.query(`insert into public.building_photos(id,building_id,storage_path,sha256,file_size,width,height,
    photo_kind,caption,sort_order,source_url,source_name,attribution_text,collected_at,status)
    values($1,$2,$3,$4,$5,$6,$7,'exterior',$8,$9,'https://example.com/fixture','隔离测试','合成样本',now(),'ready')`,
  [id,buildingId,path,createHash('sha256').update(image).digest('hex'),image.length,width,height,caption,index]);
}

async function seed() {
  await db.query(`create schema if not exists private;
    create table if not exists public.user_roles(user_id uuid primary key references auth.users(id),
      role text not null,email text,chinese_name text,full_name text);
    grant select on public.user_roles to service_role`);
  const migrations = (await readdir(directory)).filter(name => /^\d{14}_pitch_.+\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    await db.query(await readFile(new URL(migration, directory), "utf8"));
  }
  const email = `pitch-flagship-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url") + "aA1!";
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null);
  const id = created.data.user.id;
  await db.query("insert into public.user_roles(user_id,role) values($1,'admin')", [id]);
  await db.query("update private.pitch_control set enabled=true");
  await db.query(`insert into private.pitch_grants(user_id,organization_id,region,city,business_line,can_generate,valid_until,granted_by)
    values($1,'synthetic-org','华北','北京','office',true,now()+interval '1 day',$1)`, [id]);
  await installPitchDataFixture({ setup: db });
  await installBusinessFixture(db);
  await grantBusiness(db, id, { modules: ['profile', 'submarket', 'stacking'], allSubmarkets: true });
  const leaseSchema = await readFile(new URL('../../supabase/tests/lease-expiry/fixture.sql', import.meta.url), 'utf8');
  const liveTable = leaseSchema.indexOf('create table public.lease_transactions(');
  const historyTable = leaseSchema.indexOf('create table public.lease_transactions_history(');
  assert.ok(liveTable >= 0 && historyTable > liveTable);
  await db.query(leaseSchema.slice(liveTable, historyTable));
  await db.query('alter table public.lease_transactions alter column submitter_id type varchar using submitter_id::text');
  await installLeaseResearchFixture(db);
  await seedLeaseResearch(db, BUILDINGS);
  await grantLeaseResearch(db, id);
  const baseSchema = await readFile(new URL('20260730043721_create_colliers_lite_schema.sql', directory), 'utf8');
  const auditTable = baseSchema.match(/create table public\.audit_logs \([\s\S]*?\n\);/)?.[0];
  assert.ok(auditTable);
  await db.query(auditTable);
  await db.query('grant insert on public.audit_logs to service_role');
  await db.query('grant usage on sequence public.audit_logs_id_seq to service_role');
  const auditGovernance = await readFile(new URL('20261121105118_audit_2_query_and_session_governance.sql', directory), 'utf8');
  const auditReceipt = auditGovernance.match(/create table public\.audit_operation_receipts [\s\S]*?(?=create function public\.audit_complete_operation)/)?.[0];
  assert.ok(auditReceipt);
  await db.query(auditReceipt);
  for (const migration of ['20261114070036_ai_legacy_admin_session.sql', '20261121140949_fix_audit_export_role_check.sql']) {
    await db.query(await readFile(new URL(migration, directory), 'utf8'));
  }
  await db.query(`grant select on public.stacking_plan_sources, public.stacking_plan_towers,
    public.stacking_plan_floors, public.stacking_plan_spaces to service_role`);
  await db.query("update private.ai_query_control set enabled=true");
  await grantQuery({ setup: db }, id, {
    capabilities: ["query:catalog", "query:brochure", "query:quarter", "export:internal"],
    fields: ["height", "floors", "parking", "totalArea", "vacantArea", "netEffectiveRent"],
  });
  await db.query(`create table public.building_photos(id uuid primary key, building_id uuid not null references public.buildings(id),
    storage_path text, sha256 text, file_size integer, width integer, height integer, photo_kind text, caption text, sort_order integer,
    source_url text, source_name text, license_url text, attribution_text text, collected_at timestamptz, status text);
    alter table public.building_photos enable row level security;
    grant select on public.building_photos, public.buildings to service_role;`);
  const bucket = await service.storage.createBucket(gallery, { public: false });
  assert.equal(bucket.error, null);
  // The catalogue queries use real landmark names with synthetic quarterly values.
  await db.query("update public.buildings set grade='B',city='北京' where id=any($1::uuid[])", [BUILDINGS]);
  const buildings = [
    ["霄云路33号", "燕莎"], ["五矿广场", "东二环"], ["国贸写字楼1座", "CBD"], ["国际财源中心（IFC）", "CBD"],
    ["新华保险大厦（NCI）", "CBD"], ["大家保险大厦B座", "CBD"], ["泰康金融大厦", "CBD"], ["金地中心", "CBD"],
    ["现代汽车大厦", "燕莎"], ["国航世纪大厦", "燕莎"], ["华瑞大厦", "燕莎"], ["佳程广场", "燕莎"],
  ];
  const replacementCandidates = [];
  for (const [index, [name, submarket]] of buildings.entries()) {
    const buildingId = randomUUID();
    if (submarket === "CBD") replacementCandidates.push({ id: buildingId, name });
    await db.query(`insert into public.buildings(id,name,submarket,grade,tracking_scope,city,location_lat,location_lng,completion_year,leasable_area)
      values($1,$2,$3,'A','tracked','北京',$4,$5,'2015',12500)`, [buildingId, name, submarket, 39.90 + index * 0.0012, 116.43 + index * 0.0015]);
    await addPhoto(buildingId, index);
    if (name === "五矿广场") await addPhoto(buildingId, 12, "隔离外立面备选");
    if (index === 0) {
      const sourceId = 'isolated-flagship-stacking';
      await db.query(`insert into public.stacking_plan_sources(id,building_id,title,source_as_of,as_of_kind,review_state)
        values($1,$2,'合成历史来源','2026-11-18','source_data_as_of','verified')`, [sourceId, buildingId]);
      for (const code of ['A', 'B']) {
        const tower = randomUUID(), floor = randomUUID();
        await db.query('insert into public.stacking_plan_towers(id,building_id,code,display_name) values($1,$2,$3,$4)',
          [tower, buildingId, code, code + ' 座']);
        await db.query(`insert into public.stacking_plan_floors(id,tower_id,floor_code,level_order,floor_area_sqm,source_id)
          values($1,$2,'10F',10,1000,$3)`, [floor, tower, sourceId]);
        await db.query(`insert into public.stacking_plan_spaces(floor_id,unit_code,occupancy_status,area_sqm,source_id)
          values($1,'1001','vacant',450,$2)`, [floor, sourceId]);
      }
    }
    await db.query("insert into public.building_brochure_data(building_id,building_height,parking_total,address,standard_floor_area,metro_access) values($1,$2,$3,'合成路一号',1500,'合成轨道交通')",
      [buildingId, 180 + index, 400 + index]);
    for (const [year, quarter] of [[2025, 4], [2026, 1], [2026, 2], [2026, 3]]) {
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,
        vacant_area,is_draft,is_locked,locked_at,locked_by) values($1,$2,$3,$4,$5,$6,false,true,now(),$7)`,
        [buildingId, year, quarter, 30000 + index * 2000, 100 + index * 12 + quarter, 1500 + index * 210, id]);
    }
  }
  await db.query(`insert into public.map_submarket_profiles(submarket,headline,overview,industries,transport,is_published,published_at)
    values('燕莎','合成区域定位','合成区域介绍','合成产业描述','合成轨道交通',true,now())`);
  await db.query("notify pgrst,'reload schema'");
  const client = createClient(settings.API_URL, settings.ANON_KEY, authOptions);
  const signed = await client.auth.signInWithPassword({ email, password });
  assert.equal(signed.error, null);
  return { id, client, token: signed.data.session.access_token, replacementCandidates };
}

async function createImageReplacementFixture(who) {
  await db.query("update private.pitch_grants set maintainer=true where user_id=$1", [who.id]);
  const authorization = { Authorization: `Bearer ${who.token}` };
  const request = async (path, command, write = true) => {
    const response = await fetch(`${app}/api/intelligence/pitch/${path}${write ? "" : `?${new URLSearchParams(command)}`}`, {
      method: write ? "POST" : "GET",
      headers: write ? { ...authorization, "Content-Type": "application/json" } : authorization,
      ...(write ? { body: JSON.stringify(command) } : {}),
    });
    const result = await response.json();
    assert.ok(response.ok, `${path} ${command.action} HTTP ${response.status}: ${result.code ?? result.error ?? ""}`);
    return result;
  };
  const scope = { organizationId: "synthetic-org", region: "华北", city: "北京", businessLine: "office" };
  const category = await db.query("select id from public.pitch_asset_categories where system_code='general'");
  assert.equal(category.rows.length, 1);
  async function ingest(name, background) {
    const image = await sharp({ create: { width: 960, height: 540, channels: 3, background } }).png().toBuffer();
    const prepared = await request("library", { action: "prepare", requestId: randomUUID(), filename: `${name}.png`, mime: "image/png",
      size: image.length, sha256: createHash("sha256").update(image).digest("hex"), metadata: { scope, language: "zh",
        dataAsOf: "2026-09-30", validFrom: null, validUntil: null, visibility: "organization", source: "隔离换图测试",
        tags: [], categoryId: category.rows[0].id, isTestData: true, allowClientExport: false } });
    const part = await fetch(`${app}/api/intelligence/pitch/library?jobId=${prepared.job.id}&position=0`, {
      method: "PUT", headers: { ...authorization, "Content-Type": "application/octet-stream" }, body: image,
    });
    assert.ok(part.ok, `image upload HTTP ${part.status}`);
    await request("library", { action: "finish", jobId: prepared.job.id });
    const deadline = Date.now() + 30_000;
    let status;
    do {
      status = await request("library", { action: "status", jobId: prepared.job.id }, false);
      assert.ok(status.job.state !== "failed" && Date.now() < deadline, `image ingest state ${status.job.state}`);
      if (status.job.state === "queued") await request("library", { action: "step", jobId: prepared.job.id });
      if (!["completed", "partially_completed"].includes(status.job.state)) await pause(200);
    } while (!["completed", "partially_completed"].includes(status.job.state));
    const pages = await request("library", { action: "search", kind: "pages", documentId: prepared.documentId }, false);
    await request("library", { action: "confirm", items: pages.items.map(page => ({ assetId: page.asset_id, expectedVersion: 1 })),
      acknowledgePartial: true });
    const media = await request("library", { action: "search", kind: "media", documentId: prepared.documentId, state: "published" }, false);
    assert.equal(media.items.length, 1);
    const { id, version } = media.items[0];
    return { id, version, documentId: prepared.documentId, name };
  }
  const first = await ingest("隔离原图", "#d0dae6");
  const replacement = await ingest("隔离备选图", "#aec2b4");
  const projectId = randomUUID();
  const created = await request("workspace", { action: "create", projectId, title: "隔离素材换图", scope,
    themeId: "colliers-default-v1", themeVersion: 2, context: {} });
  await request("workspace", { action: "custom", projectId, expectedVersion: created.project.version,
    title: "隔离图文页", body: "合成材料仅用于验收保存与导出。", image: { id: first.id, version: first.version, alt: "隔离原图" } });
  return { projectId, first, replacement };
}

await mkdir("tmp", { recursive: true });
const log = await open("tmp/pitch-flagship-http.log", "w", 0o600);
let server;
try {
  await db.connect();
  const version = (await db.query("select current_setting('server_version_num') as version")).rows[0].version;
  assert.equal(Math.floor(Number(version) / 10000), 17);
  const database = (await db.query("select to_regclass('public.pitch_projects') as projects, to_regclass('public.buildings') as buildings")).rows[0];
  assert.deepEqual(database, { projects: null, buildings: null }, "Use a fresh disposable database");
  const who = await seed();
  const stdio = ["ignore", log.fd, log.fd];
  if (process.env.PITCH_TEST_REUSE_BUILD !== "true") {
    const build = spawn("npm", ["run", "build"], { env, stdio });
    assert.equal((await once(build, "exit"))[0], 0, "Production build failed");
  }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", appPort],
    { env, stdio });
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (!ready && server.exitCode === null && Date.now() < deadline) {
    const reply = await fetch(app + "/api/intelligence/pitch?action=catalog", { signal: AbortSignal.timeout(2000) }).catch(() => null);
    ready = reply?.status === 401;
    if (!ready) await pause(200);
  }
  assert.ok(ready && server.exitCode === null, "Local Next app did not start");
  const quarterRevision = process.argv.includes("--quarter-revision");
  const competitorRevision = process.argv.includes("--competitor-revision");
  const imageReplacement = process.argv.includes("--image-replacement") ? await createImageReplacementFixture(who) : undefined;
  const verify = imageReplacement ? verifyPitchImageReplacementBrowser
    : quarterRevision || competitorRevision || process.argv.includes("--building-inspector") ? verifyPitchBuildingInspectorBrowser
    : process.argv.includes("--chart-revision") ? verifyPitchChartRevisionBrowser : verifyPitchFlagshipBrowser;
  const readWorkspace = async (action, projectId) => {
    const result = await fetch(app + "/api/intelligence/pitch/workspace", {
      method: "POST",
      headers: { Authorization: "Bearer " + who.token, "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectId }),
    });
    assert.equal(result.status, 200);
    return result.json();
  };
  await verify({
    app, who, period: quarterRevision ? "2026-Q2" : "2026-Q3", quarterRevision, competitorRevision, imageReplacement,
    replacementCandidates: who.replacementCandidates,
    requiredVisuals: { 'leasing-agency': ['photo', 'map', 'stacking-plan'], 'site-selection': ['photo', 'map'],
      'market-report': ['map'], 'building-promotion': ['photo', 'map'] },
    readProject: projectId => readWorkspace("get", projectId),
    readBindings: projectId => readWorkspace("document_bindings", projectId),
  });
  if (verify === verifyPitchFlagshipBrowser) {
    const audit = await db.query(`select distinct details->>'stage' as stage from public.audit_operation_receipts
      where action_type='STACKING_PLAN_EXPORT' and state='success' order by stage`);
    assert.deepEqual(audit.rows.map(row => row.stage), ['download', 'export']);
  }
} finally {
  if (server?.exitCode === null) {
    const stopped = once(server, "exit");
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 5000);
    server.kill("SIGTERM");
    try { await stopped; } finally { clearTimeout(forceStop); }
  }
  await log.close();
  await db.end();
}
