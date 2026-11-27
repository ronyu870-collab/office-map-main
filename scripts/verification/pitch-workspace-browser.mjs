// Optional implementation layout check against actual local Auth/Next/Pitch APIs.
// No API scene, project, generation or export response is mocked.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

async function launchBrowser() {
  const { chromium } = createRequire(import.meta.url)(
    process.env.PERF_PLAYWRIGHT_MODULE || "playwright-core",
  );
  return chromium.launch({
    headless: true,
    ...(process.env.PERF_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: "chrome" }),
  });
}

async function openWorkspaceContext(browser, app, who, width) {
  const { data } = await who.client.auth.getSession(),
    session = data.session;
  assert.ok(session);
  const payload = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
  );
  const context = await browser.newContext({
    viewport: { width, height: 950 },
    isMobile: width < 700,
    hasTouch: width < 700,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    colorScheme: width === 320 ? "dark" : "light",
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin === app) return route.continue();
    // Browser-only session bootstrap; the server still verifies the real token,
    // role and scope through the disposable local GoTrue/PostgREST stack.
    if (
      url.hostname === "example.supabase.co" ||
      url.hostname === "127.0.0.1"
    ) {
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
      };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      if (url.pathname === "/auth/v1/user")
        return route.fulfill({ headers, json: session.user });
      if (url.pathname === "/rest/v1/user_roles")
        return route.fulfill({
          headers,
          json: [
            {
              role: "admin",
              session_id: payload.session_id,
              full_name: "隔离测试账号",
              chinese_name: null,
              phone: null,
            },
          ],
        });
      return route.fulfill({ headers, json: [] });
    }
    return route.abort();
  });
  await context.addInitScript((saved) => {
    localStorage.setItem(
      "colliers_trusted_device_until",
      String(Date.now() + 3600000),
    );
    for (const key of ["sb-example-auth-token", "sb-127-auth-token"])
      localStorage.setItem(key, JSON.stringify(saved));
  }, session);
  return context;
}

