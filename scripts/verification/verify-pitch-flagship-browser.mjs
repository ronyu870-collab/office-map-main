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
import { verifyPitchBuildingInspectorBrowser, verifyPitchChartRevisionBrowser, verifyPitchFlagshipBrowser } from "./pitch-workspace-browser.mjs";

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

async function addPhoto(buildingId, index) {
  const id = randomUUID();
  const path = `building-photos/v1/${buildingId}/${id}/isolated-fixture.png`;
  const width = 1120, height = 720;
  const image = await sharp({ create: { width, height, channels: 3,
    background: { r: 36 + index * 19, g: 85, b: 116 } } }).png().toBuffer();
  const uploaded = await service.storage.from(gallery).upload(path, image, { contentType: 'image/png' });
  assert.equal(uploaded.error, null);
  await db.query(`insert into public.building_photos(id,building_id,storage_path,sha256,file_size,width,height,
    photo_kind,caption,sort_order,source_url,source_name,attribution_text,collected_at,status)
    values($1,$2,$3,$4,$5,$6,$7,'exterior','隔离合成视觉素材',0,'https://example.com/fixture','隔离测试','合成样本',now(),'ready')`,
  [id,buildingId,path,createHash('sha256').update(image).digest('hex'),image.length,width,height]);
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
  await grantBusiness(db, id, { modules: ['profile', 'submarket'], allSubmarkets: true });
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
  return { client, token: signed.data.session.access_token, replacementCandidates };
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
  const verify = quarterRevision || competitorRevision || process.argv.includes("--building-inspector") ? verifyPitchBuildingInspectorBrowser
    : process.argv.includes("--chart-revision") ? verifyPitchChartRevisionBrowser : verifyPitchFlagshipBrowser;
  await verify({
    app, who, period: quarterRevision ? "2026-Q2" : "2026-Q3", quarterRevision, competitorRevision,
    replacementCandidates: who.replacementCandidates,
    requiredVisuals: { 'leasing-agency': ['photo', 'map'], 'site-selection': ['photo', 'map'],
      'market-report': ['map'], 'building-promotion': ['photo', 'map'] },
    readProject: async (projectId) => {
      const result = await fetch(app + "/api/intelligence/pitch/workspace", {
        method: "POST",
        headers: { Authorization: "Bearer " + who.token, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get", projectId }),
      });
      assert.equal(result.status, 200);
      return result.json();
    },
  });
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
