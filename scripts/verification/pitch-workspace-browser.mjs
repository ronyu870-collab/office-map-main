// Optional implementation layout check against actual local Auth/Next/Pitch APIs.
// No API scene, project, generation or export response is mocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
export async function verifyPitchWorkspaceBrowser({
  app,
  who,
  projectTitle,
  projectId,
}) {
  assert.equal(new URL(app).hostname, "127.0.0.1");
  const { chromium } = createRequire(import.meta.url)(
    process.env.PERF_PLAYWRIGHT_MODULE || "playwright-core",
  );
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PERF_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: "chrome" }),
  });
  const { data } = await who.client.auth.getSession(),
    session = data.session;
  assert.ok(session);
  const payload = JSON.parse(
    Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
  );
  const observations = [];
  await mkdir("tmp/pitch-workspace-browser", { recursive: true });
  try {
    for (const width of [1440, 390, 320]) {
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
          await page
            .getByRole("tab", { name: "页面编辑", exact: true })
            .click();
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