export async function verifyPitchWorkspaceBrowser({
  app,
  who,
  projectTitle,
  projectId,
}) {
  assert.equal(new URL(app).hostname, "127.0.0.1");
  const browser = await launchBrowser();
  const observations = [];
  await mkdir("tmp/pitch-workspace-browser", { recursive: true });
  try {
    for (const width of [1440, 390, 320]) {
      const context = await openWorkspaceContext(browser, app, who, width);
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(app + "/intelligence/pitch");
        await page
          .getByRole("button", { name: "我的 Pitch", exact: true })
          .click();
        await page
          .getByRole("button", { name: new RegExp(projectTitle) })
          .first()
          .click();
        await page
          .getByRole("region", { name: "页面预览", exact: true })
          .getByRole("img")
          .waitFor({ timeout: 45000 });
        assert.ok(
          await page.getByLabel("项目名称", { exact: true }).inputValue(),
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "no horizontal document overflow",
        );
        if (width < 700) {
          await page.getByRole("tab", { name: "页面", exact: true }).click();
          await page.getByRole("button", { name: "第 1 页操作", exact: true }).click();
          const actions = page.getByRole("group", { name: "第 1 页操作" });
          await actions.getByRole("button", { name: "复制第 1 页" }).waitFor();
          await page.keyboard.press("Escape");
          await actions.waitFor({ state: "hidden" });
          await page.getByRole("button", { name: "提案助手", exact: true }).click();
          await page.getByLabel("需要制作什么页面？").fill("在窄屏保留提案草稿");
          await page.getByRole("button", { name: "属性", exact: true }).click();
          await page
            .getByLabel("页面标题", { exact: true })
            .fill("隔离移动编辑 " + width);
          await page.getByRole("button", { name: "保存", exact: true }).click();
          await page
            .getByRole("tab", { name: "页面预览", exact: true })
            .click();
        } else {
          await page.getByRole("button", { name: "调整画布对象", exact: true }).click();
          const objects = page.getByRole("region", { name: "画布对象编辑" });
          const target = objects.getByRole("button", { name: /对象 \d+：用户编辑市场页面标题/ });
          await target.waitFor({ timeout: 45000 });
          await target.focus();
          const location = objects.locator('output');
          const original = await location.textContent();
          await target.press("ArrowLeft");
          assert.notEqual(await location.textContent(), original, "native layer moves without saving");
          await objects.getByRole("button", { name: "返回预览", exact: true }).click();
          const rightDivider = page.getByRole("separator", { name: "调整右栏宽度" });
          await rightDivider.press("ArrowLeft");
          assert.equal(await rightDivider.getAttribute("aria-valuenow"), "316");

          const firstPage = page.getByRole("button", { name: /^打开第 1 页/ });
          await firstPage.click({ button: "right" });
          const actions = page.getByRole("group", { name: "第 1 页操作" });
          await actions.getByRole("button", { name: "复制第 1 页" }).waitFor();
          await page.keyboard.press("Escape");
          await actions.waitFor({ state: "hidden" });

          const preview = page.getByRole("region", { name: "页面预览", exact: true });
          const beforeFocus = (await preview.boundingBox()).width;
          await page.getByRole("button", { name: "专注画布", exact: true }).click();
          assert.ok((await preview.boundingBox()).width > beforeFocus + 300);
          await page.getByRole("button", { name: "退出专注画布", exact: true }).click();
          await page
            .getByRole("button", { name: "收起左栏", exact: true })
            .click();
          await page
            .getByRole("button", { name: "收起编辑", exact: true })
            .click();
          assert.ok(
            (
              await page
                .getByRole("region", { name: "页面预览", exact: true })
                .boundingBox()
            ).width > 1000,
          );
          await page
            .getByRole("button", { name: "编辑页面", exact: true })
            .click();
        }
        await page.screenshot({
          path: `tmp/pitch-workspace-browser/workspace-${width}.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "导出", exact: true }).click();
        await page
          .getByLabel("页面范围", { exact: true })
          .selectOption("current");
        await page
          .getByRole("button", { name: "生成文件", exact: true })
          .click();
        await page
          .getByRole("button", { name: "下载已生成文件", exact: true })
          .waitFor({ timeout: 60000 });
        const exported = await page.getByRole("dialog").boundingBox();
        assert.ok(
          exported.x >= 0 && exported.x + exported.width <= width + 1,
          "export dialog remains inside viewport",
        );
        await page.getByRole("button", { name: "关闭", exact: true }).click();
        await page.reload();
        await page
          .getByRole("button", { name: "我的 Pitch", exact: true })
          .click();
        await page
          .getByRole("button", { name: new RegExp(projectTitle) })
          .first()
          .click();
        await page
          .getByRole("region", { name: "页面预览", exact: true })
          .getByRole("img")
          .waitFor({ timeout: 45000 });
        if (width < 700) {
          await page
            .getByRole("tab", { name: "页面编辑", exact: true })
            .click();
          assert.equal(
            await page.getByLabel("页面标题", { exact: true }).inputValue(),
            "隔离移动编辑 " + width,
          );
        }
        await page.getByRole('button',{name:'示例与套装',exact:true}).click();
        await page.getByRole('tab',{name:'提案套装',exact:true}).click();
        await page.getByLabel('提案套装',{exact:true}).selectOption('market-review');
        assert.equal(await page.getByRole('checkbox').count(),10);
        assert.ok(await page.getByRole('button',{name:'创建演示 Pitch',exact:true}).isEnabled());
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'example library fits viewport');
        assert.deepEqual(errors, []);
        observations.push({
          width,
          projectId,
          persisted: true,
          exportReady: true,
          overflow: false,
        });
      } catch (error) {
        await page
          .screenshot({
            path: `tmp/pitch-workspace-browser/failure-${width}.png`,
            fullPage: true,
          })
          .catch(() => {});
        console.error(
          "Pitch browser failure",
          width,
          await page.locator("body").innerText(),
        );
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    "tmp/pitch-workspace-browser/results.json",
    JSON.stringify(observations, null, 2),
  );
}

const flagshipScenarios = [
  { button: "招商代理", scenario: "leasing-agency", buildings: 1, pages: ["cover", "profile", "implementation"] },
  { button: "办公选址对比", scenario: "site-selection", buildings: 5, pages: ["cover", "scope", "next-steps"] },
  { button: "季度市场报告", scenario: "market-report", buildings: 0, pages: ["cover", "key-indicators", "methodology"] },
  { button: "单楼项目推介", scenario: "building-promotion", buildings: 1, pages: ["cover", "profile", "next-steps"] },
];

function waitForPitchCommand(page, endpoint, action) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === endpoint &&
      request.method() === "POST" && request.postDataJSON()?.action === action;
  }, { timeout: 60_000 });
}

async function closeFlagshipBrowser(browser) {
  let timer;
  try {
    await Promise.race([browser.close(), new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadPitchFile(page, format) {
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出 Pitch" });
  await dialog.getByLabel("文件格式").selectOption(format);
  await dialog.getByRole("button", { name: "生成文件", exact: true }).click();
  const downloadButton = dialog.getByRole("button", { name: "下载已生成文件" });
  await downloadButton.waitFor({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  assert.ok(download.suggestedFilename().toLowerCase().endsWith(`.${format}`));
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  return readFile(await download.path());
}

async function downloadPptx(page) {
  return JSZip.loadAsync(await downloadPitchFile(page, "pptx"), { checkCRC32: true });
}

export async function verifyPitchChartRevisionBrowser({ app, who, readProject }) {
  assert.equal(new URL(app).hostname, "127.0.0.1");
  const projectId = randomUUID();
  const pitch = "/api/intelligence/pitch";
  const period = { year: 2026, quarter: 3 };
  const generated = await fetch(app + pitch + "/business", {
    method: "POST",
    headers: { Authorization: "Bearer " + who.token, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "generate", projectId, title: "隔离图表换型", language: "zh",
      scope: { organizationId: "synthetic-org", region: "华北", city: "北京", businessLine: "office" },
      themeId: "colliers-default-v1", themeVersion: 2,
      parts: [{ mode: "dynamic", parameters: {
        templateId: "rent-trend", buildingIds: [], submarkets: ["CBD"], inventory: "tracked",
        period, start: { year: 2026, quarter: 1 }, end: period, fields: [], direction: "asc", chart: "line",
        from: "2026-01-01", to: "2026-09-30", leaseSource: "combined", measure: "count",
      } }],
    }),
  });
  assert.ok(generated.ok, `seed formal chart HTTP ${generated.status}`);
  const initial = await readProject(projectId);
  const chart = initial.slides[0].content.blocks.find(block => block.kind === "chart");
  assert.equal(chart?.chartType, "line");
  const browser = await launchBrowser();
  try {
    const context = await openWorkspaceContext(browser, app, who, 1440);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const button = name => page.getByRole("button", { name, exact: true });
    await page.goto(`${app}/intelligence/pitch?project=${projectId}`);
    await page.getByRole("region", { name: "页面预览", exact: true }).getByRole("img").waitFor({ timeout: 45_000 });
    await button("提案助手").click();
    await page.getByLabel("需要制作什么页面？").fill("将折线图改为柱状图");
    const [preview] = await Promise.all([waitForPitchCommand(page, pitch + "/ai", "proposal_revision"), button("预览修改").click()]);
    const revision = await preview.json();
    assert.ok(preview.ok() && revision.status === "ready", `chart preview HTTP ${preview.status()} / ${revision.status}`);
    const review = page.getByRole("dialog", { name: "核对 AI 修改" });
    await review.getByText(/折线图 → 柱状图/).waitFor();
    assert.equal((await readProject(projectId)).project.version, initial.project.version);
    const [saved] = await Promise.all([waitForPitchCommand(page, pitch + "/workspace", "apply_modification"),
      review.getByRole("button", { name: "应用修改" }).click()]);
    assert.deepEqual(saved.request().postDataJSON(), revision.command);
    assert.ok(saved.ok(), `chart apply HTTP ${saved.status()}`);
    await review.waitFor({ state: "hidden" });
    const updated = await readProject(projectId);
    assert.deepEqual(updated.slides[0].content.blocks.find(block => block.kind === "chart"), { ...chart, chartType: "column" });
    assert.equal(updated.slides[0].scene.elements.find(element => element.kind === "chart")?.chartType, "column");
    const archive = await downloadPptx(page);
    const chartFile = archive.file(/^ppt\/charts\/chart\d+\.xml$/)[0];
    assert.ok(chartFile, "PPTX contains a native chart");
    const chartXml = await chartFile.async("string");
    assert.match(chartXml, /<c:barChart>/);
    assert.match(chartXml, /<c:barDir val="col"/);
    const rent = chart.series[0].values.find(value => value !== null);
    assert.ok(chartXml.includes(`<c:v>${rent}</c:v>`), "native chart retains the reviewed values");
    const [restored] = await Promise.all([waitForPitchCommand(page, pitch + "/workspace", "restore"),
      button("撤销上次修改").click()]);
    assert.ok(restored.ok(), `chart restore HTTP ${restored.status()}`);
    const undo = await readProject(projectId);
    assert.deepEqual(undo.slides[0].content.blocks.find(block => block.kind === "chart"), chart);
    console.log("PASS reviewed chart change, native PPTX export, unchanged values and undo");
  } catch (error) {
    console.error("Chart revision browser failure", error);
    throw error;
  } finally {
    await closeFlagshipBrowser(browser);
  }
}

export async function verifyPitchBuildingInspectorBrowser({ app, who, period, readProject, quarterRevision = false, competitorRevision = false }) {
  assert.equal(new URL(app).hostname, "127.0.0.1");
  const browser = await launchBrowser();
  let stage = "creating";
  try {
    const context = await openWorkspaceContext(browser, app, who, 1440);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const button = (name) => page.getByRole("button", { name, exact: true });
    const workspace = "/api/intelligence/pitch/workspace";
    await page.goto(app + "/intelligence/pitch");
    await button("新建空白演示文稿").click();
    await page.getByLabel("Pitch 名称").fill("隔离楼宇核对");
    await page.getByText("更多项目设置（可选）", { exact: true }).click();
    await page.getByLabel("默认季度").fill(period);
    const [created] = await Promise.all([waitForPitchCommand(page, workspace, "create"), button("创建").click()]);
    assert.ok(created.ok(), `workspace create HTTP ${created.status()}`);
    const { project } = await created.json();
    stage = "searching";
    await button("数据").click();
    await page.getByText("查找楼宇数据", { exact: true }).click();
    await page.getByLabel("搜索楼宇").fill("霄云路33号");
    await button("霄云路33号").click();

    stage = "reviewing";
    const [reviewed] = await Promise.all([waitForPitchCommand(page, workspace, "review_handoff"), button("核对季度数据").click()]);
    assert.ok(reviewed.ok(), `review_handoff HTTP ${reviewed.status()}`);
    const { handoff } = reviewed.request().postDataJSON();
    const preview = await reviewed.json();
    assert.equal(handoff.projectId, project.id);
    assert.equal(preview.period, period);
    assert.equal(preview.buildingIds.length, 1);
    assert.deepEqual(handoff.source.buildingIds, preview.buildingIds);
    const reviewDialog = page.getByRole("dialog", { name: "加入 Pitch" });
    const rent = new RegExp(`\\b${100 + Number(period.at(-1))}\\b`);
    const reviewedPage = preview.pages.find((slide) => slide.blocks.some((block) =>
      block.kind === "table" && block.rows.some((row) => row.some((value) => rent.test(String(value))))));
    assert.ok(reviewedPage, `source review did not contain the fixture rent: ${JSON.stringify(preview.pages.map(slide => ({
      title: slide.title, tables: slide.blocks.filter(block => block.kind === "table"),
    })))}`);
    const evidence = reviewDialog.locator("details").filter({ has: page.getByText(reviewedPage.title, { exact: true }) });
    await evidence.waitFor();
    if (await evidence.getAttribute("open") === null) await evidence.locator("summary").click();
    await evidence.getByRole("cell", { name: rent }).waitFor();
    assert.equal(await reviewDialog.getByLabel("目标项目").count(), 0, "current project is already selected");
    stage = "appending";
    const [accept] = await Promise.all([
      waitForPitchCommand(page, workspace, "add_to_pitch"), reviewDialog.getByRole("button", { name: "确认并追加" }).click(),
    ]);
    assert.equal(accept.status(), 202);
    const command = accept.request().postDataJSON();
    assert.deepEqual(command.handoff, handoff);
    assert.equal(command.fingerprint, preview.fingerprint);
    assert.equal(command.target.mode, "append");
    await reviewDialog.waitFor({ state: "hidden" });
    await page.getByRole("region", { name: "页面预览", exact: true }).getByRole("img").waitFor({ timeout: 60_000 });
    const saved = await readProject(project.id);
    assert.ok(saved.project.version > command.target.expectedVersion);
    assert.ok(saved.slides[0].content.sources.length);
    assert.deepEqual(saved.workspace.context.buildingIds, preview.buildingIds);
    console.log("PASS building search, formal evidence, versioned append and saved preview");
    if (quarterRevision) {
      stage = "reviewing a formal quarter through the proposal assistant";
      await button("提案助手").click();
      await page.getByLabel("需要制作什么页面？").fill("把整套报告更新到最新季度");
      const [proposed] = await Promise.all([
        waitForPitchCommand(page, "/api/intelligence/pitch/ai", "proposal_revision"), button("预览修改").click(),
      ]);
      const revision = await proposed.json();
      assert.ok(proposed.ok() && revision.status === "ready",
        `quarter preview HTTP ${proposed.status()} / ${revision.status}: ${revision.message ?? revision.error ?? ""}`);
      assert.equal(revision.command.action, "apply_data_refresh");
      assert.deepEqual(revision.command.period, { year: 2026, quarter: 3 });
      assert.deepEqual(revision.review.changes.map(change => change.slideId).sort(), saved.slides.map(slide => slide.id).sort());
      const dialog = page.getByRole("dialog", { name: "核对 AI 修改" });
      await dialog.getByText(/2026-Q3 · 影响 \d+ 页/).waitFor();
      await dialog.getByRole("cell", { name: rent }).waitFor();
      await dialog.getByRole("cell", { name: /\b103\b/ }).waitFor();
      assert.equal((await readProject(project.id)).project.version, saved.project.version);

      stage = "applying the exact reviewed quarter update";
      const [applied] = await Promise.all([
        waitForPitchCommand(page, workspace, "apply_data_refresh"), dialog.getByRole("button", { name: "应用修改" }).click(),
      ]);
      assert.deepEqual(applied.request().postDataJSON(), revision.command);
      assert.ok(applied.ok(), `quarter apply HTTP ${applied.status()}`);
      await dialog.waitFor({ state: "hidden" });
      const refreshed = await readProject(project.id);
      assert.ok(refreshed.project.version > saved.project.version);
      assert.deepEqual(refreshed.slides.map(slide => slide.id), saved.slides.map(slide => slide.id));
      for (const change of revision.review.changes) {
        assert.equal(refreshed.slides.find(slide => slide.id === change.slideId).content.dataAsOf, change.after.dataAsOf);
      }
      const updatedSlide = refreshed.slides.find(slide => slide.content.title === reviewedPage.title);
      assert.ok(updatedSlide?.content.blocks.some(block => block.kind === "table" && block.rows.some(row =>
        row.some(value => /\b103\b/.test(String(value))))), "saved page contains the reviewed quarter rent");

      stage = "undoing the quarter update";
      const [restored] = await Promise.all([waitForPitchCommand(page, workspace, "restore"), button("撤销上次修改").click()]);
      assert.ok(restored.ok(), `quarter restore HTTP ${restored.status()}`);
      const reverted = await readProject(project.id);
      assert.deepEqual(reverted.slides.map(slide => slide.content), saved.slides.map(slide => slide.content));
      console.log("PASS AI quarter preview with formal before/after values, versioned apply and undo");
    }
    if (competitorRevision) {
      stage = "reviewing a formal competitor comparison";
      const before = await readProject(project.id);
      await button("提案助手").click();
      await page.getByLabel("需要制作什么页面？").fill("整套提案新增：加入「五矿广场」作为竞品");
      const [proposed] = await Promise.all([
        waitForPitchCommand(page, "/api/intelligence/pitch/ai", "proposal_revision"), button("预览修改").click(),
      ]);
      const revision = await proposed.json();
      assert.ok(proposed.ok() && revision.mode === "append-comparison",
        `competitor preview HTTP ${proposed.status()} / ${revision.status}: ${revision.message ?? revision.error ?? ""}`);
      assert.deepEqual(revision.review.buildingIds, [...preview.buildingIds, revision.review.competitor.id]);
      const dialog = page.getByRole("dialog", { name: "核对 AI 修改" });
      await dialog.getByText(new RegExp(`五矿广场 · ${period} · 追加 \\d+ 页`)).waitFor();
      const value = new RegExp(`\\b${112 + Number(period.at(-1))}\\b`);
      const evidencePage = revision.review.pages.find(slide => slide.blocks.some(block => block.kind === "table" &&
        block.rows.some(row => row.some(cell => value.test(String(cell))))));
      assert.ok(evidencePage, "formal comparison contains the competitor rent");
      const evidence = dialog.locator("details").filter({ has: page.getByText(evidencePage.title, { exact: true }) });
      await evidence.waitFor();
      if (await evidence.getAttribute("open") === null) await evidence.locator("summary").click();
      await evidence.getByRole("cell", { name: value }).waitFor();
      assert.equal((await readProject(project.id)).project.version, before.project.version);

      stage = "appending the exact reviewed comparison";
      const [queued] = await Promise.all([waitForPitchCommand(page, workspace, "add_to_pitch"),
        dialog.getByRole("button", { name: "追加对比页" }).click()]);
      assert.equal(queued.status(), 202);
      assert.deepEqual(queued.request().postDataJSON(), revision.command);
      await page.getByText("竞品对比页已追加。", { exact: true }).waitFor({ timeout: 60_000 });
      const comparison = await readProject(project.id);
      const savedSlide = ({ id, content, scene }) => ({ id, content, scene });
      assert.deepEqual(comparison.slides.slice(0, before.slides.length).map(savedSlide), before.slides.map(savedSlide));
      assert.equal(comparison.slides.length - before.slides.length, revision.review.pages.length);
      const archive = await downloadPptx(page);
      const appended = await archive.file(`ppt/slides/slide${before.slides.length + revision.review.pages.indexOf(evidencePage) + 1}.xml`)?.async("string");
      assert.ok(appended?.includes("五矿广场") && value.test(appended), "PPTX includes the reviewed comparison name and value");

      stage = "undoing the comparison append";
      const [restored] = await Promise.all([waitForPitchCommand(page, workspace, "restore"), button("撤销上次修改").click()]);
      assert.ok(restored.ok(), `competitor restore HTTP ${restored.status()}`);
      const reverted = await readProject(project.id);
      assert.deepEqual(reverted.slides.map(slide => slide.content), before.slides.map(slide => slide.content));
      console.log("PASS AI competitor review, exact saved append, PPTX and undo");
    }
  } catch (error) {
    console.error(`Building inspector failed while ${stage}`, error);
    throw error;
  } finally {
    await closeFlagshipBrowser(browser);
  }
}

export async function verifyPitchFlagshipBrowser({ app, who, period, readProject, requiredVisuals = {} }) {
  assert.equal(new URL(app).hostname, "127.0.0.1");
  const browser = await launchBrowser();
  const report = [];
  try {
    const context = await openWorkspaceContext(browser, app, who, 1440);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const button = (name) => page.getByRole("button", { name, exact: true });
    for (const scenario of flagshipScenarios) {
      const result = { scenario: scenario.scenario, stage: "planning" };
      report.push(result);
      try {
        await page.goto(app + "/intelligence/pitch");
        const [planHttp] = await Promise.all([
          waitForPitchCommand(page, "/api/intelligence/pitch/ai", "proposal_plan"),
          button(scenario.button).click(),
        ]);
        const plan = await planHttp.json();
        assert.ok(planHttp.ok(), `proposal_plan HTTP ${planHttp.status()}: ${plan.code ?? plan.error ?? ""}`);
        assert.equal(plan.status, "ready", plan.code ?? plan.message);
        assert.equal(plan.brief.scenario, scenario.scenario);
        assert.equal(plan.brief.period, period);
        assert.equal(plan.brief.buildingIds.length, scenario.buildings);
        const pageKinds = new Set(plan.plan.slides.map((slide) => slide.pageKind));
        const visualKinds = new Set(plan.plan.slides.flatMap((slide) => slide.visuals ?? []).map((visual) => visual.kind));
        result.missingPages = scenario.pages.filter((kind) => !pageKinds.has(kind));
        result.missingVisuals = (requiredVisuals[scenario.scenario] ?? []).filter((kind) => !visualKinds.has(kind));
        if (result.missingPages.length || result.missingVisuals.length) result.gaps = plan.plan.gaps;

        result.stage = "generating";
        const generationEndpoint = "/api/intelligence/pitch/ai";
        let action = button("确认并生成 Pitch");
        let receipt;
        for (let attempt = 0; attempt < 30; attempt++) {
          const [reply] = await Promise.all([
            waitForPitchCommand(page, generationEndpoint, "proposal_generate"),
            action.click(),
          ]);
          receipt = await reply.json();
          assert.ok(reply.ok(), `proposal_generate HTTP ${reply.status()}: ${receipt.code ?? receipt.error ?? ""}`);
          if (receipt.state === "completed") break;
          assert.ok(["queued", "running"].includes(receipt.state), `generation state ${receipt.state}`);
          action = button("查询生成进度");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        assert.equal(receipt?.state, "completed", "generation did not complete");
        assert.ok(receipt.projectId);

        result.stage = "editing";
        await page.getByRole("region", { name: "页面预览", exact: true }).getByRole("img").waitFor({ timeout: 45_000 });
        const created = await readProject(receipt.projectId);
        assert.ok(created.slides.length, "the completed project has no pages");
        const editedTitle = `隔离验收 · ${scenario.button}`;
        await page.getByLabel("页面标题", { exact: true }).fill(editedTitle);
        const [savedResponse] = await Promise.all([
          waitForPitchCommand(page, "/api/intelligence/pitch/workspace", "save"),
          button("保存").click(),
        ]);
        assert.ok(savedResponse.ok(), `workspace save HTTP ${savedResponse.status()}`);
        const reopened = await readProject(receipt.projectId);
        assert.ok(reopened.project.version > created.project.version);
        assert.equal(reopened.slides[0].content.title, editedTitle);

        result.stage = "presenting";
        await button("演示").click();
        const presentation = page.getByRole("dialog", { name: "演示文稿" });
        await presentation.getByRole("region", { name: "演示画布" }).getByRole("img").waitFor({ timeout: 45_000 });
        await presentation.getByRole("button", { name: "退出演示" }).click();

        result.stage = "exporting";
        const archive = await downloadPptx(page);
        const names = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
        assert.equal(names.length, reopened.slides.length);
        const first = await archive.file("ppt/slides/slide1.xml").async("string");
        const texts = [...first.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(([, value]) => value);
        assert.ok(texts.join("").includes(editedTitle), `export omitted the saved title: ${texts.slice(0, 6).join(" | ")}`);
        assert.match(first, /<p:sp>/);
        const pdf = await PDFDocument.load(await downloadPitchFile(page, "pdf"));
        assert.equal(pdf.getPageCount(), reopened.slides.length);
        result.stage = "completed";
        result.pages = names.length;
      } catch (error) {
        result.error = String(error instanceof Error ? error.message : error).split("\n")[0];
      }
    }
    console.log(JSON.stringify(report));
    assert.ok(report.every((value) => value.stage === "completed" && !value.missingPages.length && !value.missingVisuals.length),
      "one or more flagship paths or required evidence are incomplete");
  } finally {
    await closeFlagshipBrowser(browser);
  }
}

export async function verifyPitchOutlineBrowser({ app, who, buildingName, period, changeQuarter, readProject, assertClientDenied, research, image }) {
  const browser = await launchBrowser();
  const output = "tmp/pitch-workspace-browser";
  await mkdir(output, { recursive: true });
  try {
    const context = await openWorkspaceContext(browser, app, who, 1440);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const name = "浏览器隔离办公提案";
    const dataTitle = "办公楼季度核对";
    const researchTitle = "合成市场研究";
    const editedTitle = "合成市场研究确认稿";
    const imageTitle = "选址示意图";
    const starts = [], lookups = [];
    let projectId, dropStatus = false;
    await page.route("**/api/intelligence/pitch/workspace", async route => {
      const request = route.request();
      if (request.method() !== "POST") return route.continue();
      const body = request.postDataJSON();
      if (body.action === "create") projectId = body.projectId;
      if (body.action === "status") {
        lookups.push(body.taskId);
        if (dropStatus) {
          dropStatus = false;
          return route.abort("timedout");
        }
      }
      if (body.action !== "start" || body.part?.mode !== "outline") return route.continue();
      starts.push(body);
      // For the second submission, simulate disconnecting before the server
      // receives the request. The retry may only reuse that request's ID.
      if (starts.length === 2) return route.abort("timedout");
      if (starts.length !== 1) return route.continue();
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 202);
      dropStatus = true;
      // The server accepted the request. Simulate loss of the response and
      // also of the first status response, then recover via the original ID.
      return route.abort("timedout");
    });
    const byButton = label => page.getByRole("button", { name: label, exact: true });
    try {
      await page.goto(app + "/intelligence/pitch");
      await page.getByLabel("你想制作什么？").fill("制作隔离办公选址提案，包含市场研究与一栋办公楼的正式季度数据。");
      await byButton("进入提案助手").click();
      await page.getByRole("dialog").first().waitFor();
      if (await byButton("打开项目设置").isVisible()) await byButton("打开项目设置").click();
      await page.getByLabel("Pitch 名称").fill(name);
      await page.getByText("更多项目设置（可选）", { exact: true }).click();
      await page.getByLabel("搜索楼宇").fill(buildingName);
      await byButton(buildingName).click();
      await page.getByLabel("默认季度").fill(period);
      await byButton("创建").click();
      await page.getByText("提案结构建议", { exact: true }).waitFor();
      await byButton("推荐提纲").click();
      const section = title => page.locator("li").filter({ has: page.locator(`input[aria-label="章节标题"][value="${title}"]`) }).filter({ has: page.locator(":scope > input") });
      await page.getByLabel("章节标题").first().waitFor();
      await page.getByText("尚未加入正式楼宇季度数据。", { exact: true }).waitFor();
      await section("市场研究").getByLabel("章节标题").fill(researchTitle);
      for (const title of ["公司介绍", "核心团队", "代表案例"])
        await section(title).getByRole("button", { name: "移除", exact: true }).click();
      await page.getByLabel("同时核对租金和空置率的环比、同比").check();
      await byButton("核对并加入正式数据").click();
      await page.getByRole("cell", { name: "+100%", exact: true }).waitFor();
      const rentReview = page.getByRole("table", { name: "净有效租金", exact: true });
      assert.match(await rentReview.getByRole("columnheader", { name: /环比/ }).innerText(), /^环比\n2026-Q2$/);
      assert.equal(await page.getByText("尚未加入正式楼宇季度数据。", { exact: true }).count(), 0);
      await section("目标项目概况").getByLabel("章节标题").fill(dataTitle);
      await section(dataTitle).getByRole("button", { name: "上移", exact: true }).click();
      await changeQuarter();
      const submit = byButton("确认生成 2 个板块");
      await submit.click();
      const lookup = byButton("重新查询生成进度");
      await lookup.waitFor();
      assert.ok(await submit.isDisabled());
      await lookup.click();
      await page.getByText(/楼宇数据、季度或权限已变化/).waitFor();
      assert.deepEqual(lookups.slice(0, 2), [starts[0].taskId, starts[0].taskId]);
      assert.equal(starts.length, 1);
      assert.equal((await readProject(projectId)).slides.length, 0);

      await byButton("重新核对正式数据").click();
      await page.getByRole("cell", { name: "+25%", exact: true }).waitFor();
      await submit.click();
      await lookup.waitFor();
      assert.ok(await submit.isDisabled());
      await lookup.click();
      await byButton("导出可编辑 PPTX").waitFor();
      assert.equal(starts.length, 3);
      assert.notEqual(starts[0].taskId, starts[1].taskId);
      assert.deepEqual(starts[2], starts[1]);
      const reviewed = starts[1].part;
      assert.deepEqual(reviewed.parts.map(part => part.title), [dataTitle, researchTitle]);
      assert.deepEqual(reviewed.bindings, [research]);
      assert.equal(reviewed.parts[0].parameters.period.year, 2026);
      assert.equal(reviewed.parts[0].parameters.period.quarter, 3);
      const generated = await readProject(projectId);
      await assertClientDenied(projectId);
      assert.deepEqual(reviewed.parts[0].parameters.buildingIds, generated.workspace.context.buildingIds);
      assert.deepEqual(new Set(generated.tasks.map(task => task.id)), new Set(starts.map(start => start.taskId)));
      assert.deepEqual([...new Set(generated.slides.map(slide => slide.content.title))], [dataTitle, researchTitle]);
      const editable = generated.slides.findIndex(slide => slide.content.title === researchTitle);
      await page.getByRole("button", { name: `打开第 ${editable + 1} 页：${researchTitle}`, exact: true }).click();
      await page.getByLabel("页面标题", { exact: true }).fill(editedTitle);
      await byButton("保存").click();
      await page.getByRole("status").filter({ hasText: /^已保存$/ }).first().waitFor();

      await byButton("自定义").click();
      const custom = page.getByRole("dialog", { name: "添加自定义图文" });
      await custom.getByLabel("自定义标题").fill(imageTitle);
      await custom.getByLabel("自定义正文").fill("已发布的合成测试配图，仅用于展示办公选址提案的图片对象。");
      await custom.getByLabel("配图（可选）").selectOption(image.id);
      await custom.getByRole("button", { name: "添加页面", exact: true }).click();
      await custom.waitFor({ state: "hidden" });

      await byButton("导出可编辑 PPTX").click();
      const dialog = page.getByRole("dialog");
      assert.equal(await dialog.getByLabel("文件格式").inputValue(), "pptx");
      assert.equal(await dialog.getByLabel("页面范围").inputValue(), "all");
      await dialog.getByRole("button", { name: "生成文件", exact: true }).click();
      const link = dialog.getByRole("button", { name: "下载已生成文件", exact: true });
      await link.waitFor({ timeout: 60000 });
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
      const path = `${output}/reviewed-outline.pptx`;
      await download.saveAs(path);
      await inspectOutlinePptx(path, { dataTitle, editedTitle, buildingName, researchTitle, imageTitle });
      await writeFile(`${output}/reviewed-outline.json`, JSON.stringify({
        projectId, startTaskIds: starts.map(start => start.taskId), failedLookupIds: lookups.slice(0, 2),
        chapters: [dataTitle, researchTitle], editedTitle, buildingName, period,
      }, null, 2));
    } catch (error) {
      await page.screenshot({ path: `${output}/outline-failure.png`, fullPage: true }).catch(() => {});
      console.error("Pitch outline browser failure", error.message, await page.locator("body").innerText());
      throw error;
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function inspectOutlinePptx(path, { dataTitle, editedTitle, buildingName, researchTitle, imageTitle }) {
  const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true });
  const names = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const pages = await Promise.all(names.map(name => zip.file(name).async("string")));
  assert.ok(pages[0].includes(dataTitle));
  const rent = pages.find(xml => xml.includes("+25%"));
  assert.ok(rent?.includes("<a:tbl>") && rent.includes(buildingName));
  assert.match(rent, /元[^<]*[㎡m]/);
  assert.match(rent, /<a:t>2026-Q3<\/a:t>/);
  assert.match(rent, /<a:t>2026-Q2<\/a:t>/);
  assert.match(rent, /<a:t>2025-Q3<\/a:t>/);
  assert.match(rent, /基期无有效值/);
  assert.match(rent, /<a:t>100<\/a:t>/);
  assert.match(rent, /2026-09-30/);
  assert.match(rent, /已授权正式数据库/);
  assert.match(rent, /仅限内部/);
  const vacancy = pages.find(xml => xml.includes("+2 个百分点"));
  assert.ok(vacancy?.includes("<a:tbl>") && vacancy.includes(buildingName));
  const edited = pages.findIndex(xml => xml.includes(editedTitle));
  assert.ok(edited > pages.indexOf(vacancy));
  assert.match(pages[edited], /<p:sp>[\s\S]*?<a:t>合成市场研究确认稿<\/a:t>/);
  assert.ok(!pages.slice(0, edited).some(xml => xml.includes(researchTitle)));
  assert.ok(pages.some(xml => xml.includes("<c:chart")));
  const charts = Object.keys(zip.files).filter(name => /^ppt\/charts\/chart\d+\.xml$/.test(name));
  assert.equal(charts.length, 1);
  assert.match(await zip.file(charts[0]).async("string"), /<c:lineChart>/);
  assert.ok(Object.keys(zip.files).some(name => /^ppt\/embeddings\/[^/]+\.xlsx$/.test(name)));
  const photo = pages.findIndex(xml => xml.includes(imageTitle));
  assert.ok(photo > edited);
  assert.match(pages[photo], /<p:pic>[\s\S]*?<a:blip r:embed=/);
  const png = Object.keys(zip.files).find(name => /^ppt\/media\/[^/]+\.png$/.test(name));
  assert.ok(png);
  assert.equal((await zip.file(png).async("nodebuffer")).subarray(1, 4).toString(), "PNG");
}
