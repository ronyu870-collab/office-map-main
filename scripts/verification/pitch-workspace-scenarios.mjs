// Real Auth sessions, production Next handlers, PostgreSQL and private Storage.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { dynamicFixture } from "../../supabase/tests/pitch-studio/business-fixtures.mjs";
export async function verifyPitchWorkspace({
  app,
  db,
  other,
  admin,
  scope,
  call,
  check,
  until,
  ids,
}) {
  const workspace = async (who, input, write = true) => {
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
