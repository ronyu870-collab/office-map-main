"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import {
  TASK_LABELS,
  type AiTask,
  type Understanding,
} from "@/src/lib/pitch/ai/protocol";
import type { Generation } from "@/src/lib/pitch/business/protocol";
import { outlineBuildingIds, outlineQuarter, outlinePartSchema, type OutlinePart, type WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import type { PreparedPitch } from "@/src/lib/pitch/ai/routing";
import type { Call } from "./client";
import { ProposalRevision } from "./ProposalRevision";
import { ProposalPreview } from "./ProposalPreview";
import { RevisionReview, type RevisionDestination, type CanvasRevisionTarget } from "./RevisionReview";
import styles from "./workspace.module.css";
type Asset = {
  id: string;
  version: number;
  title: string;
  kind: string;
  templateId: string;
  reasons: string[];
};
type Material = { id: string; version: number; title: string };
type DataReview = {
  fingerprint: string;
  comparisons?: { metric: string; note: string; columns: string[]; rows: string[][] }[];
  buildings: { id: string; name: string; facts: { label: string; value: string }[] }[];
  parameters: Extract<Generation["parts"][number], { mode: "dynamic" }>["parameters"];
};
type Section = { id: string; title: string; part: Generation["parts"][number]; materials: Material[]; review?: DataReview };
type Task = {
  id: string;
  asset_id?: string;
  asset_version?: number;
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
  autoPlan = false,
  city,
  projectVersion,
  onProposalGenerated,
  revision,
  projectId,
  buildingIds,
  period,
  language,
  admin,
  busy,
  onGenerate,
  onGenerateOutline,
  outlineCanResubmit,
  revisionDestination,
  canvasTarget,
  onCanvasSaved,
  onExport,
}: {
  call: Call;
  initialQuestion?: string;
  autoPlan?: boolean;
  city?: string;
  projectVersion?: number;
  onProposalGenerated?: (id: string) => Promise<void>;
  revision?: {
    detail: WorkspaceDetail;
    active?: string;
    selected: string[];
    objectIds: string[];
    disabled: boolean;
    onApplied: (result: WorkspaceDetail, expectedVersion: number) => void;
    onOpenData: () => void;
  };
  projectId: string;
  buildingIds: string[];
  period: string;
  language: "zh" | "en";
  admin: boolean;
  busy: boolean;
  onGenerate: (part: Generation["parts"][number]) => Promise<void>;
  onGenerateOutline: (outline: OutlinePart) => Promise<void>;
  outlineCanResubmit?: boolean;
  revisionDestination?: RevisionDestination;
  canvasTarget?: CanvasRevisionTarget & { assetId: string; assetVersion: number };
  onCanvasSaved?: (result: unknown) => void;
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
    [outlineMissing, setOutlineMissing] = React.useState<string[] | null>(null),
    [compareQuarters, setCompareQuarters] = React.useState(false),
    [submitted, setOutlineSent] = React.useState(false),
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
  const outlineSent = submitted && !outlineCanResubmit;
  const dataReview = sections.find(section => section.review)?.review;
  const reviewMatches = !dataReview || (
    Boolean(dataReview.comparisons?.length) === compareQuarters &&
    period === dataReview.parameters.period.year + "-Q" + dataReview.parameters.period.quarter &&
    buildingIds.length === dataReview.buildings.length &&
    buildingIds.every(id => dataReview.buildings.some(building => building.id === id))
  );
  const reviewData = () => perform(async (signal) => {
    const review = await call<DataReview>(
      { action: "review_outline_data", projectId, buildingIds, period, ...(compareQuarters ? { compareQuarters: true } : {}) }, true, "workspace", signal,
    );
    if (signal.aborted) return;
    const title = buildingIds.length === 1
      ? (language === "en" ? "Building profile" : "目标项目概况")
      : (language === "en" ? "Building comparison" : "所选项目横向对比");
    const next: Section = { id: "reviewed-building-data", title, materials: [], review,
      part: { mode: "dynamic", parameters: review.parameters } };
    setSections(previous => {
      const existing = previous.findIndex(section => section.id === next.id);
      if (existing < 0) return [...previous, next];
      return previous.map((section, i) => i === existing ? { ...next, title: section.title } : section);
    });
    setOutlineSent(false);
  });
  const generateOutline = () =>
    perform(async () => {
      if (!reviewMatches) throw new Error("关联楼宇或季度已变化，请重新核对正式数据。");
      const pinned = new Map<string, number>();
      for (const section of sections) for (const source of section.materials ?? []) {
        const prior = pinned.get(source.id);
        if (prior !== undefined && prior !== source.version)
          throw new Error("素材版本已变化，请重新推荐提纲。");
        pinned.set(source.id, source.version);
      }
      const result = outlinePartSchema.safeParse({
        mode: "outline",
        parts: sections.map(section => ({ ...section.part, title: section.title })),
        bindings: [...pinned].map(([id, version]) => ({ id, version })),
        ...(dataReview ? { dataFingerprint: dataReview.fingerprint,
          ...(dataReview.comparisons?.length ? { compareQuarters: true } : {}) } : {}),
      });
      if (!result.success) throw new Error("请补全章节标题和对应素材，再重新确认。");
      await onGenerateOutline(result.data);
      setOutlineSent(true);
    });
  return (
    <div className={styles.form} aria-label="Pitch 辅助">
      <h2>提案助手</h2>
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
      {projectVersion && onProposalGenerated && <ProposalPreview call={call} projectId={projectId} city={city}
        question={question} language={language} period={period} buildingIds={buildingIds}
        initialQuestion={autoPlan ? initialQuestion : undefined} projectVersion={projectVersion}
        onGenerated={onProposalGenerated} disabled={busy} />}
      {revision?.detail.slides.length ? <ProposalRevision call={call} question={question} {...revision} /> : null}
      <details open={initialQuestion.trim() ? true : undefined}>
        <summary>提案结构建议</summary>
        <Button
          disabled={working || busy}
          variant={sections.length ? "secondary" : "primary"}
          onClick={() =>
            void perform(async (signal) => {
              const r = await call<{ sections: Section[]; missing: string[] }>(
                { action: "outline", projectId, query: { q, objective: question.trim().slice(0, 200), language, limit: 5 } },
                true,
                "ai",
                signal,
              );
              setSections(previous => [...r.sections, ...previous.filter(section => section.review)]);
              setOutlineMissing(r.missing ?? []);
              setOutlineSent(false);
              if (!r.sections.length)
                setError("当前范围没有可用的发布素材。可调整关键词，或先加入正式数据。");
            })
          }
        >
          推荐提纲
        </Button>
        <p>在「数据」中关联 1–5 栋楼宇并设置默认季度后，可加入正式数据章节。仅供内部使用。</p>
        <label className={styles.check}>
          <input type="checkbox" checked={compareQuarters} disabled={working || busy}
            onChange={event => setCompareQuarters(event.target.checked)} />
          同时核对租金和空置率的环比、同比
        </label>
        <Button
          variant="secondary"
          disabled={working || busy || (!dataReview && sections.length >= 8) ||
            !outlineBuildingIds.safeParse(buildingIds).success || !outlineQuarter.safeParse(period).success}
          onClick={() => void reviewData()}
        >
          {dataReview ? "重新核对正式数据" : "核对并加入正式数据"}
        </Button>
        {!reviewMatches && <p role="status">关联楼宇或季度已变化，或已切换对比方式。请重新核对或移除正式数据章节。</p>}
        <ol>
          {sections.map((s, i) => {
            const sectionPart = s.part;
            const alternatives = sectionPart.mode === "dynamic" ? [] : items.filter(item =>
              selected.includes(item.id) && item.templateId === sectionPart.templateId);
            return <li key={s.id}>
              <input
                aria-label="章节标题"
                disabled={working || busy || outlineSent}
                maxLength={160}
                value={s.title}
                onChange={(e) =>
                  setSections((v) =>
                    v.map((x) =>
                      x.id === s.id ? { ...x, title: e.target.value } : x,
                    ),
                  )
                }
              />
              {s.review && <div>
                <p>正式季度：{s.review.parameters.period.year}-Q{s.review.parameters.period.quarter} · 仅限内部</p>
                <p>缺失值原样标记；不替换楼宇或季度。</p>
                <ul aria-label="已核对楼宇">
                  {s.review.buildings.map(building => <li key={building.id}>
                    <strong>{building.name}</strong>
                    <ul>{building.facts.map(fact => <li key={fact.label}>{fact.label}：{fact.value}</li>)}</ul>
                  </li>)}
                </ul>
                {s.review.comparisons?.map(comparison => <div key={comparison.metric}>
                  <div className={styles.tableScroll}>
                  <table className={styles.comparisonTable}>
                    <caption>{comparison.metric}</caption>
                    <thead><tr>{comparison.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
                    <tbody>{comparison.rows.map((row, i) => <tr key={s.review?.buildings[i].id ?? i}>
                      <th scope="row">{row[0]}</th>
                      {row.slice(1).map((cell, j) => <td key={comparison.columns[j + 1]}>{cell}</td>)}
                    </tr>)}</tbody>
                  </table>
                  </div>
                  <p>{comparison.note}</p>
                </div>)}
              </div>}
              {s.materials?.length > 0 && <ul aria-label="已选素材">
                {s.materials.map(material => <li key={material.id}>{material.title} · v{material.version}</li>)}
              </ul>}
              <Button
                variant="ghost"
                disabled={!i || working || busy || outlineSent}
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
                disabled={working || busy || outlineSent}
                onClick={() =>
                  setSections((v) => v.filter((x) => x.id !== s.id))
                }
              >
                移除
              </Button>
              {!!alternatives.length && alternatives.length === selected.length && (
                <Button
                  variant="ghost"
                  disabled={working || busy || outlineSent}
                  onClick={() =>
                    setSections((v) =>
                      v.map((x) =>
                        x.id === s.id && x.part.mode !== "dynamic"
                          ? {
                              ...x,
                              materials: alternatives.map(({ id, title, version }) => ({ id, title, version })),
                              part: {
                                ...x.part,
                                mode:
                                  alternatives.length === 1
                                    ? "static"
                                    : "semi-dynamic",
                                assetIds: alternatives.map(item => item.id),
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
            </li>;
          })}
        </ol>
        {(outlineMissing || dataReview) && (outlineMissing?.length || !dataReview) ? <div>
          <strong>未包含的部分</strong>
          <ul>
            {outlineMissing?.map(note => <li key={note}>{note}</li>)}
            {!dataReview && <li>尚未加入正式楼宇季度数据。</li>}
          </ul>
        </div> : null}

        {!!sections.length && (
          <Button
            disabled={working || busy || outlineSent || !reviewMatches || sections.some(section => !section.title.trim())}
            onClick={() => void generateOutline()}
          >
            确认生成 {sections.length} 个板块
          </Button>
        )}
      </details>
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
              {t.request.task === "revise-text" && t.state === "completed" && t.authorized && t.result &&
                <RevisionReview call={call} taskId={t.id} disabled={busy || working} destination={revisionDestination}
                  canvasTarget={canvasTarget && canvasTarget.assetId === t.asset_id && canvasTarget.assetVersion === t.asset_version
                    ? { projectId: canvasTarget.projectId, slideId: canvasTarget.slideId, expectedVersion: canvasTarget.expectedVersion } : undefined}
                  onCanvasSaved={onCanvasSaved} />}
              {t.result && t.request.task !== "revise-text" && (
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
