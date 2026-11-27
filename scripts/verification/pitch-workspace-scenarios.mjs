// Real Auth sessions, production Next handlers, PostgreSQL and private Storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { dynamicFixture } from "../../supabase/tests/pitch-studio/business-fixtures.mjs";
function workspaceClient(app) {
  return async (who, input, write = true) => {
    const response = await fetch(
      app +
        "/api/intelligence/pitch/workspace" +
        (write ? "" : "?" + new URLSearchParams(input)),
      {
        method: write ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + who.token,
          ...(write ? { "Content-Type": "application/json" } : {}),
        },
        ...(write ? { body: JSON.stringify(input) } : {}),
      },
    );
    return { status: response.status, body: await response.json() };
  };
}

export async function verifyPitchWorkspace({
  app,
  db,
  other,
  admin,
  scope,
  call,
  library,
  check,
  until,
  ids,
}) {
  const workspace = workspaceClient(app);
  const context = {
    language: "zh",
    buildingIds: [],
    client: "隔离客户",
    business: "测试业务",
    period: "2026-Q3",
    notes: "",
  };
  let detail;
  const save = () => ({
    action: "save",
    projectId: detail.project.id,
    expectedVersion: detail.project.version,
    title: detail.project.title,
    themeId: detail.project.theme_id,
    themeVersion: detail.project.theme_version,
    context: detail.workspace.context,
    pages: detail.slides.map((p) => ({ id: p.id })),
    activeSlide: detail.slides[0]?.id ?? null,
  });
  await check(
    "workspace HTTP has feature gate, fresh owner identity, hidden dynamic capabilities and real preview thumbnails",
    async () => {
      const caps = await workspace(other, { action: "capabilities" }, false);
      assert.equal(caps.status, 200);
      assert.deepEqual(caps.body.allowedDynamic, []);
      const thumb = await workspace(
        other,
        { action: "thumbnail", templateId: "team-multiple" },
        false,
      );
      assert.equal(thumb.status, 200);
      assert.match(thumb.body.svg, /<svg/);
      assert.equal(thumb.body.example, true);
      const bad = await workspace(
        other,
        { action: "thumbnail", templateId: "stacking-plan" },
        false,
      );
      assert.equal(bad.status, 422);
      assert.equal(
        (await workspace(other, { action: "admin" }, false)).status,
        403,
      );
      const created = await workspace(admin, {
        action: "create",
        projectId: randomUUID(),
        title: "隔离完整工作台 HTTP",
        scope,
        context,
        themeId: "colliers-default-v1",
        themeVersion: 2,
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      detail = created.body;
      assert.equal(
        (
          await workspace(other, {
            action: "get",
            projectId: detail.project.id,
          })
        ).status,
        403,
      );
    },
  );
  await db.query(
    "update private.ai_query_grants set enabled=true where user_id=$1",
    [admin.id],
  );
  await check(
    "workspace HTTP executor appends corporate, team, cases, research and authorized market/building pages",
    async () => {
      const part = (templateId, assetIds) => ({
        mode: assetIds.length > 1 ? "semi-dynamic" : "static",
        templateId,
        assetIds,
        length: "detailed",
        allowFallback: false,
        variant: "standard",
      });
      const parts = [
        part("corporate-overview", [ids.corporate]),
        part("team-multiple", [ids.team, ids.team2]),
        part("case-portfolio", [ids.case, ids.case2]),
        part("research-page", [ids.research]),
        { mode: "dynamic", parameters: dynamicFixture },
        {
          mode: "dynamic",
          parameters: {
            ...dynamicFixture,
            templateId: "rent-comparison",
            buildingIds: [],
            chart: "bar",
          },
        },
      ];
      // Comparison requires explicitly selected real fixture IDs, not a fabricated building.
      const buildings = await db.query(
        "select id from buildings order by id limit 2",
      );
      parts.at(-1).parameters.buildingIds = buildings.rows.map((r) => r.id);
      for (const input of parts) {
        const taskId = randomUUID();
        const started = await workspace(admin, {
          action: "start",
          projectId: detail.project.id,
          expectedVersion: detail.project.version,
          taskId,
          part: input,
          replaceIds: [],
        });
        assert.equal(started.status, 202, JSON.stringify(started.body));
        await until(async () => {
          const state = await workspace(admin, {
            action: "status",
            projectId: detail.project.id,
            taskId,
          });
          assert.equal(state.status, 200);
          assert.notEqual(
            state.body.state,
            "failed",
            JSON.stringify(state.body),
          );
          return state.body.state === "completed";
        }, "workspace generation");
        detail = (
          await workspace(admin, {
            action: "get",
            projectId: detail.project.id,
          })
        ).body;
      }
      assert.ok(detail.slides.length >= 9);
      assert.ok(
        detail.slides.some(
          (p) => detail.workspace.page_settings[p.id]?.origin === "data",
        ),
      );
    },
  );
  await check("a reviewed outline is a single version-pinned job and failure never changes destination pages", async () => {
    const projectId = randomUUID();
    const created = await workspace(admin, {
      action: "create", projectId, title: "隔离多章节提案", themeId: "colliers-default-v1",
      themeVersion: 2, scope, context,
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const assets = await db.query("select id, current_version from public.pitch_content_assets where id=any($1::uuid[])", [[ids.corporate, ids.research]]);
    const versions = new Map(assets.rows.map(asset => [asset.id, asset.current_version]));
    const part = { mode: "static", templateId: "corporate-overview", assetIds: [ids.corporate],
      length: "brief", allowFallback: false, variant: "standard" };
    const start = { action: "start", projectId, expectedVersion: created.body.project.version,
      replaceIds: [], part: { mode: "outline", parts: [
        { ...part, title: "公司资料之一" },
        { ...part, assetIds: [ids.research], templateId: "research-page", title: "市场研究章节" },
      ], bindings: [{ id: ids.corporate, version: versions.get(ids.corporate) },
        { id: ids.research, version: versions.get(ids.research) + 999 }] } };
    const failId = randomUUID();
    assert.equal((await workspace(admin, { ...start, taskId: failId })).status, 202);
    await until(async () => {
      const r = await workspace(admin, { action: "status", projectId, taskId: failId });
      assert.equal(r.status, 200);
      if (r.body.state !== "failed") return false;
      assert.equal(r.body.error_code, "PITCH_OUTLINE_SOURCE_CHANGED");
      return true;
    }, "reject stale outline materials");
    const same = await workspace(admin, { action: "get", projectId });
    assert.equal(same.body.project.version, created.body.project.version);
    assert.equal(same.body.slides.length, 0);
    const taskId = randomUUID();
    start.part.bindings[1].version = versions.get(ids.research);
    assert.equal((await workspace(admin, { ...start, taskId })).status, 202);
    await until(async () => {
      const r = await workspace(admin, { action: "status", projectId, taskId });
      assert.equal(r.status, 200);
      assert.notEqual(r.body.state, "failed", JSON.stringify(r.body));
      return r.body.state === "completed";
    }, "atomic outline append");
    const generated = await workspace(admin, { action: "get", projectId });
    assert.equal(generated.body.project.version, created.body.project.version + 1);
    const titles = generated.body.slides.map(slide => slide.content.title);
    assert.deepEqual([...new Set(titles)], ["公司资料之一", "市场研究章节"]);
    for (const page of generated.body.slides) assert.ok(page.content.sources.length);
  });
  await check("the authorized quarterly research edition hands off the Beijing Grade A cohort", () =>
    verifyPitchQuarterlyResearch({ app, db, admin, other, scope, until }));
  await check("a real Auth submarket handoff saves the selected formal quarter as a native table", async () => {
    const handoff = { source: { kind: "submarket", key: "CBD" }, period: "2026-Q3" };
    const review = { action: "review_handoff", handoff };
    assert.equal((await workspace(other, review)).status, 403);
    const reviewed = await workspace(admin, review);
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.status, "ready");
    assert.equal(reviewed.body.parameters.templateId, "quarter-market-summary");
    const projectId = randomUUID(), taskId = randomUUID();
    const queued = await workspace(admin, { action: "add_to_pitch", handoff, taskId,
      fingerprint: reviewed.body.fingerprint,
      target: { mode: "create", projectId, title: "正式市场汇总交接", scope, themeId: "colliers-default-v1", themeVersion: 2 },
    });
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    await until(async () => {
      const status = await workspace(admin, { action: "status", projectId, taskId });
      assert.equal(status.status, 200, JSON.stringify(status.body));
      assert.notEqual(status.body.state, "failed", JSON.stringify(status.body));
      return status.body.state === "completed";
    }, "save formal submarket handoff");
    const saved = await workspace(admin, { action: "get", projectId });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const table = saved.body.slides.find(page => page.scene.elements.some(element => element.kind === "table"));
    assert.equal(table?.content.dataAsOf, "2026-09-30");
    assert.match(table.content.subtitle, /2026 Q3/);
  });
  await check("mixed reviewed outline is atomic, uses the exact formal quarter and cannot be exported to clients", async () => {
    const building = randomUUID(), projectId = randomUUID(), period = "2026-Q3";
    await db.query("insert into public.buildings(id,name,submarket,grade,tracking_scope) values($1,'提纲核对测试楼','CBD','A','tracked')", [building]);
    await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,vacant_area,is_draft)
      values($1,2026,3,10000,100,1000,false),($1,2026,2,10000,80,800,false),($1,2025,3,10000,0,null,false)`, [building]);
    const created = await workspace(admin, {
      action: "create", projectId, title: "隔离楼宇与素材混合提案", themeId: "colliers-default-v1",
      themeVersion: 2, scope, context: { ...context, buildingIds: [building], period },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const command = { action: "review_outline_data", projectId, buildingIds: [building], period, compareQuarters: true };
    assert.equal((await workspace(other, command)).status, 403);
    const missing = await workspace(admin, { ...command, period: "2025-Q2" });
    assert.equal(missing.status, 422, JSON.stringify(missing.body));
    assert.equal(missing.body.code, "PITCH_OUTLINE_DATA_CHANGED");
    const review = await workspace(admin, command);
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.buildings[0].name, "提纲核对测试楼");
    assert.ok(review.body.buildings[0].facts.some(fact => fact.value === "10,000"));
    assert.deepEqual(review.body.comparisons[0].rows[0], ["提纲核对测试楼", "100", "+25%", "基期无有效值"]);
    assert.deepEqual(review.body.comparisons[1].rows[0], ["提纲核对测试楼", "10", "+2 个百分点", "基期无有效值"]);
    const version = (await db.query("select current_version from public.pitch_content_assets where id=$1", [ids.corporate])).rows[0].current_version;
    const outline = { mode: "outline", dataFingerprint: review.body.fingerprint, compareQuarters: true,
      parts: [
        { mode: "static", templateId: "corporate-overview", assetIds: [ids.corporate],
          length: "brief", allowFallback: false, variant: "standard", title: "团队正式素材" },
        { mode: "dynamic", parameters: review.body.parameters, title: "目标楼宇正式数据" },
      ], bindings: [{ id: ids.corporate, version }] };
    const start = { action: "start", projectId, expectedVersion: created.body.project.version, replaceIds: [] };
    await db.query("update public.building_metrics set net_effective_rent=50 where building_id=$1 and record_year=2026 and record_quarter=2", [building]);
    const staleId = randomUUID();
    const stale = await workspace(admin, { ...start, taskId: staleId, part: outline });
    assert.equal(stale.status, 202, JSON.stringify(stale.body));
    await until(async () => {
      const r = await workspace(admin, { action: "status", projectId, taskId: staleId });
      if (r.body.state === "failed") assert.equal(r.body.error_code, "PITCH_OUTLINE_DATA_CHANGED");
      assert.notEqual(r.body.state, "completed");
      return r.body.state === "failed";
    }, "reject changed formal evidence");
    assert.equal((await workspace(admin, { action: "get", projectId })).body.slides.length, 0);
    const fresh = await workspace(admin, command);
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.notEqual(fresh.body.fingerprint, review.body.fingerprint);
    assert.equal(fresh.body.comparisons[0].rows[0][2], "+100%");
    const taskId = randomUUID();
    const begun = await workspace(admin, { ...start, taskId, part: { ...outline, dataFingerprint: fresh.body.fingerprint } });
    assert.equal(begun.status, 202, JSON.stringify(begun.body));
    await until(async () => {
      const r = await workspace(admin, { action: "status", projectId, taskId });
      assert.notEqual(r.body.state, "failed", JSON.stringify(r.body));
      return r.body.state === "completed";
    }, "append both chapters together");
    const generated = (await workspace(admin, { action: "get", projectId })).body;
    assert.equal(generated.project.version, created.body.project.version + 1);
    assert.deepEqual([...new Set(generated.slides.map(slide => slide.content.title))],
      ["团队正式素材", "目标楼宇正式数据"]);
    const data = generated.slides.find(page => page.content.title === "目标楼宇正式数据");
    assert.equal(data.content.dataAsOf, "2026-09-30");
    assert.match(data.content.subtitle, /2026 Q3 · 仅限内部/);
    assert.ok(data.content.sources.length);
    assert.match(JSON.stringify(data.content.blocks), /提纲核对测试楼/);
    const changes = generated.slides.find(page => page.content.subtitle?.includes("净有效租金 · 环比"));
    assert.ok(changes?.content.blocks.some(block => block.kind === "table" && block.rows[0]?.includes("+100%")));
    assert.equal(changes?.content.sources.length, 3);
    assert.equal(generated.workspace.page_settings[data.id].origin, "data");
    const gates = await db.query("select allow_client_export from public.pitch_content_assets where id=any($1::uuid[])", [generated.slides.map(p => p.asset_id)]);
    assert.ok(gates.rows.length > 0 && gates.rows.every(asset => asset.allow_client_export === false));
    if (process.env.PITCH_WORKSPACE_BROWSER === "true") {
      const { verifyPitchOutlineBrowser } = await import("./pitch-workspace-browser.mjs");
      const research = (await db.query("select id, current_version as version from public.pitch_content_assets where id=$1", [ids.research])).rows[0];
      const media = await library(admin, { action: "search", kind: "media", state: "published", validity: "valid" });
      assert.equal(media.status, 200, JSON.stringify(media.body));
      const image = media.body.items.find(item => item.mime === "image/png");
      assert.ok(image, "published synthetic image from the imported historical PPTX");
      await verifyPitchOutlineBrowser({ app, who: admin, buildingName: "提纲核对测试楼", period, research, image,
        changeQuarter: () => db.query("update public.building_metrics set net_effective_rent=80 where building_id=$1 and record_year=2026 and record_quarter=2", [building]),
        readProject: async projectId => (await workspace(admin, { action: "get", projectId })).body,
        assertClientDenied: async projectId => {
          const gate = await db.query("select id, can_client_export from private.pitch_grants where user_id=$1 and region=$2", [admin.id, scope.region]);
          assert.equal(gate.rows.length, 1);
          const grant = gate.rows[0];
          await db.query("update private.pitch_grants set can_client_export=true where id=$1", [grant.id]);
          try {
            const out = await call(admin, { action: "export_start", projectId, exportId: randomUUID(), audience: "client", format: "pptx" }, true);
            assert.equal(out.status, 403, JSON.stringify(out.body));
          } finally {
            await db.query("update private.pitch_grants set can_client_export=$1 where id=$2", [grant.can_client_export, grant.id]);
          }
        },
      });
    }
  });
  await check(
    "workspace HTTP saves configuration, content, order and active page across new requests; stale save returns 409",
    async () => {
      const before = detail,
        command = save();
      command.pages.reverse();
      command.pages[0].title = "用户编辑市场页面标题";
      command.activeSlide = command.pages[0].id;
      command.context.notes = "重新进入后必须恢复";
      const saved = await workspace(admin, command);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      detail = saved.body;
      const reopened = await workspace(admin, {
        action: "get",
        projectId: detail.project.id,
      });
      assert.equal(reopened.body.workspace.active_slide, command.activeSlide);
      assert.equal(reopened.body.workspace.context.notes, "重新进入后必须恢复");
      assert.equal(
        reopened.body.slides[0].content.title,
        command.pages[0].title,
      );
      assert.equal(
        (
          await workspace(admin, {
            ...command,
            expectedVersion: before.project.version,
          })
        ).status,
        409,
      );
      const theme = await workspace(admin, {
        ...save(),
        themeId: "colliers-render-verification",
        themeVersion: 1,
      });
      assert.equal(theme.status, 200, JSON.stringify(theme.body));
      detail = theme.body;
    },
  );
  await check(
    "workspace object placement round trips through real Postgres; unknown and managed objects are rejected",
    async () => {
      const before = detail.slides[0], command = save();
      const targetIndex = before.scene.elements.findIndex(
        (element) => element.kind === "text" && element.role === "title" && !element.purpose && element.x >= .05,
      );
      assert.notEqual(targetIndex, -1);
      const target = before.scene.elements[targetIndex], id = `object-${targetIndex + 1}`;
      const move = { id, x: target.x - .05, y: target.y };
      for (const invalid of [{ ...move, id: "object-999" }, { ...move, x: 13 }, { ...move, scale: .8 }, { ...move, rotation: 15 }]) {
        const rejected = await workspace(admin, { ...command, pages: command.pages.map((page, index) =>
          index ? page : { ...page, objectMoves: [invalid] },
        ) });
        assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
      }
      const saved = await workspace(admin, { ...command, pages: command.pages.map((page, index) =>
        index ? page : { ...page, objectMoves: [move] },
      ) });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      detail = (await workspace(admin, { action: "get", projectId: detail.project.id })).body;
      const reopened = detail.slides.find((page) => page.id === before.id);
      assert.deepEqual(reopened.content, before.content, "source facts and disclosure stay unchanged");
      assert.equal(reopened.scene.elements[targetIndex].editorId, id);
      assert.equal(reopened.scene.elements[targetIndex].x, move.x);
      const editor = { action: "preview", projectId: detail.project.id, page: 0, editorSlideId: before.id };
      const preview = await call(admin, editor, true);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.match(preview.body.svg, new RegExp(`data-pitch-object="${id}"`));
      assert.equal(preview.body.scene.elements[targetIndex].x, move.x);
      assert.equal((await call(other, editor, true)).status, 403);
      const blocked = await workspace(admin, { ...save(), pages: save().pages.map((page, index) =>
        index ? page : { ...page, title: "不应覆盖手工摆放" },
      ) });
      assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
      const textCommand = save();
      textCommand.pages[0].objectTexts = [{ id, text: "画布内修改的标题" }];
      const textSaved = await workspace(admin, textCommand);
      assert.equal(textSaved.status, 200, JSON.stringify(textSaved.body));
      detail = (await workspace(admin, { action: "get", projectId: detail.project.id })).body;
      assert.equal(detail.slides[0].content.title, "画布内修改的标题");
      assert.equal(detail.slides[0].content.disclosure, "internal");
      assert.equal(detail.slides[0].scene.elements[targetIndex].x, move.x);
      assert.ok(detail.slides[0].scene.elements.some(e => e.purpose === "source" && e.text.replace(/\s/g, "").includes("未经业务数据核验")));
      const newVersion = detail.project.version;
      const otherPages = detail.slides.slice(1).map(slide => ({ id: slide.id, content: slide.content, scene: slide.scene }));
      const restore = { action: "restore_page", projectId: detail.project.id, slideId: before.id,
        expectedVersion: newVersion, revision: textCommand.expectedVersion };
      assert.equal((await workspace(admin, { ...restore, expectedVersion: newVersion - 1 })).status, 409);
      const undone = await workspace(admin, restore);
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.body.slides[0].content.title, before.content.title);
      assert.deepEqual(undone.body.slides.slice(1).map(slide => ({ id: slide.id, content: slide.content, scene: slide.scene })), otherPages);
      const redone = await workspace(admin, { ...restore, expectedVersion: undone.body.project.version, revision: newVersion });
      assert.equal(redone.status, 200, JSON.stringify(redone.body));
      detail = redone.body;
      assert.equal(detail.slides[0].content.title, "画布内修改的标题");
      const layers = detail.slides[0].scene.elements.flatMap((element, index) => {
        const allowed = (element.kind === "shape" && !element.background) ||
          (element.kind === "text" && (!element.purpose || element.purpose === "content")) ||
          ["image", "table", "chart", "map"].includes(element.kind);
        return allowed ? [element.editorId ?? `object-${index + 1}`] : [];
      });
      assert.ok(layers.length >= 2);
      const reorder = save(), expectedOrder = [...layers].reverse();
      reorder.pages[0].objectOrder = [layers[0], ...layers.slice(0, -1)];
      assert.equal((await workspace(admin, reorder)).status, 422);
      reorder.pages[0].objectOrder = expectedOrder;
      const layered = await workspace(admin, reorder);
      assert.equal(layered.status, 200, JSON.stringify(layered.body));
      detail = layered.body;
      assert.deepEqual(detail.slides[0].scene.elements.flatMap(element => element.editorId ? [element.editorId] : []), expectedOrder);
      assert.equal(detail.slides[0].content.title, "画布内修改的标题");
      const groupCommand = save(), groupId = randomUUID();
      groupCommand.pages[0].objectGroups = [{ id: groupId, memberIds: [expectedOrder[0], "object-999"] }];
      assert.equal((await workspace(admin, groupCommand)).status, 422);
      groupCommand.pages[0].objectGroups = [{ id: groupId, memberIds: expectedOrder.slice(0, 2) }];
      const grouped = await workspace(admin, groupCommand);
      assert.equal(grouped.status, 200, JSON.stringify(grouped.body));
      detail = (await workspace(admin, { action: "get", projectId: detail.project.id })).body;
      assert.deepEqual(detail.slides[0].scene.elements.filter(element => element.editorGroup === groupId).map(element => element.editorId), expectedOrder.slice(0, 2));
    },
  );
  await check(
    "workspace HTTP selected PPTX, full PPTX, PNG, SVG and data Excel return actual private downloadable bytes",
    async () => {
      for (const [format, pages] of [
        ["pptx", [0, 1]],
        ["pptx", undefined],
        ["png", [0]],
        ["svg", [0]],
        ["xlsx", undefined],
      ]) {
        const exportId = randomUUID(),
          command = {
            action: "export_start",
            projectId: detail.project.id,
            exportId,
            audience: "internal",
            format,
            ...(["png", "svg"].includes(format)
              ? { page: 0 }
              : pages
                ? { pages }
                : {}),
          };
        assert.equal((await call(admin, command, true)).status, 202);
        await until(async () => {
          const state = await call(admin, {
            action: "export_status",
            projectId: detail.project.id,
            exportId,
          });
          assert.notEqual(
            state.body.state,
            "failed",
            JSON.stringify(state.body),
          );
          return state.body.state === "ready";
        }, "workspace " + format);
        const file = await call(admin, {
          action: "download",
          projectId: detail.project.id,
          exportId,
          audience: "internal",
        });
        assert.equal(file.status, 200);
        assert.ok(file.body.length > 100);
        if (format === "pptx") {
          const zip = await JSZip.loadAsync(file.body);
          const firstSlide = await zip.file("ppt/slides/slide1.xml").async("string");
          assert.ok(firstSlide.includes("<a:t>画布内修改的标题</a:t>"), "saved text is a native PPTX text run");
          assert.equal(
            Object.keys(zip.files).filter((p) =>
              /^ppt\/slides\/slide\d+\.xml$/.test(p),
            ).length,
            pages?.length ?? detail.slides.length,
          );
        }
        if (format === "png")
          assert.equal(Buffer.from(file.body.subarray(1, 4)).toString(), "PNG");
        if (format === "svg")
          assert.match(Buffer.from(file.body).toString(), /<svg/);
        if (format === "xlsx")
          assert.ok((await JSZip.loadAsync(file.body)).file("xl/workbook.xml"));
      }
    },
  );
  await check("workspace restores automated layout only by an explicit reset", async () => {
    const command = save();
    command.pages[0].resetObjectLayout = true;
    command.pages[0].title = "用户编辑市场页面标题";
    const reset = await workspace(admin, command);
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    detail = reset.body;
    assert.ok(detail.slides[0].scene.elements.every((element) => !element.editorId));
  });
  if (process.env.PITCH_WORKSPACE_BROWSER === "true")
    await check(
      "automated desktop and mobile editor persists actual HTTP changes and exports downloadable files",
      async () => {
        await (
          await import("./pitch-workspace-browser.mjs")
        ).verifyPitchWorkspaceBrowser({
          app,
          who: admin,
          projectId: detail.project.id,
          projectTitle: detail.project.title,
        });
        detail = (
          await workspace(admin, {
            action: "get",
            projectId: detail.project.id,
          })
        ).body;
      },
    );
  await check(
    "workspace HTTP restoration, project copy, private preferences and original data revocation stay enforced",
    async () => {
      const history = detail.history[0];
      assert.ok(history);
      const restored = await workspace(admin, {
        action: "restore",
        projectId: detail.project.id,
        expectedVersion: detail.project.version,
        revision: history.version,
      });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      detail = restored.body;
      const copy = await workspace(admin, {
        action: "copy",
        projectId: detail.project.id,
        newProjectId: randomUUID(),
        title: "隔离副本",
      });
      assert.equal(copy.status, 200);
      assert.equal(copy.body.slides.length, detail.slides.length);
      assert.equal(
        (
          await workspace(admin, {
            action: "preferences",
            value: { favorites: ["team-multiple"], recent: ["rent-trend"] },
          })
        ).status,
        200,
      );
      assert.deepEqual(
        (await workspace(other, { action: "preferences" }, false)).body,
        {},
      );
      await db.query(
        "update private.ai_query_grants set enabled=false where user_id=$1",
        [admin.id],
      );
      assert.equal(
        (
          await workspace(admin, {
            action: "get",
            projectId: detail.project.id,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            admin,
            {
              action: "export_start",
              projectId: detail.project.id,
              exportId: randomUUID(),
              audience: "internal",
              format: "pptx",
            },
            true,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await admin.client
            .from("pitch_workspace_states")
            .select("project_id")
            .eq("project_id", detail.project.id)
        ).data.length,
        0,
      );
    },
  );
}

export async function verifyPitchQuarterlyResearch({ app, db, admin, other, scope, until }) {
  const research = app + "/api/quarterly-research?edition=2026Q2";
  const access = who => fetch(research, { method: "HEAD", headers: who ? { Authorization: "Bearer " + who.token } : {} });
  assert.equal((await access()).status, 401);
  assert.equal((await access(admin)).status, 204);
  if (other) assert.equal((await access(other)).status, 403);

  const workspace = workspaceClient(app);
  const eligible = randomUUID(), foreign = randomUUID(), gradeB = randomUUID();
  const records = [
    [eligible, "合成研究范围内", "北京", "A"],
    [foreign, "合成外地样本", "上海", "A"],
    [gradeB, "合成非甲级样本", "北京", "B"],
  ];
  for (const [id, name, city, grade] of records) {
    await db.query("insert into public.buildings(id,name,submarket,city,grade) values($1,$2,'CBD',$3,$4)", [id, name, city, grade]);
    await db.query(`insert into public.building_metrics(building_id,record_year,record_quarter,total_area,net_effective_rent,
      vacant_area,is_draft,is_locked,locked_at,locked_by) values($1,2026,2,10000,100,1000,false,true,now(),$2)`, [id, admin.id]);
  }
  const marketScope = { ...scope, city: "北京" };
  await db.query(`insert into private.pitch_grants(user_id,organization_id,region,city,business_line,can_generate,valid_until,granted_by)
    values($1,$2,$3,'北京',$4,true,now()+interval '1 day',$1) on conflict do nothing`, [admin.id, scope.organizationId, scope.region, scope.businessLine]);
  try {
    const handoff = { source: { kind: "quarterly-research", edition: "2026Q2" } };
    const preview = { action: "review_handoff", handoff };
    if (other) assert.equal((await workspace(other, preview)).status, 403);
    assert.equal((await workspace(admin, { ...preview, handoff: { ...handoff, period: "2026-Q3" } })).status, 422);
    const review = await workspace(admin, preview);
    assert.equal(review.status, 200, JSON.stringify(review.body));
    assert.equal(review.body.period, "2026-Q2");
    assert.equal(review.body.binding.dataAsOf, "2026-06-30");
    const projectId = randomUUID(), taskId = randomUUID();
    const command = { action: "add_to_pitch", handoff, taskId, fingerprint: review.body.fingerprint,
      target: { mode: "create", projectId, title: "正式季度研究交接", scope: marketScope, themeId: "colliers-default-v1", themeVersion: 2 } };
    const queued = await workspace(admin, command);
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    await until(async () => {
      const response = await workspace(admin, { action: "status", projectId, taskId });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.notEqual(response.body.state, "failed", JSON.stringify(response.body));
      return response.body.state === "completed";
    }, "persist a reviewed quarterly research handoff");
    const saved = await workspace(admin, { action: "get", projectId });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.workspace.context.period, "2026-Q2");
    const page = saved.body.slides.find(slide => slide.scene.elements.some(element => element.kind === "table"));
    assert.equal(page?.content.dataAsOf, "2026-06-30");
    const receipt = await db.query(`select g.snapshots from public.pitch_business_generations g
      join private.pitch_workspace_tasks t on t.source_project_id=g.project_id where t.id=$1`, [taskId]);
    const pinned = receipt.rows[0].snapshots[0].results[0].parameters.executedPlan;
    assert.deepEqual(pinned.period, { year: 2026, quarter: 2 });
    assert.ok(pinned.scope.buildingIds.includes(eligible));
    assert.ok(!pinned.scope.buildingIds.includes(foreign) && !pinned.scope.buildingIds.includes(gradeB));
  } finally {
    const ids = records.map(([id]) => id);
    await db.query("delete from public.building_metrics where building_id=any($1::uuid[])", [ids]);
    await db.query("delete from public.buildings where id=any($1::uuid[])", [ids]);
  }
}
