"use client";
import * as React from "react";
import { Button } from "@/src/components/ui";
import type {
  DynamicParameters,
  Generation,
} from "@/src/lib/pitch/business/protocol";
import { dynamicParametersSchema } from "@/src/lib/pitch/business/protocol";
import type { Call } from "./client";
import type { Template } from "./TemplatePicker";
import styles from "./workspace.module.css";
export function BuildingPicker({
  call,
  ids,
  onChange,
}: {
  call: Call;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = React.useState(""),
    [items, setItems] = React.useState<{ id: string; name: string }[]>([]),
    [known, setKnown] = React.useState<Record<string, string>>({}),
    [next, setNext] = React.useState<number | null>(null),
    [error, setError] = React.useState("");
  React.useEffect(() => {
    const c = new AbortController(),
      timer = setTimeout(() => {
        void call<{
          items: { id: string; name: string }[];
          next: number | null;
        }>({ action: "buildings", q }, false, "business", c.signal)
          .then((r) => {
            setItems(r.items);
            setNext(r.next);
            setKnown((v) => ({
              ...v,
              ...Object.fromEntries(r.items.map((b) => [b.id, b.name])),
            }));
            setError("");
          })
          .catch((e) => {
            if (!c.signal.aborted) setError(e.message);
          });
      }, 250);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [q, call]);
  return (
    <fieldset className={styles.choice}>
      <legend>关联项目</legend>
      <label>
        搜索楼宇
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {error && <p role="status">{error}</p>}
      {ids.length > 0 && (
        <ul>
          {ids.map((id) => (
            <li key={id}>
              {known[id] ?? "已关联楼宇"}
              <Button
                variant="ghost"
                aria-label={`移除${known[id] ?? "关联楼宇"}`}
                onClick={() => onChange(ids.filter((v) => v !== id))}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.results}>
        {items
          .filter((b) => !ids.includes(b.id))
          .map((b) => (
            <Button
              variant="ghost"
              key={b.id}
              disabled={ids.length >= 20}
              onClick={() => onChange([...ids, b.id])}
            >
              {b.name}
            </Button>
          ))}
      </div>
      {next !== null && (
        <Button
          variant="secondary"
          onClick={() =>
            void call<{
              items: { id: string; name: string }[];
              next: number | null;
            }>({ action: "buildings", q, offset: next }, false, "business")
              .then((r) => {
                setItems((v) => [...v, ...r.items]);
                setNext(r.next);
                setKnown((v) => ({
                  ...v,
                  ...Object.fromEntries(r.items.map((b) => [b.id, b.name])),
                }));
              })
              .catch((e) => setError(e.message))
          }
        >
          更多楼宇
        </Button>
      )}
    </fieldset>
  );
}
const fields: Record<
  string,
  {
    label: string;
    type: "select" | "text" | "date";
    options?: Record<string, string>;
  }
> = {
  direction: {
    label: "数据排序",
    type: "select",
    options: { desc: "从高到低", asc: "从低到高" },
  },
  chart: {
    label: "图表形式",
    type: "select",
    options: { table: "表格", bar: "条形图", column: "柱状图", line: "折线图" },
  },
  inventory: {
    label: "市场样本",
    type: "select",
    options: { tracked: "正式跟踪样本", all_authorized: "全部获权样本" },
  },
  from: { label: "起始日期", type: "date" },
  to: { label: "结束日期", type: "date" },
  leaseSource: {
    label: "成交来源",
    type: "select",
    options: { combined: "当前与历史", live: "当前成交", history: "历史成交" },
  },
  measure: {
    label: "统计依据",
    type: "select",
    options: { count: "成交笔数", area: "成交面积" },
  },
};
export function TemplateParameters({
  call,
  template,
  buildingIds,
  period,
  onGenerate,
  busy,
  initial,
}: {
  call: Call;
  template: Template;
  buildingIds: string[];
  period: string;
  onGenerate: (part: Generation["parts"][number]) => Promise<void>;
  busy: boolean;
  initial?: Generation["parts"][number];
}) {
  const now = new Date(),
    year = now.getFullYear(),
    quarter = Math.ceil((now.getMonth() + 1) / 3),
    p = period.match(/^(\d{4})-Q([1-4])$/);
  const [selected, setSelected] = React.useState<string[]>(
      initial && initial.mode !== "dynamic" ? initial.assetIds : [],
    ),
    [q, setQ] = React.useState(""),
    [assets, setAssets] = React.useState<
      { id: string; names: Record<string, string>; is_test_data: boolean }[]
    >([]),
    [next, setNext] = React.useState<string | null>(null),
    [error, setError] = React.useState("");
  const [length, setLength] = React.useState<"brief" | "detailed">(
      initial && initial.mode !== "dynamic" ? initial.length : "detailed",
    ),
    [variant, setVariant] = React.useState<"standard" | "alternate">(
      initial && initial.mode !== "dynamic" ? initial.variant : "standard",
    ),
    [fallback, setFallback] = React.useState(false);
  const [params, setParams] = React.useState<DynamicParameters>(
    initial?.mode === "dynamic"
      ? initial.parameters
      : {
          templateId: template.id as DynamicParameters["templateId"],
          buildingIds,
          submarkets: [],
          inventory: "tracked",
          period: { year: p ? +p[1] : year, quarter: p ? +p[2] : quarter },
          start: { year: year - 1, quarter: 1 },
          end: { year, quarter },
          fields: ["totalArea", "netEffectiveRent"],
          direction: "desc",
          chart: template.id.endsWith("-trend") ? "line" : "table",
          from: `${year}-01-01`,
          to: now.toISOString().slice(0, 10),
          leaseSource: "combined",
          measure: "count",
        },
  );
  const [submarketText, setSubmarketText] = React.useState(
      params.submarkets.join("，"),
    ),
    [invalidQuarters, setInvalidQuarters] = React.useState<string[]>([]);
  const dynamic = template.kind === "dynamic",
    lease = template.id.startsWith("lease-"),
    trend = template.id.endsWith("-trend");
  React.useEffect(() => {
    if (dynamic) return;
    const c = new AbortController(),
      timer = setTimeout(
        () =>
          void call<{ items: typeof assets; next: string | null }>(
            { action: "search", kind: template.kind, q },
            false,
            "business",
            c.signal,
          )
            .then((r) => {
              setAssets(r.items);
              setNext(r.next);
              setError("");
            })
            .catch((e) => {
              if (!c.signal.aborted) setError(e.message);
            }),
        250,
      );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [call, q, template.kind, dynamic]);
  const quarterField = (key: "period" | "start" | "end", label: string) => (
    <QuarterInput
      key={key}
      label={label}
      value={params[key]}
      onChange={(value) => setParams((v) => ({ ...v, [key]: value }))}
      onValidity={(valid) =>
        setInvalidQuarters((v) =>
          valid
            ? v.filter((k) => k !== key)
            : [...v.filter((k) => k !== key), key],
        )
      }
    />
  );
  async function generate() {
    try {
      setError("");
      const part: Generation["parts"][number] = dynamic
        ? {
            mode: "dynamic",
            parameters: dynamicParametersSchema.parse({
              ...params,
              submarkets: submarketText
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            }),
          }
        : {
            mode: selected.length > 1 ? "semi-dynamic" : "static",
            templateId: template.id,
            assetIds: selected,
            length,
            allowFallback: fallback,
            variant,
          };
      await onGenerate(part);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成未完成。");
    }
  }
  return (
    <section className={styles.form} aria-label={`${template.name}配置`}>
      <h2>{template.name}</h2>
      {error && <p role="alert">{error}</p>}
      {dynamic ? (
        <>
          <BuildingPicker
            call={call}
            ids={params.buildingIds}
            onChange={(buildingIds) =>
              setParams((v) => ({
                ...v,
                buildingIds,
                targetBuildingId: buildingIds.includes(v.targetBuildingId ?? "")
                  ? v.targetBuildingId
                  : buildingIds[0],
              }))
            }
          />
          {lease ? (
            (["from", "to", "leaseSource", "measure"] as const).map((key) => {
              const field = fields[key];
              return (
                <label key={key}>
                  {field.label}
                  {field.type === "select" ? (
                    <select
                      value={params[key]}
                      onChange={(e) =>
                        setParams((v) => ({ ...v, [key]: e.target.value }))
                      }
                    >
                      {Object.entries(field.options!).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={params[key]}
                      onChange={(e) =>
                        setParams((v) => ({ ...v, [key]: e.target.value }))
                      }
                    />
                  )}
                </label>
              );
            })
          ) : (
            <>
              {trend ? (
                <>
                  {quarterField("start", "起始季度")}
                  {quarterField("end", "结束季度")}
                </>
              ) : (
                quarterField("period", "统计季度")
              )}
              <label>
                子市场（可选，逗号分隔）
                <input
                  value={submarketText}
                  onChange={(e) => setSubmarketText(e.target.value)}
                />
              </label>
            </>
          )}
          {(
            ["direction", "chart", ...(!lease ? ["inventory"] : [])] as const
          ).map((key) => {
            const f = fields[key];
            return (
              <label key={key}>
                {f.label}
                <select
                  value={String(params[key as keyof DynamicParameters])}
                  onChange={(e) =>
                    setParams((v) => ({ ...v, [key]: e.target.value }))
                  }
                >
                  {Object.entries(f.options!).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {["project-comparison", "building-profile"].includes(template.id) && (
            <fieldset>
              <legend>对比指标</legend>
              {Object.entries({
                height: "高度",
                floors: "楼层",
                parking: "车位",
                totalArea: "总面积",
                vacantArea: "空置面积",
                netEffectiveRent: "净有效租金",
              }).map(([id, label]) => (
                <label className={styles.check} key={id}>
                  <input
                    type="checkbox"
                    checked={params.fields.includes(
                      id as DynamicParameters["fields"][number],
                    )}
                    onChange={(e) =>
                      setParams((v) => ({
                        ...v,
                        fields: e.target.checked
                          ? [
                              ...v.fields,
                              id as DynamicParameters["fields"][number],
                            ]
                          : v.fields.filter((f) => f !== id),
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
        </>
      ) : (
        <>
          <label>
            搜索
            {
              (
                {
                  corporate: "公司素材",
                  team: "团队成员",
                  case: "案例",
                  research: "研究素材",
                  custom: "内容",
                } as Record<string, string>
              )[template.kind]
            }
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <p>{selected.length} 项已选</p>
          <div className={styles.results}>
            {assets.map((a) => (
              <label className={styles.check} key={a.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(a.id)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked
                        ? [...v, a.id]
                        : v.filter((id) => id !== a.id),
                    )
                  }
                  disabled={
                    !selected.includes(a.id) &&
                    selected.length >= (template.recipe?.maxAssets ?? 30)
                  }
                />
                {a.names.zh ?? a.names.en}
                {a.is_test_data ? " · 测试" : ""}
              </label>
            ))}
          </div>
          {!assets.length && <p>暂无适用的已发布素材。</p>}
          {next && (
            <Button
              variant="secondary"
              onClick={() =>
                void call<{ items: typeof assets; next: string | null }>(
                  { action: "search", kind: template.kind, q, before: next },
                  false,
                  "business",
                )
                  .then((r) => {
                    setAssets((v) => [...v, ...r.items]);
                    setNext(r.next);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              更多素材
            </Button>
          )}
          <label>
            内容长度
            <select
              value={length}
              onChange={(e) => setLength(e.target.value as typeof length)}
            >
              <option value="brief">简洁版</option>
              <option value="detailed">详细版</option>
            </select>
          </label>
          <label>
            页面排版
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value as typeof variant)}
            >
              <option value="standard">标准</option>
              <option value="alternate">替换布局</option>
            </select>
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={fallback}
              onChange={(e) => setFallback(e.target.checked)}
            />
            允许已明确配置的全国或全球通用素材
          </label>
        </>
      )}
      <Button
        disabled={
          busy || invalidQuarters.length > 0 || (!dynamic && !selected.length)
        }
        loading={busy}
        onClick={() => void generate()}
      >
        生成页面
      </Button>
    </section>
  );
}

function QuarterInput({
  label,
  value,
  onChange,
  onValidity,
}: {
  label: string;
  value: { year: number; quarter: number };
  onChange: (v: { year: number; quarter: number }) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [text, setText] = React.useState(`${value.year}-Q${value.quarter}`),
    [error, setError] = React.useState(false);
  return (
    <label>
      {label}
      <input
        value={text}
        placeholder="2026-Q3"
        aria-invalid={error || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const match = e.target.value.match(/^(\d{4})-Q([1-4])$/i);
          setError(!match);
          onValidity(!!match);
          if (match) onChange({ year: +match[1], quarter: +match[2] });
        }}
      />
      {error && <span>请填写完整季度，例如 2026-Q3。</span>}
    </label>
  );
}
