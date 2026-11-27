import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dynamicFixture } from "../../supabase/tests/pitch-studio/business-fixtures.mjs";

export async function verifyPitchDocumentDelivery({ app, db, owner, other, viewer, scope, call, check, until, studioProject, studioExport }) {
  async function workspace(who, input, write = true) {
    const url = app + "/api/intelligence/pitch/workspace" + (write ? "" : "?" + new URLSearchParams(input));
    const response = await fetch(url, {
      method: write ? "POST" : "GET",
      headers: {
        ...(who ? { Authorization: "Bearer " + who.token } : {}),
        ...(write ? { "Content-Type": "application/json" } : {}),
      },
      ...(write ? { body: JSON.stringify(input) } : {}),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  await check("a repeated HTTP export produces a new receipt and reuses the authorized PPTX object", async () => {
    const exportId = randomUUID();
    const eligibility = await call(owner, { action: "export_eligibility", projectId: studioProject, audience: "internal" });
    assert.equal(eligibility.status, 200);
    const expectedVersion = eligibility.body.projectVersion;
    const request = { action: "export_start", projectId: studioProject, exportId, expectedVersion, audience: "internal", format: "pptx" };
    const stale = { ...request, exportId: randomUUID(), expectedVersion: expectedVersion + 1 };
    assert.equal((await call(owner, stale, true)).status, 409);
    assert.equal((await db.query("select id from public.pitch_exports where id=$1", [stale.exportId])).rowCount, 0);
    const start = await call(owner, request, true);
    assert.equal(start.status, 202, JSON.stringify(start.body));
    assert.deepEqual(start.body, { exportId, state: "ready", reused: true });
    assert.equal((await call(owner, request, true)).body.replayed, true);
    assert.equal((await call(owner, { ...request, expectedVersion: stale.expectedVersion }, true)).status, 409);
    const status = await call(owner, { action: "export_status", projectId: studioProject, exportId });
    assert.equal(status.status, 200);
    assert.equal(status.body.state, "ready");
    const packageId = (await db.query("select file_export_id from public.pitch_exports where id=$1", [exportId])).rows[0]?.file_export_id;
    assert.equal(packageId, studioExport);

    const download = { action: "download", projectId: studioProject, exportId, audience: "internal" };
    const original = await call(owner, { ...download, exportId: studioExport });
    const repeated = await call(owner, download);
    assert.equal(original.status, 200);
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body, original.body);
    assert.equal((await call(other, download)).status, 403);
    assert.equal((await call(owner, { ...download, audience: "client" })).status, 403);
  });

  await check("status recovers a committed export whose original worker never started", async () => {
    const exportId = randomUUID();
    const sessionId = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url")).session_id;
    const { rows: [{ receipt }] } = await db.query(
      "select public.pitch_studio_access($1,$2,$3) receipt", [owner.id, sessionId, {
        action: "export_prepare", projectId: studioProject, exportId, audience: "internal", format: "png",
        page: 0, asynchronous: true, pipeline: "delivery/1", filename: "中断恢复.png",
      }],
    );
    assert.equal(receipt.state, "pending");
    const status = { action: "export_status", projectId: studioProject, exportId };
    assert.equal((await call(other, status)).status, 403);
    for (const result of await Promise.all([call(owner, status), call(owner, status)])) {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.id, exportId);
    }
    await until(async () => {
      const result = await call(owner, status);
      assert.equal(result.status, 200);
      assert.notEqual(result.body.state, "failed", JSON.stringify(result.body));
      return result.body.state === "ready";
    }, "resume original export worker");
    const download = { action: "download", projectId: studioProject, exportId, audience: "internal" };
    const png = await call(owner, download);
    assert.equal(png.status, 200);
    assert.deepEqual([...png.body.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal((await call(owner, { ...download, audience: "client" })).status, 403);
  });

  await check("an interrupted generation resumes its queued task through ordinary authenticated status polling", async () => {
    const projectId = randomUUID(), taskId = randomUUID(), sourceProjectId = randomUUID();
    const created = await workspace(owner, {
      action: "create", projectId, title: "隔离任务恢复", scope, themeId: "colliers-default-v1",
      themeVersion: 2, context: { language: "zh" },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const expectedVersion = created.body.project.version;
    const part = { mode: "example", templateIds: ["corporate-overview"] };
    const denied = await workspace(owner, {
      action: "start", projectId, expectedVersion, taskId, part: {
        mode: "handoff", parameters: dynamicFixture, language: "zh", dataVersion: "0".repeat(64),
        permissionRevision: "fixture", policyVersion: "fixture",
      },
    });
    assert.equal(denied.status, 422, JSON.stringify(denied.body));
    const sessionId = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url")).session_id;
    const command = {
      action: "workspace_task_start", projectId, expectedVersion, taskId, sourceProjectId,
      command: { part, replaceIds: [] },
    };
    // Stop after the same database admission used by the route. No worker has
    // been scheduled and the client will only resume its previous status poll.
    const { rows: [{ receipt }] } = await db.query(
      "select public.pitch_studio_access($1,$2,$3) receipt", [owner.id, sessionId, command],
    );
    assert.equal(receipt.state, "queued");
    assert.equal(receipt.attempts, 0);
    const status = { action: "status", projectId, taskId };
    assert.equal((await workspace(other, status)).status, 403);
    for (const result of await Promise.all([workspace(owner, status), workspace(owner, status)])) {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.id, taskId);
    }
    await until(async () => {
      const result = await workspace(owner, status);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.notEqual(result.body.state, "failed", JSON.stringify(result.body));
      if (result.body.state !== "completed") return false;
      assert.equal(result.body.attempts, 1);
      return true;
    }, "resume original workspace task");
    const saved = await workspace(owner, { action: "get", projectId });
    assert.equal(saved.body.project.version, expectedVersion + 1);
    assert.ok(saved.body.slides.length);
    assert.equal((await db.query("select id from public.pitch_projects where id=$1", [sourceProjectId])).rowCount, 1);
  });

  await check("real Auth serves only the named reader's pinned slides and promptly revokes the presentation", async () => {
    const projectId = randomUUID();
    const created = await workspace(owner, {
      action: "create", projectId, title: "隔离原版演示", scope, themeId: "colliers-default-v1", themeVersion: 2,
      context: { language: "zh" },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const selectedPage = await workspace(owner, {
      action: "custom", projectId, expectedVersion: created.body.project.version,
      title: "已选说明", body: "固定版本的合成内容。",
    });
    assert.equal(selectedPage.status, 200, JSON.stringify(selectedPage.body));
    const privatePage = await workspace(owner, {
      action: "custom", projectId, expectedVersion: selectedPage.body.project.version,
      title: "个人草稿", body: "这页留在编辑项目内。",
    });
    assert.equal(privatePage.status, 200, JSON.stringify(privatePage.body));
    const before = privatePage.body;
    const [selected, excluded] = before.slides;
    const shareId = randomUUID();
    const create = {
      action: "share_create", projectId, shareId, recipientId: viewer.id, expectedVersion: before.project.version,
      slideIds: [selected.id],
    };
    const share = await workspace(owner, create);
    assert.equal(share.status, 200, JSON.stringify(share.body));
    assert.deepEqual(share.body.pageIds, [selected.id]);
    assert.deepEqual((await workspace(owner, create)).body, share.body);

    const open = { action: "shared_presentation", shareId };
    assert.equal((await workspace(null, open, false)).status, 401);
    assert.equal((await workspace(other, open, false)).status, 403);
    const opened = await workspace(viewer, open, false);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.match(opened.headers.get("cache-control"), /no-store/);
    assert.deepEqual(opened.body.pages, [{ id: selected.id, title: "已选说明" }]);
    assert.equal((await workspace(viewer, { action: "get", projectId })).status, 403);

    const render = { action: "shared_slide", shareId, slideId: selected.id };
    const page = await workspace(viewer, render, false);
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.deepEqual(Object.keys(page.body), ["id", "svg"]);
    assert.match(page.body.svg, /^<svg/);
    assert.equal((await workspace(viewer, { ...render, slideId: excluded.id }, false)).status, 403);

    const edit = await workspace(owner, {
      action: "save", projectId, expectedVersion: before.project.version, title: "新编辑版",
      themeId: before.project.theme_id, themeVersion: before.project.theme_version, context: before.workspace.context,
      activeSlide: selected.id, pages: [{ id: selected.id, title: "更新后的说明" }, { id: excluded.id }],
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.deepEqual((await workspace(viewer, open, false)).body, opened.body);
    assert.deepEqual((await workspace(viewer, render, false)).body, page.body);

    const revoke = { action: "share_revoke", projectId, shareId };
    assert.equal((await workspace(viewer, revoke)).status, 403);
    assert.equal((await workspace(owner, revoke)).status, 200);
    assert.equal((await workspace(viewer, render, false)).status, 403);
  });
}
