import "./load-app.cjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import {
  createPitchDatabase,
  OWNER,
  OTHER,
  ADMIN,
  VIEWER,
  sessionFor,
} from "./database.mjs";
import { businessFixture, TEST_SCOPE as scope } from "./business-fixtures.mjs";
const require = createRequire(import.meta.url),
  workflow = require("../../../src/lib/pitch/business/workflow.ts"),
  library = require("../../../src/lib/pitch/library/workflow.ts"),
  render = require("../../../src/lib/pitch/data/renderWorkflow.ts"),
  { digest } = require("../../../src/lib/pitch/data/store.ts");
const workspace = require("../../../src/lib/pitch/workspace/workflow.ts"),
  foundation = require("../../../src/lib/pitch/data/workflow.ts");
const db = await createPitchDatabase(),
  files = new Map();
let count = 0;
const check = async (name, fn) => {
  await fn();
  count++;
  console.log("PASS " + name);
};
const rpcOrder = {
  ai_lease_research_snapshot: ["p_actor", "p_effective", "p_session"],
  ai_query_authority: ["p_actor", "p_effective", "p_session"],
  ai_query_snapshot_read: [
    "p_actor",
    "p_effective",
    "p_session",
    "p_permission_revision",
    "p_fields",
    "p_periods",
    "p_inventory",
    "p_submarkets",
    "p_building_ids",
  ],
};
function ctx(uid) {
  return {
    identity: {
      actorId: uid,
      effectiveUserId: uid,
      sessionId: sessionFor(uid),
      expiresAt: Date.now() + 600000,
    },
    signal: new AbortController().signal,
    client: {
      rpc(name, args) {
        return {
          async abortSignal() {
            try {
              if (name === "pitch_studio_access")
                return { data: await db.rpc(uid, args.p_input), error: null };
              const keys = rpcOrder[name];
              assert.ok(keys);
              const query = `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) result`;
              const result = await db.setup.query(
                query,
                keys.map((k) =>
                  k === "p_periods" ? JSON.stringify(args[k]) : args[k],
                ),
              );
              return { data: result.rows[0].result, error: null };
            } catch (e) {
              return {
                data: null,
                error: { code: e.code, message: e.message },
              };
            }
          },
        };
      },
      storage: {
        from() {
          return {
            async upload(path, bytes) {
              if (files.has(path)) return { error: { message: "exists" } };
              files.set(path, new Uint8Array(bytes));
              return { error: null };
            },
            async download(path) {
              const bytes = files.get(path);
              return bytes
                ? { data: new Blob([bytes]), error: null }
                : { data: null, error: { message: "missing" } };
            },
          };
        },
      },
    },
  };
}
const owner = ctx(OWNER),
  ordinary = ctx(OTHER);
