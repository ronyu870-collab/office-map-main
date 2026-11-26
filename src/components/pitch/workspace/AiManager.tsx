"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import { ModelOperationsSummary } from "@/src/components/intelligence/audit/ModelOperationsSummary";
import {
  configSchema,
  DEFAULT_AI_CONFIG,
  TASK_LABELS,
  type AiConfig,
  type AiTask,
} from "@/src/lib/pitch/ai/protocol";
import type { ScopedModelProfile } from "@/src/lib/intelligence/agent/modelProfile";
import {
  slideContentSchema,
  type SlideContent,
} from "@/src/lib/pitch/contracts/content";
import type { Call, Catalog } from "./client";
import { RevisionReview } from "./RevisionReview";
import styles from "./workspace.module.css";
type Task = {
  id: string;
  batch_id: string;
  state: string;
  task: AiTask;
  attempts_log: unknown[];
  error_code: string | null;
  created_at: string;
  asset_id: string;
};
type Candidate = {
  id: string;
  project_version: number;
  state: string;
  content: { title: string };
  scope: Record<string, string>;
  materialized_id: string | null;
};
type Operations = {
  tasks: Task[];
  candidates: Candidate[];
  usage: {
    event: string;
    template_id: string | null;
    layout: string | null;
    count: number;
  }[];
  next: number | null;
  summary: {
    count: number;
    completed: number;
    cacheHits: number;
    queued: number;
    permissionBlocks: number;
    budgetPauses: number;
    modelLatency: { averageMs: number | null; p95Ms: number | null };
    taskCosts: {
      task: AiTask;
      count: number;
      completed: number;
      calls: number;
      estimatedUsd: number;
    }[];
  };
};
const profileDefaults: ScopedModelProfile = {
  provider: "deepseek",
  model: "",
  maxTokens: 30000,
  maxOutputTokens: 1800,
  timeoutMs: 15000,
  maxUsd: 0.05,
  inputRate: 0.3,
  outputRate: 1.2,
};
export function AiManager({ call, catalog }: { call: Call; catalog: Catalog }) {
  const [config, setConfig] = React.useState<AiConfig>(DEFAULT_AI_CONFIG),
    [ops, setOps] = React.useState<Operations | null>(null),
    [tab, setTab] = React.useState("operations"),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [offset, setOffset] = React.useState(0),
    [task, setTask] = React.useState(""),
    [model, setModel] = React.useState(""),
    [from, setFrom] = React.useState(""),
    [to, setTo] = React.useState("");
  const [asset, setAsset] = React.useState(""),
    [preview, setPreview] = React.useState<{
      id: string;
      content: SlideContent;
    } | null>(null),
    [version, setVersion] = React.useState(1),
    [policyRevision, setPolicyRevision] = React.useState(0),
    [policyMode, setPolicyMode] = React.useState("deterministic_only"),
    [provider, setProvider] = React.useState("deepseek"),
    [policyModel, setPolicyModel] = React.useState(""),
    [approvedText, setApprovedText] = React.useState(""),
    [reason, setReason] = React.useState(""),
    [days, setDays] = React.useState(7),
    [category, setCategory] = React.useState(catalog.categories[0]?.id ?? ""),
    [scopeIndex, setScopeIndex] = React.useState(0);
  const scopes = catalog.scopes.filter(
    (s) => s.canAdmin && s.region && s.city && s.businessLine,
  );
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成。");
    } finally {
      setBusy(false);
    }
  };
  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      const r = await call<Operations>(
        {
          action: "operations",
          offset,
          ...(task ? { task } : {}),
          ...(model ? { model } : {}),
          ...(from ? { from: new Date(from).toISOString() } : {}),
          ...(to ? { to: new Date(to).toISOString() } : {}),
        },
        true,
        "ai",
        signal,
      );
      if (!signal?.aborted) setOps(r);
    },
    [call, offset, task, model, from, to],
  );
  React.useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      call<AiConfig>({ action: "config" }, true, "ai", c.signal).then((r) => {
        if (!c.signal.aborted) setConfig(configSchema.parse(r));
      }),
      Promise.resolve().then(() => load(c.signal)),
    ]).catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, [call, load]);
  const setNumber = (
    key:
      | "maxInputBytes"
      | "retries"
      | "concurrency"
      | "batchUsd"
      | "dailyUsd"
      | "monthlyUsd",
    value: string,
  ) => setConfig((c) => ({ ...c, [key]: Number(value) }));
  return (
    <section className={styles.content} aria-label="Pitch AI 管理">
      <nav className={styles.modeTabs} aria-label="辅助能力管理">
        {[
          ["operations", "任务与成本"],
          ["config", "模型设置"],
          ["policy", "资料处理授权"],
          ["candidates", "候选与反馈"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === "config" && (
        <div className={styles.form}>
          <h2>模型与预算</h2>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig((c) => ({ ...c, enabled: e.target.checked }))
              }
            />
            启用已获独立资料授权的模型任务
          </label>
          {(["default", "extraction", "analysis"] as const).map((slot) => (
            <details key={slot}>
              <summary>
                {
                  {
                    default: "默认模型",
                    extraction: "分类及提取模型",
                    analysis: "分析及表达模型",
                  }[slot]
                }
              </summary>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={!!config[slot]}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      [slot]: e.target.checked ? profileDefaults : null,
                    }))
                  }
                />
                配置此模型
              </label>
              {config[slot] && (
                <div className={styles.form}>
                  <label>
                    供应商
                    <select
                      value={config[slot]!.provider}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          [slot]: { ...c[slot]!, provider: e.target.value },
                        }))
                      }
                    >
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </label>
                  <label>
                    模型名称
                    <input
                      value={config[slot]!.model}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          [slot]: { ...c[slot]!, model: e.target.value },
                        }))
                      }
                    />
                  </label>
                  {(
                    [
                      ["maxTokens", "输入与输出总 Token 上限"],
                      ["maxOutputTokens", "输出 Token 上限"],
                      ["timeoutMs", "超时（毫秒）"],
                      ["maxUsd", "单任务美元预算"],
                      ["inputRate", "输入每百万 Token 美元上界"],
                      ["outputRate", "输出每百万 Token 美元上界"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={config[slot]![key]}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            [slot]: {
                              ...c[slot]!,
                              [key]: Number(e.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </details>
          ))}
          <fieldset>
            <legend>允许的任务</legend>
            {Object.entries(TASK_LABELS).map(([id, label]) => (
              <label key={id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={config.enabledTasks.includes(id as AiTask)}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      enabledTasks: e.target.checked
                        ? [...c.enabledTasks, id as AiTask]
                        : c.enabledTasks.filter((t) => t !== id),
                    }))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          {(
            [
              ["maxInputBytes", "单页资料 UTF-8 字节上限"],
              ["retries", "手动重试上限（0—2）"],
              ["concurrency", "同时处理数（1—3）"],
              ["batchUsd", "每批美元预算"],
              ["dailyUsd", "每日美元预算"],
              ["monthlyUsd", "每月美元预算"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step="any"
                value={config[key]}
                onChange={(e) => setNumber(key, e.target.value)}
              />
            </label>
          ))}
          <p>
            当前仅支持文本；视觉、OCR、Embedding
            和供应商自动降级未开放。密钥继续使用原服务端配置。
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const parsed = configSchema.parse(config);
                setConfig(
                  await call<AiConfig>(
                    { action: "config_save", config: parsed },
                    true,
                    "ai",
                  ),
                );
                setError("设置已保存。");
              })
            }
          >
            保存设置
          </Button>
        </div>
      )}
      {tab === "policy" && (
        <div className={styles.form}>
          <h2>指定素材版本的处理范围</h2>
          <label>
            素材 ID
            <input
              value={asset}
              onChange={(e) => {
                setAsset(e.target.value);
                setPolicyRevision(0);
                setApprovedText("");
              }}
            />
          </label>
          <label>
            素材版本
            <input
              type="number"
              min={1}
              value={version}
              onChange={(e) => {
                setVersion(Number(e.target.value));
                setApprovedText("");
                setPolicyRevision(0);
              }}
            />
          </label>
          <Button
            variant="secondary"
            disabled={busy || !asset}
            onClick={() =>
              void perform(async () => {
                const rows = await call<
                  {
                    asset_version: number;
                    revision: number;
                    mode: string;
                    provider: string | null;
                    model: string | null;
                    approved_text: string;
                  }[]
                >({ action: "policies", assetId: asset }, true, "ai");
                const r = rows.find((p) => p.asset_version === version);
                setPolicyRevision(r?.revision ?? 0);
                setPolicyMode(r?.mode ?? "deterministic_only");
                setProvider(r?.provider ?? "deepseek");
                setPolicyModel(r?.model ?? "");
                setApprovedText(r?.approved_text ?? "");
              })
            }
          >
            读取当前授权
          </Button>
          <label>
            处理方式
            <select
              value={policyMode}
              onChange={(e) => {
                setPolicyMode(e.target.value);
                setApprovedText("");
              }}
            >
              <option value="deterministic_only">仅内部确定性处理</option>
              <option value="controlled_internal_ai">
                仅受控内部 AI（当前未配置执行器）
              </option>
              <option value="redacted_external">仅已核对的脱敏文字</option>
              <option value="approved_provider">
                指定供应商与模型（还需原外传资格）
              </option>
            </select>
          </label>
          {["redacted_external", "approved_provider"].includes(policyMode) && (
            <>
              <label>
                供应商
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label>
                批准的模型
                <input
                  value={policyModel}
                  onChange={(e) => setPolicyModel(e.target.value)}
                />
              </label>
            </>
          )}
          {policyMode === "redacted_external" && (
            <label>
              已逐项核对、允许发送的文字
              <textarea
                rows={8}
                maxLength={24000}
                value={approvedText}
                onChange={(e) => setApprovedText(e.target.value)}
              />
            </label>
          )}
          <label>
            授权依据
            <input
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label>
            有效天数（最多 90）
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <Button
            disabled={busy || !asset || !reason}
            onClick={() =>
              void perform(async () => {
                await call(
                  {
                    action: "policy_save",
                    assetId: asset,
                    version,
                    expectedRevision: policyRevision,
                    mode: policyMode,
                    provider: [
                      "redacted_external",
                      "approved_provider",
                    ].includes(policyMode)
                      ? provider
                      : null,
                    model: ["redacted_external", "approved_provider"].includes(
                      policyMode,
                    )
                      ? policyModel
                      : null,
                    approvedText,
                    reason,
                    expiresAt: new Date(
                      Date.now() + days * 86400000,
                    ).toISOString(),
                  },
                  true,
                  "ai",
                );
                setPolicyRevision((v) => v + 1);
                setError("此版本的处理授权已保存；旧结果不会跨策略复用。");
              })
            }
          >
            保存此版本授权
          </Button>
        </div>
      )}
      {tab === "operations" && ops && (
        <>
          <div className={styles.form}>
            <label>
              任务
              <select
                value={task}
                onChange={(e) => {
                  setTask(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部</option>
                {Object.entries(TASK_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <input
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              开始时间
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
          </div>
          <p>
            本页 {ops.summary.count} 项 · 完成 {ops.summary.completed} ·
            缓存命中 {ops.summary.cacheHits} · 待处理 {ops.summary.queued} ·
            授权拦截 {ops.summary.permissionBlocks}
            {" · "}预算暂停 {ops.summary.budgetPauses}
          </p>
          <p>
            模型平均耗时{" "}
            {ops.summary.modelLatency.averageMs === null
              ? "—"
              : (ops.summary.modelLatency.averageMs / 1000).toFixed(1) +
                " 秒"}{" "}
            · P95{" "}
            {ops.summary.modelLatency.p95Ms === null
              ? "—"
              : (ops.summary.modelLatency.p95Ms / 1000).toFixed(1) + " 秒"}
            ；统计仅涵盖本页任务。
          </p>
          <ModelOperationsSummary
            documents={ops.tasks
              .slice(0, 100)
              .flatMap((t) =>
                t.attempts_log.map((record) => ({ content: record })),
              )}
            label="Pitch 任务当前筛选的有界样本"
          />
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>处理类型</th>
                  <th>完成 / 总数</th>
                  <th>模型调用</th>
                  <th>估算美元</th>
                </tr>
              </thead>
              <tbody>
                {ops.summary.taskCosts.map((row) => (
                  <tr key={row.task}>
                    <td>{TASK_LABELS[row.task]}</td>
                    <td>
                      {row.completed} / {row.count}
                    </td>
                    <td>{row.calls}</td>
                    <td>{row.estimatedUsd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ops.tasks.slice(0, 100).map((t) => (
                  <tr key={t.id}>
                    <td>{TASK_LABELS[t.task]}</td>
                    <td>
                      {t.state}
                      {t.error_code ? " · " + t.error_code : ""}
                    </td>
                    <td>{new Date(t.created_at).toLocaleString("zh-CN")}</td>
                    <td>
                      {[
                        "queued",
                        "paused",
                        "failed",
                        "cancelled",
                        "processing",
                      ].includes(t.state) && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await call(
                                { action: "resume", batchId: t.batch_id },
                                true,
                                "ai",
                              );
                              await load();
                            })
                          }
                        >
                          恢复本人任务
                        </Button>
                      )}
                      {t.state === "completed" && t.task === "revise-text" && (
                        <RevisionReview call={call} taskId={t.id} disabled={busy}
                          destination={category && scopes[scopeIndex] ? {
                            categoryId: category,
                            scope: { organizationId: scopes[scopeIndex].organizationId,
                              region: scopes[scopeIndex].region!, city: scopes[scopeIndex].city!,
                              businessLine: scopes[scopeIndex].businessLine! },
                          } : undefined} />
                      )}
                      {t.state === "completed" && t.task !== "revise-text" && (
                        <Button
                          variant="ghost"
                          disabled={busy || !scopes.length}
                          onClick={() =>
                            void perform(async () => {
                              const s = scopes[scopeIndex];
                              await call(
                                {
                                  action: "materialize",
                                  taskId: t.id,
                                  assetId: crypto.randomUUID(),
                                  categoryId: category,
                                  scope: {
                                    organizationId: s.organizationId,
                                    region: s.region,
                                    city: s.city,
                                    businessLine: s.businessLine,
                                  },
                                },
                                true,
                                "ai",
                              );
                              setError(
                                "已保存为私有草稿，请在素材库核对并发布。",
                              );
                            })
                          }
                        >
                          形成待核对资产
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!offset || busy}
              onClick={() => setOffset((v) => Math.max(0, v - 100))}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              disabled={ops.next === null || busy}
              onClick={() => setOffset(ops.next!)}
            >
              下一页
            </Button>
            <Button
              variant="secondary"
              onClick={() => void perform(() => load())}
            >
              刷新
            </Button>
          </div>
        </>
      )}
      {(tab === "operations" || tab === "candidates") && (
        <div className={styles.form}>
          <label>
            候选资产分类
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {catalog.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.names.zh ?? c.names.en}
                </option>
              ))}
            </select>
          </label>
          <label>
            适用范围
            <select
              value={scopeIndex}
              onChange={(e) => setScopeIndex(Number(e.target.value))}
            >
              {scopes.map((s, i) => (
                <option key={i} value={i}>
                  {s.region} · {s.city} · {s.businessLine}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {tab === "candidates" && ops && (
        <>
          <h2>用户主动提交的候选页面</h2>
          <ul className={styles.rows}>
            {ops.candidates.map((c) => (
              <li key={c.id} style={{ display: "block" }}>
                <span>
                  {c.content.title} · 来源项目版本 {c.project_version} ·{" "}
                  {c.state}
                </span>
                <div className={styles.actions}>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        setPreview(null);
                        const result = await call<{ content: unknown }>(
                          { action: "candidate_preview", candidateId: c.id },
                          true,
                          "ai",
                        );
                        setPreview({
                          id: c.id,
                          content: slideContentSchema.parse(result.content),
                        });
                      })
                    }
                  >
                    查看待核对内容
                  </Button>
                  {["accepted", "rejected", "withdrawn"].map((state) => (
                    <Button
                      key={state}
                      variant="ghost"
                      disabled={busy || c.state === state}
                      onClick={() =>
                        void perform(async () => {
                          await call(
                            {
                              action: "candidate_review",
                              candidateId: c.id,
                              state,
                            },
                            true,
                            "ai",
                          );
                          await load();
                        })
                      }
                    >
                      {
                        {
                          accepted: "确认候选",
                          rejected: "不采用",
                          withdrawn: "撤回",
                        }[state]
                      }
                    </Button>
                  ))}
                  {c.state === "accepted" && !c.materialized_id && (
                    <Button
                      disabled={busy || !scopes.length}
                      onClick={() =>
                        void perform(async () => {
                          await call(
                            {
                              action: "candidate_materialize",
                              candidateId: c.id,
                              assetId: crypto.randomUUID(),
                              categoryId: category,
                              scope: c.scope,
                            },
                            true,
                            "ai",
                          );
                          await load();
                          setError(
                            "已形成私有草稿，需素材库正式发布后才会共享。",
                          );
                        })
                      }
                    >
                      保存为素材草稿
                    </Button>
                  )}
                </div>
                {preview?.id === c.id && (
                  <CandidateContent content={preview.content} />
                )}
              </li>
            ))}
          </ul>
          <h2>近 30 天使用与匹配反馈</h2>
          <ul className={styles.rows}>
            {ops.usage.map((r, i) => (
              <li key={i}>
                <span>
                  {r.template_id ?? r.layout ?? "素材与操作"} · {r.event}
                </span>
                <span>{r.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CandidateContent({ content }: { content: SlideContent }) {
  const table = (columns: string[], rows: (string | number | null)[][]) => (
    <div className={styles.tableScroll}>
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className={styles.form} aria-label="候选页面内容">
      <h3>{content.title}</h3>
      {content.subtitle && <p>{content.subtitle}</p>}
      {content.blocks.map((b, i) => (
        <div key={i}>
          {b.kind === "paragraph" ? (
            <p style={{ whiteSpace: "pre-wrap" }}>{b.text}</p>
          ) : b.kind === "table" ? (
            table(b.columns, b.rows)
          ) : b.kind === "chart" ? (
            table(
              [
                "分类",
                ...b.series.map(
                  (s) => s.name + (s.unit ? `（${s.unit}）` : ""),
                ),
              ],
              b.categories.map((c, j) => [
                c,
                ...b.series.map((s) => s.values[j]),
              ]),
            )
          ) : b.kind === "metric" ? (
            <p>
              {b.label}：{b.value ?? "—"} {b.unit}
              {b.yoy !== undefined ? `；同比 ${b.yoy ?? "—"}` : ""}
              {b.qoq !== undefined ? `；环比 ${b.qoq ?? "—"}` : ""}
            </p>
          ) : b.kind === "team" ? (
            b.members.map((m, j) => (
              <p key={j}>
                {m.name} · {m.title}
                <br />
                {m.biography}
              </p>
            ))
          ) : b.kind === "case" ? (
            <p>
              {b.title}
              <br />
              挑战：{b.challenge}
              <br />
              策略：{b.approach}
              <br />
              成果：{b.outcome}
            </p>
          ) : b.kind === "timeline" ? (
            b.entries.map((e, j) => (
              <p key={j}>
                {e.date} · {e.title}
                <br />
                {e.description}
              </p>
            ))
          ) : b.kind === "insight" ? (
            <p>
              {b.claim}
              <br />
              {b.basis}
              <br />
              {b.limitations.join("；")}
            </p>
          ) : b.kind === "image" ? (
            <p>图片：{b.alt}（媒体仍按原权限在素材库核对）</p>
          ) : b.kind === "map" ? (
            table(
              ["地图点位", "经度", "纬度"],
              (b.points ?? []).map((p) => [p.label, p.longitude, p.latitude]),
            )
          ) : null}
        </div>
      ))}
      <p>资料日期：{content.dataAsOf}</p>
      {content.sources.map((s) => (
        <p key={s.id}>
          {s.label} · {s.locator} · {s.dataAsOf}
        </p>
      ))}
    </div>
  );
}
