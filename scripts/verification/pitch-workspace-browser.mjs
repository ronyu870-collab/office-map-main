// Optional implementation layout check against actual local Auth/Next/Pitch APIs.
// No API scene, project, generation or export response is mocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

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
        assert.ok(planHttp.ok(), `proposal_plan HTTP ${planHttp.status()}`);
        const plan = await planHttp.json();
        assert.equal(plan.status, "ready", plan.code ?? plan.message);
        assert.equal(plan.brief.scenario, scenario.scenario);
        assert.equal(plan.brief.period, period);
        assert.equal(plan.brief.buildingIds.length, scenario.buildings);
        const pageKinds = new Set(plan.plan.slides.map((slide) => slide.pageKind));
        const visualKinds = new Set(plan.plan.slides.flatMap((slide) => slide.visuals ?? []).map((visual) => visual.kind));
        result.missingPages = scenario.pages.filter((kind) => !pageKinds.has(kind));
        result.missingVisuals = (requiredVisuals[scenario.scenario] ?? []).filter((kind) => !visualKinds.has(kind));

        result.stage = "generating";
        const generationEndpoint = "/api/intelligence/pitch/ai";
        let action = button("确认并生成 Pitch");
        let receipt;
        for (let attempt = 0; attempt < 30; attempt++) {
          const [reply] = await Promise.all([
            waitForPitchCommand(page, generationEndpoint, "proposal_generate"),
            action.click(),
          ]);
          assert.ok(reply.ok(), `proposal_generate HTTP ${reply.status()}`);
          receipt = await reply.json();
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
        await button("导出").click();
        const exportDialog = page.getByRole("dialog", { name: "导出 Pitch" });
        await exportDialog.getByRole("button", { name: "生成文件" }).click();
        const downloadButton = exportDialog.getByRole("button", { name: "下载已生成文件" });
        await downloadButton.waitFor({ timeout: 60_000 });
        const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
        assert.match(download.suggestedFilename(), /\.pptx$/i);
        const archive = await JSZip.loadAsync(await readFile(await download.path()), { checkCRC32: true });
        const names = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
        assert.equal(names.length, reopened.slides.length);
        const first = await archive.file("ppt/slides/slide1.xml").async("string");
        assert.ok(first.includes(editedTitle), "export omitted the saved title");
        assert.match(first, /<p:sp>/);
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
    await browser.close();
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
