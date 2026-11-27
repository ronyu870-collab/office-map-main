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
import { grantBusiness, installBusinessFixture, seedBusiness } from "../../supabase/tests/ai-business-research/fixture.mjs";
import { grantLeaseResearch, installLeaseResearchFixture, seedLeaseResearch } from "../../supabase/tests/ai-lease-research/fixture.mjs";
import { grantQuery } from "../../supabase/tests/ai-query-authority/database.mjs";
import { BUILDINGS } from "../../supabase/tests/ai-query-authority/snapshot-fixture.mjs";
import { installPitchDataFixture } from "../../supabase/tests/pitch-studio/business-data-fixture.mjs";
import { verifyPitchBuildingInspectorBrowser, verifyPitchChartRevisionBrowser, verifyPitchFlagshipBrowser,
  verifyPitchImageReplacementBrowser } from "./pitch-workspace-browser.mjs";

assert.equal(process.env.PITCH_TEST_ALLOW_LOCAL, "disposable");
const settings = JSON.parse(await readFile(process.env.PITCH_AUTH_STATUS, "utf8"));
for (const url of [settings.API_URL, settings.DB_URL]) assert.equal(new URL(url).hostname, "127.0.0.1");
const app = "http://127.0.0.1:3291";
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
  await db.query("update private.ai_query_control set enabled=true");
  await grantQuery({ setup: db }, id, {
    capabilities: ["query:catalog", "query:brochure", "query:quarter", "export:internal"],
    fields: ["height", "floors", "parking", "totalArea", "vacantArea", "netEffectiveRent"],
  });
  const leaseFixture = await readFile(new URL("../../supabase/tests/lease-expiry/fixture.sql", import.meta.url), "utf8");
  await db.query(leaseFixture.slice(leaseFixture.indexOf("create table public.lease_transactions("),
    leaseFixture.indexOf("create table public.lease_transactions_history(")));
  await db.query("alter table public.lease_transactions alter column submitter_id type varchar using submitter_id::text");
  await installLeaseResearchFixture(db);
  await grantLeaseResearch(db, id);
  await installBusinessFixture(db);
  await grantBusiness(db, id, { allSubmarkets: true });
  // The catalogue queries use real landmark names with synthetic quarterly values.
  await db.query("update public.buildings set grade='B' where id=any($1::uuid[])", [BUILDINGS]);
  const buildings = [
    ["霄云路33号", "燕莎"], ["五矿广场", "东二环"], ["国贸写字楼1座", "CBD"], ["国际财源中心（IFC）", "CBD"],
    ["新华保险大厦（NCI）", "CBD"], ["大家保险大厦B座", "CBD"], ["泰康金融大厦", "CBD"],
  ];
  const buildingIds = [];
  for (const [index, [name, submarket]] of buildings.entries()) {
    const buildingId = randomUUID();
    buildingIds.push(buildingId);
    await db.query("insert into public.buildings(id,name,submarket,grade,tracking_scope,completion_year) values($1,$2,$3,'A','tracked',$4)",
      [buildingId, name, submarket, String(2015 + index)]);
    await db.query("insert into public.building_brochure_data(building_id,building_height,parking_total,building_floors,address) values($1,$2,$3,$4,$5)",
      [buildingId, 180 + index, 400 + index, 39 + index, `隔离测试路${index + 1}号`]);
    for (const [year, quarter] of [[2025, 4], [2026, 1], [2026, 2], [2026, 3]]) {
      await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,
        vacant_area,is_draft,is_locked,locked_at,locked_by) values($1,$2,$3,$4,$5,$6,false,true,now(),$7)`,
        [buildingId, year, quarter, 30000 + index * 2000, 100 + index * 12 + quarter, 1500 + index * 210, id]);
    }
  }
  await seedLeaseResearch(db, buildingIds);
  await seedBusiness(db, buildingIds, id);
  await db.query("notify pgrst,'reload schema'");
  const client = createClient(settings.API_URL, settings.ANON_KEY, authOptions);
  const signed = await client.auth.signInWithPassword({ email, password });
  assert.equal(signed.error, null);
  return { id, client, token: signed.data.session.access_token };
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
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3291"],
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
  const marketRevision = process.argv.includes("--market-revision");
  const competitorRevision = process.argv.includes("--competitor-revision");
  const imageReplacement = process.argv.includes("--image-replacement") ? await createImageReplacementFixture(who) : undefined;
  const verify = imageReplacement ? verifyPitchImageReplacementBrowser
    : quarterRevision || competitorRevision || process.argv.includes("--building-inspector") ? verifyPitchBuildingInspectorBrowser
    : process.argv.includes("--chart-revision") ? verifyPitchChartRevisionBrowser : verifyPitchFlagshipBrowser;
  await verify({
    app, who, period: quarterRevision || marketRevision ? "2026-Q2" : "2026-Q3", quarterRevision, competitorRevision, marketRevision, imageReplacement,
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