let category;
const ids = {};
async function asset(kind, index = 0, who = owner, language = "zh") {
  const fixture = businessFixture(kind, index, language),
    bytes = new TextEncoder().encode(
      fixture.content.title + "\n隔离合成资料，不代表真实业务事实。",
    );
  const receipt = await library.prepareImport(who, {
    action: "prepare",
    requestId: randomUUID(),
    filename: fixture.content.title + ".txt",
    mime: "text/plain",
    size: bytes.length,
    sha256: digest(bytes),
    metadata: {
      scope,
      categoryId: category,
      tags: ["隔离"],
      language,
      dataAsOf: fixture.content.dataAsOf,
      source: "隔离合成工程测试",
      visibility: "organization",
      isTestData: true,
      allowClientExport: false,
      validFrom: null,
      validUntil: null,
    },
  });
  await library.uploadPart(who, receipt.job.id, 0, bytes);
  await library.finishUpload(who, receipt.job.id);
  await library.runParseSlice(who, receipt.job.id);
  const assetId = (
    await db.setup.query(
      "select asset_id from pitch_source_pages where document_id=$1",
      [receipt.documentId],
    )
  ).rows[0].asset_id;
  const actual = await library.assetContext(who, assetId);
  const embedded = fixture.profile.display ?? fixture.profile.content;
  for (const display of [embedded, fixture.profile.briefDisplay].filter(
    Boolean,
  )) {
    display.sources = actual.version.content.sources;
    for (const block of display.blocks)
      block.sourceIds = display.sources.map((s) => s.id);
  }
  await workflow.saveBusinessProfile(who, {
    assetId,
    expectedVersion: 1,
    profile: fixture.profile,
  });
  await library.confirmAssets(who, {
    action: "confirm",
    items: [{ assetId, expectedVersion: 2 }],
    acknowledgePartial: true,
  });
  return assetId;
}
const staticPart = (templateId, assetIds) => ({
  mode: assetIds.length === 1 ? "static" : "semi-dynamic",
  templateId,
  assetIds,
  length: "detailed",
  allowFallback: false,
  variant: "standard",
});
const create = async (who = ordinary, title = "隔离工作台提案") => {
  const projectId = randomUUID();
  await db.rpc(who.identity.actorId, {
    action: "workspace_create",
    projectId,
    title,
    scope,
    themeId: "colliers-default-v1",
    themeVersion: 2,
    context: {
      language: "zh",
      buildingIds: [],
      client: "",
      business: "",
      period: "2026-Q3",
      notes: "",
    },
  });
  return workspace.getWorkspace(who, projectId);
};
const save = (d, extra = {}) => ({
  action: "save",
  projectId: d.project.id,
  expectedVersion: d.project.version,
  title: d.project.title,
  themeId: d.project.theme_id,
  themeVersion: d.project.theme_version,
  context: d.workspace.context,
  pages: d.slides.map((p) => ({ id: p.id })),
  activeSlide: d.slides[0]?.id ?? null,
  ...extra,
});
let deck, exported;
try {
  await db.setup.query("update private.pitch_control set enabled=true");
  for (const user of [OWNER, OTHER, ADMIN, VIEWER])
    await db.grant(user, "test-region", {
      maintainer: user === OWNER || user === ADMIN,
      client: true,
    });
  category = (await db.rpc(OWNER, { action: "catalog" })).categories.find(
    (c) => c.system_code === "general",
  ).id;
  await check(
    "ordinary owner creates empty server project; owner scope, fresh identity and RLS reject other users and viewer writes",
    async () => {
      deck = await create();
      assert.equal(deck.slides.length, 0);
      await assert.rejects(
        workspace.getWorkspace(owner, deck.project.id),
        /PITCH_DENIED/,
      );
      assert.equal(
        (await db.asUser(OWNER, "select * from pitch_workspace_states"))
          .rowCount,
        0,
      );
      await assert.rejects(
        db.asUser(OTHER, "update pitch_workspace_states set context='{}'"),
        (e) => e.code === "42501",
      );
      await assert.rejects(create(ctx(VIEWER)), (e) => e.code === "42501");
      await assert.rejects(
        db.rpc(OTHER, { action: "workspace_admin" }),
        (e) => e.code === "42501",
      );
      assert.equal(
        (await db.rpc(ADMIN, { action: "workspace_admin" })).projects,
        1,
      );
    },
  );
  await check(
    "company, several members, several cases and historical research generate through durable executor into one editor",
    async () => {
      for (const kind of ["corporate", "team", "case", "research"])
        ids[kind] = await asset(kind);
      ids.team2 = await asset("team", 2);
      ids.case2 = await asset("case", 2);
      for (const part of [
        staticPart("corporate-overview", [ids.corporate]),
        staticPart("team-multiple", [ids.team, ids.team2]),
        staticPart("case-portfolio", [ids.case, ids.case2]),
        staticPart("research-page", [ids.research]),
      ]) {
        const taskId = randomUUID();
        await workspace.startWorkspaceTask(ordinary, {
          action: "start",
          projectId: deck.project.id,
          expectedVersion: deck.project.version,
          taskId,
          part,
          replaceIds: [],
        });
        await workspace.runWorkspaceTask(ordinary, deck.project.id, taskId);
        const status = await db.rpc(OTHER, {
          action: "workspace_task_status",
          projectId: deck.project.id,
          taskId,
        });
        assert.equal(status.state, "completed");
        deck = await workspace.getWorkspace(ordinary, deck.project.id);
      }
      assert.ok(deck.slides.length >= 6);
      assert.ok(
        deck.slides.some((p) =>
          p.scene.elements.some((e) => e.kind === "chart"),
        ),
      );
    },
  );
  await check(
    "saved order, selected page, context and manual edit survive a completely new context; source asset remains immutable",
    async () => {
      const first = deck.slides[0],
        source = (
          await db.rpc(OTHER, {
            action: "library_asset",
            assetId: first.asset_id,
          })
        ).version.content;
      const pages = deck.slides.map((p) => ({ id: p.id })).reverse();
      pages[pages.length - 1].title = "用户改写标题 · 测试";
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, {
          title: "保存后的中文 Pitch",
          pages,
          activeSlide: pages[0].id,
          context: {
            ...deck.workspace.context,
            client: "隔离客户上下文",
            notes: "仅在私人项目保存",
          },
        }),
      );
      const reopened = await workspace.getWorkspace(
        ctx(OTHER),
        deck.project.id,
      );
      assert.equal(reopened.workspace.active_slide, pages[0].id);
      assert.equal(reopened.project.title, "保存后的中文 Pitch");
      assert.equal(reopened.workspace.context.client, "隔离客户上下文");
      assert.equal(reopened.slides[0].id, pages[0].id);
      assert.deepEqual(
        (
          await db.rpc(OTHER, {
            action: "library_asset",
            assetId: first.asset_id,
          })
        ).version.content,
        source,
      );
      assert.ok(reopened.workspace.page_settings[first.id].manual);
    },
  );
  await check(
    "two-tab optimistic save rejects stale overwrite; an original revision can be copied without index-based page corruption",
    async () => {
      const old = structuredClone(deck);
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, {
          pages: deck.slides.map((p, i) => ({
            id: p.id,
            ...(!i ? { title: "并发窗口先保存" } : {}),
          })),
        }),
      );
      await assert.rejects(
        workspace.saveWorkspace(ordinary, save(old, { title: "迟到的覆盖" })),
        /PITCH_CONFLICT/,
      );
      const copy = await workspace.copyWorkspace(ordinary, {
        action: "copy",
        projectId: deck.project.id,
        newProjectId: randomUUID(),
        title: "冲突草稿副本",
        revision: old.project.version,
      });
      assert.equal(copy.slides[0].content.title, old.slides[0].content.title);
      assert.equal(
        copy.workspace.page_settings[copy.slides[0].id].copiedFrom,
        old.slides[0].id,
      );
    },
  );
  await check(
    "duplicate, delete, keyboard-equivalent reorder and restore use immutable history without dropping a page",
    async () => {
      const prior = deck,
        duplicate = randomUUID();
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, {
          pages: [
            { id: duplicate, duplicateOf: deck.slides[0].id },
            ...deck.slides.map((p) => ({ id: p.id })),
          ],
          activeSlide: duplicate,
        }),
      );
      assert.equal(deck.slides.length, prior.slides.length + 1);
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, {
          pages: deck.slides
            .slice(1)
            .reverse()
            .map((p) => ({ id: p.id })),
        }),
      );
      assert.equal(deck.slides.length, prior.slides.length);
      deck = await workspace.restoreWorkspace(ordinary, {
        action: "restore",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        revision: prior.project.version,
      });
      assert.deepEqual(
        deck.slides.map((p) => p.content),
        prior.slides.map((p) => p.content),
      );
    },
  );
  await check(
    "custom text and Chinese-English edit become native editable text with user origin and cannot claim client authorization",
    async () => {
      deck = await workspace.customWorkspace(ordinary, {
        action: "custom",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        title: "用户自定义 · Custom",
        body: "用户输入的独立说明。\nEditable PowerPoint text.",
      });
      const page = deck.slides.at(-1);
      assert.equal(deck.workspace.page_settings[page.id].origin, "user");
      assert.equal(page.content.sources[0].kind, "record");
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, {
          pages: deck.slides.map((p) => ({
            id: p.id,
            ...(p.id === page.id
              ? { paragraphs: ["中文修改 · manually entered fact"] }
              : {}),
          })),
        }),
      );
      await assert.rejects(
        render.prepareRenderExport(ordinary, {
          action: "export_start",
          projectId: deck.project.id,
          exportId: randomUUID(),
          format: "pptx",
          audience: "client",
        }),
        /PITCH_DENIED/,
      );
    },
  );
  await check(
    "image choice and replacement retain original page provenance, native picture and revoked-media denial",
    async () => {
      const first = await foundation.createSample(
          owner,
          randomUUID(),
          scope,
          "image-text",
        ),
        second = await foundation.createSample(
          owner,
          randomUUID(),
          scope,
          "image-text",
        );
      // Legacy synthetic sample fixtures have no import task. Seed their isolated review state explicitly.
      for (const aid of [first.assetId, second.assetId]) {
        await db.setup.query(
          "update pitch_content_assets set state='published' where id=$1",
          [aid],
        );
        await db.setup.query(
          "update pitch_asset_versions set state='published' where asset_id=$1",
          [aid],
        );
      }
      await db.setup.query(
        "update pitch_source_documents set state='published' where created_by=$1 and filename='测试素材.json'",
        [OWNER],
      );
      await db.setup.query(
        "update pitch_media_assets set state='published' where created_by=$1",
        [OWNER],
      );
      let own = await create(owner, "隔离图片工作台");
      const originalProject = randomUUID();
      await render.composeProject(owner, {
        action: "project_compose",
        projectId: originalProject,
        title: "隔离图片来源",
        parts: [
          {
            assetId: first.assetId,
            layoutId: "image-text",
            variant: "standard",
          },
        ],
        themeId: "colliers-default-v1",
        themeVersion: 2,
      });
      own = await workspace.appendWorkspace(owner, {
        action: "append",
        projectId: own.project.id,
        expectedVersion: own.project.version,
        sourceProjectId: originalProject,
      });
      const media = (
          await db.rpc(OWNER, {
            action: "library_asset",
            assetId: second.assetId,
          })
        ).media[0],
        page = own.slides[0];
      own = await workspace.saveWorkspace(
        owner,
        save(own, {
          pages: [
            {
              id: page.id,
              images: [
                { id: media.id, version: media.version, alt: "隔离替换图片" },
              ],
            },
          ],
        }),
      );
      assert.ok(
        own.slides[0].scene.elements.some(
          (e) => e.kind === "image" && e.mediaAssetId === media.id,
        ),
      );
      assert.ok(
        own.slides[0].content.sources.some(
          (s) => s.pageId === media.source_page_id,
        ),
      );
      await db.setup.query(
        "update pitch_media_assets set state='archived' where id=$1",
        [media.id],
      );
      await assert.rejects(
        render.previewPage(owner, {
          action: "preview",
          projectId: own.project.id,
          page: 0,
        }),
        /PITCH_DENIED/,
      );
    },
  );
  await check(
    "design-only theme switch reuses frozen facts and does not invoke query or business generation",
    async () => {
      const contents = deck.slides.map((p) => p.content);
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, {
          themeId: "colliers-render-verification",
          themeVersion: 1,
        }),
      );
      assert.deepEqual(
        deck.slides.map((p) => p.content),
        contents,
      );
      assert.ok(
        deck.slides.every(
          (p) => p.scene.themeId === "colliers-render-verification",
        ),
      );
    },
  );
  await check(
    "selected and full exports are actual PPTX with native text/charts and exact selected slide counts",
    async () => {
      for (const [label, pages] of [
        ["全套", undefined],
        ["选中页面", [0, deck.slides.length - 1]],
      ]) {
        const c = {
          action: "export_start",
          projectId: deck.project.id,
          exportId: randomUUID(),
          format: "pptx",
          audience: "internal",
          ...(pages ? { pages } : {}),
        };
        await render.prepareRenderExport(ordinary, c);
        await render.runRenderExport(ordinary, c);
        assert.equal(
          (
            await db.rpc(OTHER, {
              action: "export_status",
              ...c,
              action: "export_status",
            })
          ).state,
          "ready",
        );
        const file = await render.downloadArtifact(ordinary, c),
          zip = await JSZip.loadAsync(file.bytes);
        assert.equal(
          Object.keys(zip.files).filter((n) =>
            /^ppt\/slides\/slide\d+\.xml$/.test(n),
          ).length,
          pages?.length ?? deck.slides.length,
        );
        const xml = (
          await Promise.all(
            Object.values(zip.files)
              .filter((f) => !f.dir && f.name.endsWith(".xml"))
              .map((f) => f.async("string")),
          )
        ).join("\n");
        assert.match(xml, /<a:t>/);
        if (!pages) assert.ok(zip.file("ppt/charts/chart1.xml"));
        await mkdir("tmp/pitch-workspace-fixtures", { recursive: true });
        await writeFile(
          "tmp/pitch-workspace-fixtures/隔离工作台_" + label + ".pptx",
          file.bytes,
        );
        if (pages) exported = c;
      }
      await assert.rejects(
        render.prepareRenderExport(ordinary, { ...exported, pages: [1] }),
        /PITCH_CONFLICT/,
      );
    },
  );
  await check(
    "export bound to one revision refuses mixed-version completion; old ready files retain their own authorization snapshot",
    async () => {
      const c = {
        action: "export_start",
        projectId: deck.project.id,
        exportId: randomUUID(),
        format: "pptx",
        audience: "internal",
      };
      await render.prepareRenderExport(ordinary, c);
      deck = await workspace.saveWorkspace(
        ordinary,
        save(deck, { title: "导出期间另一次编辑" }),
      );
      await render.runRenderExport(ordinary, c);
      assert.equal(
        (
          await db.rpc(OTHER, {
            action: "export_status",
            projectId: deck.project.id,
            exportId: c.exportId,
          })
        ).state,
        "failed",
      );
      assert.ok(
        (await render.downloadArtifact(ordinary, exported)).bytes.length > 100,
      );
    },
  );
  await check(
    "accepted structured AI changes are scoped to selected versions and roll back together when a page edit fails",
    async () => {
      let isolated = await create();
      for (const [title, body] of [["AI 目标页", "目标页原始说明。"], ["保留页", "旁边页面保持原样。"]])
        isolated = await workspace.customWorkspace(ordinary, { action: "custom", projectId: isolated.project.id,
          expectedVersion: isolated.project.version, title, body });
      const [target, untouched] = isolated.slides;
      const base = { id: randomUUID(), projectId: isolated.project.id, expectedVersion: isolated.project.version,
        basePageVersions: [{ id: target.id, version: target.version }, { id: untouched.id, version: untouched.version }] };
      await assert.rejects(workspace.applyDocumentModification(ordinary, { action: "apply_modification", scope: "selected",
        plan: { ...base, pages: [{ id: target.id, title: "未提交更新" }, { id: untouched.id, paragraphs: ["一", "二"] }] },
      }), /PITCH_INVALID/);
      assert.equal((await workspace.getWorkspace(ordinary, isolated.project.id)).project.version, isolated.project.version);
      const command = { action: "apply_modification", scope: "selected",
        plan: { ...base, pages: [{ id: target.id, title: "采用的 AI 标题" }] } };
      const result = await workspace.applyDocumentModification(ordinary, command);
      assert.equal(result.slides[0].content.title, "采用的 AI 标题");
      assert.deepEqual(result.slides[1].content, untouched.content);
      assert.deepEqual(result.slides[1].scene, untouched.scene);
      await assert.rejects(workspace.applyDocumentModification(ordinary, command), /PITCH_CONFLICT/);
    },
  );
  await check(
    "PDF and client eligibility honor explicit page selection and recheck pinned data and media at delivery",
    async () => {
      const approvedAsset = randomUUID(), sourceId = randomUUID();
      const approvedContent = {
        protocol: "colliers-pitch/1", locale: "zh", title: "对客批准测试页",
        dataAsOf: "2026-09-30", disclosure: "client_approved", isTestData: false,
        sources: [{ id: sourceId, kind: "record", label: "隔离审批夹具", locator: "测试记录",
          version: "test-1", dataAsOf: "2026-09-30" }],
        blocks: [{ kind: "paragraph", text: "已批准的文字内容。", sourceIds: [sourceId] }],
      };
      await db.rpc(OWNER, { action: "asset_save", assetId: approvedAsset, expectedVersion: 0,
        sha256: digest(new TextEncoder().encode(JSON.stringify(approvedContent))), asset: {
          scope, categoryId: category, tags: [], names: { zh: approvedContent.title }, content: approvedContent,
          state: "published", visibility: "organization", allowInternalGeneration: true, allowClientExport: true,
          allowExternalAi: false, validFrom: null, validUntil: null,
        } });
      const composedId = randomUUID();
      await render.composeProject(ordinary, { action: "project_compose", projectId: composedId,
        title: "页面披露隔离测试", themeId: "colliers-default-v1", themeVersion: 2,
        parts: [{ assetId: approvedAsset, layoutId: "two-columns", variant: "standard" }] });
      const mixed = await workspace.customWorkspace(ordinary, { action: "custom", projectId: composedId,
        expectedVersion: 1, title: "仅内部说明", body: "这段内容属于另一页，仅限公司内部。" });
      const command = { action: "export_start", projectId: composedId, exportId: randomUUID(), audience: "client", format: "pdf" };
      const report = await db.rpc(OTHER, { action: "export_eligibility", projectId: composedId, audience: "client" });
      assert.equal(report.projectVersion, mixed.project.version);
      assert.deepEqual(report.pages[0].reasons, []);
      assert.ok(report.pages[1].reasons.includes("internal_only"));
      await assert.rejects(render.prepareRenderExport(ordinary, command), error => error.report.pages[1].id === mixed.slides[1].id);
      assert.equal((await db.setup.query("select id from pitch_exports where id=$1", [command.exportId])).rowCount, 0);
      const selected = { ...command, pages: [0] };
      await render.prepareRenderExport(ordinary, selected);
      await render.runRenderExport(ordinary, selected);
      assert.equal((await db.rpc(OTHER, { action: "export_status", projectId: composedId, exportId: selected.exportId })).state, "ready");
      const file = await render.downloadArtifact(ordinary, selected);
      assert.equal(file.mime, "application/pdf");
      const pdf = await PDFDocument.load(file.bytes);
      assert.equal(pdf.getPageCount(), 1);
      assert.ok(Math.abs(pdf.getPage(0).getWidth() / pdf.getPage(0).getHeight() - 16/9) < .01);
      await mkdir("tmp/pitch-workspace-fixtures", { recursive: true });
      await writeFile("tmp/pitch-workspace-fixtures/isolated-client-selection.pdf", file.bytes);
      await assert.rejects(render.downloadArtifact(owner, selected), /PITCH_DENIED/);
      await assert.rejects(render.downloadArtifact(ordinary, { ...selected, audience: "internal" }), /PITCH_DENIED/);
      await db.setup.query("update pitch_content_assets set allow_client_export=false where id=$1", [approvedAsset]);
      await assert.rejects(render.downloadArtifact(ordinary, selected), /PITCH_DENIED/);
    },
  );
  await check(
    "legacy ready files freeze their original authorization before adoption and cannot acquire unrelated edited-page permissions",
    async () => {
      let legacy = await workspace.copyWorkspace(ordinary, {
        action: "copy",
        projectId: deck.project.id,
        newProjectId: randomUUID(),
        title: "隔离前序版本迁移",
      });
      const command = {
        action: "export_start",
        projectId: legacy.project.id,
        exportId: randomUUID(),
        format: "pptx",
        audience: "internal",
      };
      // Use the pre-delivery RPC path to produce an actual legacy artifact.
      await db.rpc(OTHER, { ...command, action: "export_prepare", asynchronous: true });
      await render.runRenderExport(ordinary, command);
      // Only the isolated fixture emulates a file produced before phase 05.
      await db.setup.query(
        "update pitch_exports set authorization_snapshot=null where id=$1",
        [command.exportId],
      );
      await db.setup.query(
        "delete from pitch_workspace_states where project_id=$1",
        [legacy.project.id],
      );
      legacy = await workspace.getWorkspace(ordinary, legacy.project.id);
      const removed = legacy.slides[0].asset_id;
      const frozen = (
        await db.setup.query(
          "select authorization_snapshot from pitch_exports where id=$1",
          [command.exportId],
        )
      ).rows[0].authorization_snapshot;
      assert.ok(
        Array.isArray(frozen) && frozen.some((row) => row.assetId === removed),
        "first adoption freezes the legacy file’s actual sources",
      );
      legacy = await workspace.saveWorkspace(
        ordinary,
        save(legacy, {
          pages: legacy.slides
            .filter((page) => page.asset_id !== removed)
            .map((page) => ({ id: page.id })),
        }),
      );
      assert.ok(
        (await render.downloadArtifact(ordinary, command)).bytes.length > 100,
      );
      try {
        await db.setup.query(
          "update pitch_content_assets set state='archived' where id=$1",
          [removed],
        );
        assert.ok(
          (await workspace.getWorkspace(ordinary, legacy.project.id)).slides
            .length > 0,
          "the current deck no longer depends on the removed asset",
        );
        await assert.rejects(
          render.downloadArtifact(ordinary, command),
          /PITCH_DENIED/,
        );
      } finally {
        await db.setup.query(
          "update pitch_content_assets set state='published' where id=$1",
          [removed],
        );
      }
      // A genuinely unverifiable old file is rejected rather than backfilled
      // from the new deck, even when its former source is still accessible.
      await db.setup.query(
        "update pitch_exports set authorization_snapshot=null where id=$1",
        [command.exportId],
      );
      await workspace.getWorkspace(ordinary, legacy.project.id);
      await assert.rejects(
        render.prepareRenderExport(ordinary, command),
        /PITCH_CONFLICT/,
      );
      await assert.rejects(
        render.downloadArtifact(ordinary, command),
        /PITCH_DENIED/,
      );
    },
  );
  await check(
    "cancelled generation is never committed, even when cancellation races after source generation",
    async () => {
      const taskId = randomUUID(),
        part = staticPart("corporate-metrics", [ids.corporate]),
        before = deck.slides.map((p) => p.id);
      await workspace.startWorkspaceTask(ordinary, {
        action: "start",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        taskId,
        part,
        replaceIds: [],
      });
      const racing = ctx(OTHER),
        base = racing.client.rpc;
      racing.client.rpc = (name, args) => {
        if (args.p_input?.action === "workspace_task_check")
          return {
            async abortSignal() {
              await db.rpc(OTHER, {
                action: "workspace_task_cancel",
                projectId: deck.project.id,
                taskId,
              });
              return base(name, args).abortSignal();
            },
          };
        return base(name, args);
      };
      await workspace.runWorkspaceTask(racing, deck.project.id, taskId);
      assert.equal(
        (
          await db.rpc(OTHER, {
            action: "workspace_task_status",
            projectId: deck.project.id,
            taskId,
          })
        ).state,
        "cancelled",
      );
      assert.deepEqual(
        (await workspace.getWorkspace(ordinary, deck.project.id)).slides.map(
          (p) => p.id,
        ),
        before,
      );
    },
  );
  await check(
    "lost generation acknowledgement replays the same completed receipt without regenerating or saving, and rejects changed intents",
    async () => {
      const input = {
        action: "start",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        taskId: randomUUID(),
        part: staticPart("corporate-overview", [ids.corporate]),
        replaceIds: [deck.slides[0].id],
      };
      const queued = await workspace.startWorkspaceTask(ordinary, input);
      await workspace.runWorkspaceTask(ordinary, input.projectId, input.taskId);
      const saved = await workspace.getWorkspace(ordinary, input.projectId);
      const replay = await workspace.startWorkspaceTask(ctx(OTHER), input);
      assert.equal(replay.state, "completed");
      assert.equal(replay.stage, "saved");
      assert.equal(replay.source_project_id, queued.source_project_id);
      assert.equal(replay.expected_version, input.expectedVersion);
      assert.equal(replay.attempts, 1);
      await workspace.runWorkspaceTask(ordinary, input.projectId, input.taskId);
      assert.equal(saved.project.version, input.expectedVersion + 1);
      assert.equal((await workspace.getWorkspace(ordinary, input.projectId)).project.version, saved.project.version);
      await assert.rejects(workspace.startWorkspaceTask(ordinary, { ...input, replaceIds: [] }), /PITCH_CONFLICT/);
      await assert.rejects(workspace.startWorkspaceTask(ordinary, { ...input, taskId: randomUUID() }), /PITCH_CONFLICT/);
      await assert.rejects(workspace.startWorkspaceTask(owner, input), /PITCH_DENIED/);
      deck = saved;
    },
  );
  await check(
    "bounded retry and timeout leave durable failed receipts, duplicate claims cannot run twice",
    async () => {
      const taskId = randomUUID();
      await workspace.startWorkspaceTask(ordinary, {
        action: "start",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        taskId,
        part: staticPart("corporate-overview", [randomUUID()]),
        replaceIds: [],
      });
      for (let attempt = 1; attempt <= 3; attempt++) {
        await workspace.runWorkspaceTask(ordinary, deck.project.id, taskId);
        const receipt = await db.rpc(OTHER, {
          action: "workspace_task_status",
          projectId: deck.project.id,
          taskId,
        });
        assert.equal(receipt.state, "failed");
        assert.equal(receipt.attempts, attempt);
        if (attempt < 3)
          await db.rpc(OTHER, {
            action: "workspace_task_retry",
            projectId: deck.project.id,
            taskId,
          });
      }
      await assert.rejects(
        db.rpc(OTHER, {
          action: "workspace_task_retry",
          projectId: deck.project.id,
          taskId,
        }),
        (e) => e.code === "23505",
      );
      const timeout = randomUUID();
      await workspace.startWorkspaceTask(ordinary, {
        action: "start",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        taskId: timeout,
        part: staticPart("corporate-overview", [ids.corporate]),
        replaceIds: [],
      });
      assert.equal(
        (
          await db.rpc(OTHER, {
            action: "workspace_task_claim",
            projectId: deck.project.id,
            taskId: timeout,
            token: randomUUID(),
          })
        ).claimed,
        true,
      );
      assert.equal(
        (
          await db.rpc(OTHER, {
            action: "workspace_task_claim",
            projectId: deck.project.id,
            taskId: timeout,
            token: randomUUID(),
          })
        ).claimed,
        false,
      );
      await db.setup.query(
        "update private.pitch_workspace_tasks set lease_until=now()-interval '1 minute' where id=$1",
        [timeout],
      );
      assert.equal(
        (
          await db.rpc(OTHER, {
            action: "workspace_task_status",
            projectId: deck.project.id,
            taskId: timeout,
          })
        ).state,
        "failed",
      );
    },
  );
  await check(
    "ordinary preference isolation, search, archive, trash and restoration persist without browser storage",
    async () => {
      await db.rpc(OTHER, {
        action: "workspace_preferences",
        value: { favorites: ["team-multiple"], recent: [] },
      });
      assert.deepEqual(
        await db.rpc(OWNER, { action: "workspace_preferences" }),
        {},
      );
      assert.equal(
        (await db.rpc(OTHER, { action: "workspace_list", q: "导出期间" }))
          .length,
        1,
      );
      await db.rpc(OTHER, {
        action: "workspace_lifecycle",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        state: "archived",
      });
      assert.ok(
        (
          await db.rpc(OTHER, { action: "workspace_list", filter: "archived" })
        ).some((p) => p.id === deck.project.id),
      );
      deck = await workspace.getWorkspace(ordinary, deck.project.id);
      await db.rpc(OTHER, {
        action: "workspace_lifecycle",
        projectId: deck.project.id,
        expectedVersion: deck.project.version,
        state: "deleted",
      });
      await assert.rejects(
        workspace.getWorkspace(ordinary, deck.project.id),
        /PITCH_DENIED/,
      );
      const row = (
        await db.rpc(OTHER, { action: "workspace_list", filter: "deleted" })
      ).find((p) => p.id === deck.project.id);
      await db.rpc(OTHER, {
        action: "workspace_lifecycle",
        projectId: deck.project.id,
        expectedVersion: row.version,
        state: "draft",
      });
      deck = await workspace.getWorkspace(ordinary, deck.project.id);
    },
  );
  await check(
    "revoking original published asset blocks editor, raw RLS, copying and exports; unpublishing cannot be laundered through old slide",
    async () => {
      await db.setup.query(
        "update pitch_content_assets set state='draft' where id=$1",
        [ids.corporate],
      );
      await assert.rejects(
        workspace.getWorkspace(ordinary, deck.project.id),
        /PITCH_DENIED/,
      );
      assert.equal(
        (
          await db.asUser(
            OTHER,
            "select * from pitch_project_slides where project_id=$1",
            [deck.project.id],
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        workspace.copyWorkspace(ordinary, {
          action: "copy",
          projectId: deck.project.id,
          newProjectId: randomUUID(),
          title: "禁止副本",
        }),
        /PITCH_DENIED/,
      );
      await assert.rejects(
        render.prepareRenderExport(ordinary, {
          action: "export_start",
          projectId: deck.project.id,
          exportId: randomUUID(),
          format: "pptx",
          audience: "internal",
        }),
        /PITCH_DENIED/,
      );
    },
  );
  console.log(`Pitch workspace integration: ${count} groups passed`);
} finally {
  await db.close();
}
