import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
/** Runs against real local GoTrue/PostgREST + the production Next route. All
 * environment provider keys are deliberately empty. No test-only route hooks. */
export async function verifyPitchAi({
  app,
  db,
  owner,
  other,
  admin,
  check,
  until,
}) {
  const call = async (who, input, extra = {}) => {
    const response = await fetch(app + "/api/intelligence/pitch/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(who ? { Authorization: "Bearer " + who.token } : {}),
        ...extra,
      },
      body: JSON.stringify(input),
    });
    return { status: response.status, body: await response.json() };
  };
  let config, asset, batchId;
  await check(
    "Pitch AI real Auth denies anonymous, extra schema, cross-origin writes and ordinary admin configuration",
    async () => {
      assert.equal((await call(null, { action: "config" })).status, 401);
      assert.equal(
        (await call(owner, { action: "config", provider: "rogue" })).status,
        422,
      );
      assert.equal(
        (
          await call(
            admin,
            { action: "config" },
            { Origin: "https://untrusted.example.invalid" },
          )
        ).status,
        403,
      );
      assert.equal(
        (await call(owner, { action: "config" })).body.enabled,
        false,
      );
      const read = await call(admin, { action: "config" });
      assert.equal(read.status, 200);
      config = read.body;
      assert.equal(config.enabled, false);
      assert.equal(
        (await call(owner, { action: "config_save", config })).status,
        403,
      );
    },
  );
  await check(
    "Pitch AI after-response worker really completes deterministic source tasks and explicitly rejects disabled model tasks",
    async () => {
      const row = await db.query(
        "select a.id,a.current_version from pitch_content_assets a join pitch_asset_versions v on v.asset_id=a.id and v.version=a.current_version where a.created_by=$1 and a.imported_from_page is not null and a.state='published' and v.content->>'title' like '%案例%' limit 1",
        [owner.id],
      );
      assert.equal(row.rowCount, 1);
      asset = row.rows[0];
      batchId = randomUUID();
      const command = {
        action: "start",
        batchId,
        tasks: ["match-template", "summarize"].map((task) => ({
          task,
          assetId: asset.id,
          version: asset.current_version,
          language: "zh",
          length: "brief",
        })),
      };
      const started = await call(admin, command);
      assert.equal(started.status, 202, JSON.stringify(started.body));
      assert.ok(started.body.tasks.every((t) => t.state === "queued"));
      let result;
      await until(async () => {
        result = await call(admin, { action: "status", batchId });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        return result.body.tasks.every((t) =>
          ["completed", "failed"].includes(t.state),
        );
      }, "Pitch AI durable worker");
      assert.equal(
        result.body.tasks.find((t) => t.request.task === "match-template")
          .state,
        "completed",
      );
      assert.equal(
        result.body.tasks.find((t) => t.request.task === "summarize")
          .error_code,
        "authorization_denied",
      );
      assert.equal((await call(admin, command)).body.tasks.length, 2);
      assert.equal(
        (await call(other, { action: "status", batchId })).status,
        403,
      );
      assert.equal(
        (await db.query("select count(*) n from private.pitch_ai_attempts"))
          .rows[0].n,
        "0",
      );
    },
  );
  await check(
    "Pitch AI real configuration/version grants do not bypass empty provider secrets; old source revocation removes results",
    async () => {
      config = {
        ...config,
        enabled: true,
        enabledTasks: ["summarize"],
        default: {
          provider: "deepseek",
          model: "synthetic-http-model",
          maxTokens: 30000,
          maxOutputTokens: 1000,
          timeoutMs: 1000,
          maxUsd: 0.01,
          inputRate: 0.3,
          outputRate: 1.2,
        },
      };
      const saved = await call(admin, { action: "config_save", config });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      config = saved.body;
      const policy = {
        action: "policy_save",
        assetId: asset.id,
        version: asset.current_version,
        expectedRevision: 0,
        mode: "redacted_external",
        provider: "deepseek",
        model: "synthetic-http-model",
        approvedText: "明确隔离的安全 HTTP 测试文字。",
        reason: "仅隔离自动回归，不对真实供应商调用",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      assert.equal((await call(owner, policy)).status, 403);
      assert.equal((await call(admin, policy)).status, 200);
      const bid = randomUUID();
      assert.equal(
        (
          await call(admin, {
            action: "start",
            batchId: bid,
            tasks: [
              {
                task: "summarize",
                assetId: asset.id,
                version: asset.current_version,
                language: "zh",
                length: "brief",
              },
            ],
          })
        ).status,
        202,
      );
      let result;
      await until(async () => {
        result = await call(admin, { action: "status", batchId: bid });
        return result.body.tasks[0].state === "failed";
      }, "Pitch unconfigured provider");
      assert.equal(result.body.tasks[0].error_code, "not_configured");
      await db.query(
        "update pitch_content_assets set state='archived' where id=$1",
        [asset.id],
      );
      const hidden = await call(admin, { action: "status", batchId });
      assert.equal(hidden.status, 200);
      assert.ok(hidden.body.tasks.every((t) => t.result === null));
      await db.query(
        "update pitch_content_assets set state='published' where id=$1",
        [asset.id],
      );
      assert.equal(
        (
          await call(admin, {
            action: "config_save",
            config: { ...config, enabled: false },
          })
        ).status,
        200,
      );
    },
  );
  await check(
    "Pitch AI operations reuse measured model protocol, have scope filters and reject ordinary reader",
    async () => {
      assert.equal((await call(owner, { action: "operations" })).status, 403);
      const result = await call(admin, {
        action: "operations",
        task: "summarize",
        offset: 0,
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.ok(result.body.tasks.every((t) => t.task === "summarize"));
      assert.equal(result.body.summary.models.calls, 0);
      assert.ok(
        !JSON.stringify(result.body.tasks).includes("安全 HTTP 测试文字"),
      );
    },
  );
}
