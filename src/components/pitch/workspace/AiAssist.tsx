"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import {
  TASK_LABELS,
  type AiTask,
  type Understanding,
} from "@/src/lib/pitch/ai/protocol";
import type { Generation } from "@/src/lib/pitch/business/protocol";
import type { PreparedPitch } from "@/src/lib/pitch/ai/routing";
import type { Call } from "./client";
import styles from "./workspace.module.css";
type Asset = {
  id: string;
  version: number;
  title: string;
  kind: string;
  templateId: string;
  reasons: string[];
};
type Section = { id: string; title: string; part: Generation["parts"][number] };
type Task = {
  id: string;
  state: string;
  request: { task: AiTask };
  result: Understanding | null;
  error_code: string | null;
  authorized: boolean;
};
const stateLabel: Record<string, string> = {
  queued: "等待处理",
  processing: "正在整理",
  completed: "已完成",
  failed: "未完成",
  paused: "已暂停",
  cancelled: "已取消",
};
export function AiAssist({
  call,
  initialQuestion = "",
  projectId,
  buildingIds,
  period,
  language,
  admin,
  busy,
  onGenerate,
  onReload,
  onExport,
}: {
  call: Call;
  initialQuestion?: string;
  projectId: string;
  buildingIds: string[];
  period: string;
  language: "zh" | "en";
  admin: boolean;
  busy: boolean;
  onGenerate: (part: Generation["parts"][number]) => Promise<void>;
  onReload: () => Promise<void>;
  onExport: () => void;
}) {
  const [question, setQuestion] = React.useState(initialQuestion),
    [plan, setPlan] = React.useState<PreparedPitch | null>(null),
    [q, setQ] = React.useState(""),
    [kind, setKind] = React.useState("case"),
    [items, setItems] = React.useState<Asset[]>([]),
    [selected, setSelected] = React.useState<string[]>([]),
    [error, setError] = React.useState(""),
    [working, setWorking] = React.useState(false),
    [taskType, setTaskType] = React.useState<AiTask>("summarize"),
    [taskLanguage, setTaskLanguage] = React.useState(language),
    [batch, setBatch] = React.useState(""),
    [tasks, setTasks] = React.useState<Task[]>([]),
    [sections, setSections] = React.useState<Section[]>([]),
    [pollFailed, setPollFailed] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setWorking(true);
    setError("");
    try {
      await work(c.signal);
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "操作未完成。");
    } finally {
      if (!c.signal.aborted) setWorking(false);
    }
  };
  const feedback = async (
    event: string,
    assetId?: string,
    templateId?: string,
  ) => {
    await call(
      {
        action: "feedback",
        eventId: crypto.randomUUID(),
        event,
        assetId,
        templateId,
        projectId,
      },
      true,
      "ai",
    );
  };
  React.useEffect(() => {
    if (
      !batch ||
      pollFailed ||
      !tasks.some((t) => ["queued", "processing"].includes(t.state))
    )
      return;
    const c = new AbortController(),
      timer = setTimeout(() => {
        void call<{ tasks: Task[] }>(
          { action: "status", batchId: batch },
          true,
          "ai",
          c.signal,
        )
          .then((r) => {
            if (!c.signal.aborted) setTasks(r.tasks);
          })
          .catch((e) => {
            if (!c.signal.aborted) {
              setError(e.message);
              setPollFailed(true);
            }
          });
      }, 1200);
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [batch, tasks, call, pollFailed]);
  const choose = (id: string) => {
    const ignored = selected.includes(id);
    setSelected((s) =>
      s.includes(id) ? s.filter((v) => v !== id) : [...s, id].slice(-10),
    );
    void feedback(
      ignored ? "ignored" : "selected",
      id,
      items.find((a) => a.id === id)?.templateId,
    ).catch((e) => setError(e instanceof Error ? e.message : "反馈未保存。"));
  };
  const search = (overrideKind = kind) =>
    perform(async (signal) => {
      const r = await call<{ items: Asset[] }>(
        {
          action: "recommend",
          query: { q, kind: overrideKind, language, limit: 10 },
        },
        true,
        "ai",
        signal,
      );
      setItems(r.items);
      setSelected([]);
    });
  const generateOutline = () =>
    perform(async (signal) => {
      // Confirmation is this explicit button. Every step uses the existing durable
      // workspace executor and current optimistic version; failures preserve prior pages.
      for (const section of sections.slice(0, 8)) {
        signal.throwIfAborted();
        const current = await call<{ project: { version: number } }>(
            { action: "get", projectId },
            true,
            "workspace",
            signal,
          ),
          taskId = crypto.randomUUID();
        await call(
          {
            action: "start",
            projectId,
            taskId,
            expectedVersion: current.project.version,
            part: { ...section.part, title: section.title },
            replaceIds: [],
          },
          true,
          "workspace",
          signal,
        );
        let done = false;
        for (let attempt = 0; attempt < 75; attempt++) {
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            };
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, 800);
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          });
          const receipt = await call<{ state: string }>(
            { action: "status", projectId, taskId },
            true,
            "workspace",
            signal,
          );
          if (receipt.state === "completed") {
            done = true;
            break;
          }
          if (["failed", "cancelled"].includes(receipt.state))
            throw new Error("本页未完成，已生成页面保留。");
        }
        if (!done)
          throw new Error("任务尚未完成，请在当前项目任务记录中继续查看。");
        await feedback(
          "accepted",
          undefined,
          section.part.mode === "dynamic"
            ? section.part.parameters.templateId
            : section.part.templateId,
        );
      }
      await onReload();
      setSections([]);
    });
  return (
    <div className={styles.form} aria-label="Pitch 辅助">
      <h2>快速配置</h2>
      <label>
        需要制作什么页面？
        <textarea
          rows={3}
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="生成燕莎空置率趋势页面"
        />
      </label>
      <Button
        disabled={working || busy || !question.trim()}
        onClick={() =>
          void perform(async (signal) => {
            setPlan(
              await call<PreparedPitch>(
                {
                  action: "prepare",
                  input: {
                    question,
                    projectId,
                    buildingIds,
                    assetIds: selected,
                    language,
                    ...(period ? { period } : {}),
                  },
                },
                true,
                "ai",
                signal,
              ),
            );
          })
        }
      >
        识别页面需求
      </Button>
      {plan && (
        <div role="status">
          {plan.status === "ready" ? (
            <>
              <p>{plan.explanation}</p>
              <Button
                disabled={busy || working}
                onClick={() =>
                  void perform(async () => {
                    await onGenerate(plan.part);
                    await feedback(
                      "accepted",
                      undefined,
                      plan.part.mode === "dynamic"
                        ? plan.part.parameters.templateId
                        : plan.part.templateId,
                    );
                    setPlan(null);
                  })
                }
              >
                生成这一页
              </Button>
            </>
          ) : plan.status === "recommend" ? (
            <Button
              disabled={working}
              onClick={() => {
                setKind("case");
                void search("case");
              }}
            >
              查看案例推荐
            </Button>
          ) : (
            <p>{plan.message}</p>
          )}
          {plan?.status === "edit" && plan.operation === "export" && (
            <Button onClick={onExport}>打开导出</Button>
          )}
          {admin &&
            plan.status === "edit" &&
            ["english", "shorten"].includes(plan.operation) && (
              <Button
                onClick={() => {
                  setTaskType("revise-text");
                  setTaskLanguage(
                    plan.operation === "english" ? "en" : language,
                  );
                  setError(
                    "已选择文字修订，请选择原素材，在下方展开辅助理解并开始整理。",
                  );
                }}
              >
                配置文字修订
              </Button>
            )}
        </div>
      )}
      <h2>查找与组合素材</h2>
      <label>
        资料类型
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setItems([]);
            setSelected([]);
          }}
        >
          {[
            ["corporate", "公司介绍"],
            ["team", "团队成员"],
            ["case", "案例"],
            ["research", "市场研究"],
            ["custom", "其他素材"],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        关键词
        <input
          value={q}
          maxLength={120}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <Button
        variant="secondary"
        disabled={working}
        onClick={() => void search()}
      >
        查找适用素材
      </Button>
      <ul className={styles.rows}>
        {items.map((a) => (
          <li key={a.id}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                onChange={() => choose(a.id)}
              />
              <span>
                {a.title}
                <br />
                {a.reasons.join(" · ")}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!!selected.length && (
        <Button
          disabled={working || busy}
          onClick={() =>
            void perform(async () => {
              const first = items.find((a) => a.id === selected[0])!;
              await onGenerate({
                mode: selected.length === 1 ? "static" : "semi-dynamic",
                templateId: first.templateId,
                assetIds: selected,
                length: "brief",
                allowFallback: false,
                variant: "standard",
              });
              await feedback("accepted", first.id, first.templateId);
            })
          }
        >
          用所选素材生成
        </Button>
      )}
      <details>
        <summary>提案结构建议</summary>
        <Button
          disabled={working}
          variant="secondary"
          onClick={() =>
            void perform(async (signal) => {
              const r = await call<{ sections: Section[] }>(
                { action: "outline", query: { q, language, limit: 5 } },
                true,
                "ai",
                signal,
              );
              setSections(r.sections);
              if (!r.sections.length)
                setError("没有满足条件的正式素材，请先选择或维护素材。");
            })
          }
        >
          推荐提纲
        </Button>
        <ol>
          {sections.map((s, i) => (
            <li key={s.id}>
              <input
                aria-label="章节标题"
                value={s.title}
                onChange={(e) =>
                  setSections((v) =>
                    v.map((x) =>
                      x.id === s.id ? { ...x, title: e.target.value } : x,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                disabled={!i}
                onClick={() =>
                  setSections((v) => {
                    const next = [...v];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    return next;
                  })
                }
              >
                上移
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  setSections((v) => v.filter((x) => x.id !== s.id))
                }
              >
                移除
              </Button>
              {!!selected.length && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setSections((v) =>
                      v.map((x) =>
                        x.id === s.id && x.part.mode !== "dynamic"
                          ? {
                              ...x,
                              part: {
                                ...x.part,
                                mode:
                                  selected.length === 1
                                    ? "static"
                                    : "semi-dynamic",
                                assetIds: selected,
                              },
                            }
                          : x,
                      ),
                    )
                  }
                >
                  替换为所选素材
                </Button>
              )}
            </li>
          ))}
        </ol>
        {!!sections.length && (
          <Button
            disabled={working || busy}
            onClick={() => void generateOutline()}
          >
            确认生成 {Math.min(8, sections.length)} 个板块
          </Button>
        )}
      </details>
      {admin && (
        <details>
          <summary>辅助理解所选资料</summary>
          <label>
            整理方式
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as AiTask)}
            >
              {Object.entries(TASK_LABELS)
                .filter(
                  ([v]) =>
                    ![
                      "semantic-search",
                      "recommend-cases",
                      "natural-language",
                      "suggest-outline",
                    ].includes(v),
                )
                .map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
            </select>
          </label>
          <label>
            输出语言
            <select
              value={taskLanguage}
              onChange={(e) => setTaskLanguage(e.target.value as "zh" | "en")}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <p>需要模型的整理受独立资料授权约束；结果需核对后采用。</p>
          <Button
            disabled={working || !selected.length}
            onClick={() =>
              void perform(async (signal) => {
                const batchId = crypto.randomUUID(),
                  r = await call<{ tasks: Task[] }>(
                    {
                      action: "start",
                      batchId,
                      tasks: selected.map((id) => ({
                        assetId: id,
                        version: items.find((a) => a.id === id)!.version,
                        task: taskType,
                        language: taskLanguage,
                        length: "brief",
                      })),
                    },
                    true,
                    "ai",
                    signal,
                  );
                setBatch(batchId);
                setTasks(r.tasks);
                setPollFailed(false);
              })
            }
          >
            开始整理
          </Button>
          {!!batch && (
            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() =>
                  void perform(async (signal) => {
                    await call(
                      { action: "cancel", batchId: batch },
                      true,
                      "ai",
                      signal,
                    );
                    const r = await call<{ tasks: Task[] }>(
                      { action: "status", batchId: batch },
                      true,
                      "ai",
                      signal,
                    );
                    setTasks(r.tasks);
                  })
                }
              >
                取消未完成任务
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void perform(async (signal) => {
                    const r = await call<{ tasks: Task[] }>(
                      {
                        action: pollFailed ? "status" : "resume",
                        batchId: batch,
                      },
                      true,
                      "ai",
                      signal,
                    );
                    setTasks(r.tasks);
                    setPollFailed(false);
                  })
                }
              >
                刷新或恢复
              </Button>
            </div>
          )}
          {tasks.map((t) => (
            <div key={t.id}>
              <p>
                {TASK_LABELS[t.request.task]} · {stateLabel[t.state]}
                {!t.authorized ? " · 资料权限已变化" : ""}
                {t.error_code
                  ? " · " +
                    (t.error_code === "budget_exceeded"
                      ? "预算不足，已暂停"
                      : t.error_code === "authorization_denied"
                        ? "未获模型处理授权"
                        : "未通过处理校验")
                  : ""}
              </p>
              {t.result && (
                <>
                  <p>{t.result.purpose}</p>
                  {t.result.revisions.map((r, i) => (
                    <p key={"revision:" + i}>{r.text}</p>
                  ))}
                  {t.result.summaries.map((s, i) => (
                    <p key={i}>{s.text}</p>
                  ))}
                  <p>
                    待核对 ·{" "}
                    {t.result.temporal === "historical"
                      ? "历史资料"
                      : "时效尚未确认"}
                  </p>
                </>
              )}
            </div>
          ))}
        </details>
      )}
      {working && (
        <Button
          variant="secondary"
          onClick={() => {
            controller.current?.abort();
            setWorking(false);
            setError(
              "已停止后续操作；服务端已领取的页面任务可在项目任务记录中查看。",
            );
          }}
        >
          停止后续操作
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
