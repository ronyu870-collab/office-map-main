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
import { ECOSYSTEM_BY_ID } from '@/src/lib/pitch/templates/ecosystem';
import styles from "./workspace.module.css";

type BuildingSearchPage = { items: { id: string; name: string }[]; next: number | null };
type BuildingSearchResult = { key: number; page?: BuildingSearchPage; error?: string; loadingMore?: boolean };

export function BuildingPicker({
  call,
  ids,
  onChange,
  disabled = false,
  label = "关联项目",
  maxSelection = 20,
}: {
  call: Call;
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
  maxSelection?: number;
}) {
  const [text, setText] = React.useState(""),
    [{ q, key }, setSearch] = React.useState({ q: "", key: 0 }),
    [known, setKnown] = React.useState<Record<string, string>>({}),
    [result, setResult] = React.useState<BuildingSearchResult>();
  const current = result?.key === key ? result : undefined;
  const composing = React.useRef(false);
  const active = React.useRef<{ key: number; controller: AbortController; loadingMore: boolean }>(null);
  function searchFor(text: string) {
    const q = text.trim();
    setSearch(previous => previous.q === q ? previous : { q, key: previous.key + 1 });
  }
  const remember = React.useCallback((items: BuildingSearchPage["items"]) => {
    setKnown(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.id, item.name])) }));
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    active.current = { key, controller, loadingMore: false };
    const timer = setTimeout(() => {
      void call<BuildingSearchPage>({ action: "buildings", q }, false, "business", controller.signal)
        .then(page => {
          if (controller.signal.aborted) return;
          remember(page.items);
          setResult({ key, page });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({ key, error: error instanceof Error ? error.message : "楼宇查询未完成。" });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [call, key, q, remember]);

  async function loadMore() {
    const request = active.current;
    const page = current?.page;
    if (!request || request.key !== key || request.loadingMore || !page || page.next === null) return;
    request.loadingMore = true;
    setResult({ key, page, loadingMore: true });
    try {
      const next = await call<BuildingSearchPage>({ action: "buildings", q, offset: page.next }, false, "business", request.controller.signal);
      if (request.controller.signal.aborted) return;
      remember(next.items);
      const items = [...new Map([...page.items, ...next.items].map(item => [item.id, item])).values()];
      setResult({ key, page: { items, next: next.next } });
    } catch (error) {
      if (!request.controller.signal.aborted)
        setResult({ key, page, error: error instanceof Error ? error.message : "更多楼宇暂无法读取。" });
    } finally {
      request.loadingMore = false;
    }
  }

  return (
    <fieldset className={styles.choice} disabled={disabled}>
      <legend>{label}</legend>
      <label>
        搜索楼宇
        <input type="search" value={text} onChange={event => {
          setText(event.target.value);
          if (!composing.current) searchFor(event.target.value);
        }} onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={event => {
            composing.current = false;
            setText(event.currentTarget.value);
            searchFor(event.currentTarget.value);
          }} />
      </label>
      {!current && <p role="status">正在查询楼宇…</p>}
      {current?.error && <p role="status">{current.error}</p>}
      {current?.error && !current.page && <Button variant="ghost"
        onClick={() => setSearch(previous => ({ ...previous, key: previous.key + 1 }))}>重试查询</Button>}
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
        {current?.page?.items
          .filter((b) => !ids.includes(b.id))
          .map((b) => (
            <Button
              variant="ghost"
              key={b.id}
              disabled={ids.length >= maxSelection}
              onClick={() => onChange([...ids, b.id])}
            >
              {b.name}
            </Button>
          ))}
      </div>
      {current?.page?.items.length === 0 && <p role="status">没有匹配的楼宇。</p>}
      {current?.page && current.page.next !== null && <Button variant="secondary"
        loading={current.loadingMore} loadingLabel="正在读取更多楼宇…" onClick={() => void loadMore()}>
        {current.error ? "重试读取更多楼宇" : "更多楼宇"}
      </Button>}
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
export function defaultDynamicParameters(templateId: DynamicParameters["templateId"], buildingIds: string[], period: string): DynamicParameters {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const savedPeriod = period.match(/^(\d{4})-Q([1-4])$/);
  return {
    templateId, buildingIds, submarkets: [], inventory: "tracked",
    period: savedPeriod ? { year: Number(savedPeriod[1]), quarter: Number(savedPeriod[2]) } : { year, quarter },
    start: { year: year - 1, quarter: 1 }, end: { year, quarter },
    fields: ["totalArea", "netEffectiveRent"], direction: "desc",
    chart: templateId.endsWith("-trend") ? "line" : "table",
    from: `${year}-01-01`, to: now.toISOString().slice(0, 10), leaseSource: "combined", measure: "count",
  };
}

export function TemplateParameters({
  call,
  template,
  buildingIds,
  period,
  onGenerate,
  busy,
  initial,
  actionLabel = "生成页面",
}: {
  call: Call;
  template: Template;
  buildingIds: string[];
  period: string;
  onGenerate: (part: Generation["parts"][number]) => Promise<void>;
  busy: boolean;
  initial?: Generation["parts"][number];
  actionLabel?: string;
}) {
  const dynamic = template.kind === "dynamic",
    lease = template.id.startsWith("lease-"),
    trend = template.id.endsWith("-trend"),
    stacking = template.id === "stacking-plan",
    map = template.id === "competition-map",
    visual = stacking || map;
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
  const [params, setParams] = React.useState<DynamicParameters>(() => {
    const value = initial?.mode === "dynamic" ? initial.parameters
      : defaultDynamicParameters(template.id as DynamicParameters["templateId"], buildingIds, period);
    if (!stacking || value.buildingIds.length <= 1) return value;
    const target = value.targetBuildingId;
    return { ...value, buildingIds: target && value.buildingIds.includes(target) ? [target] : [] };
  });
  const [submarketText, setSubmarketText] = React.useState(
      params.submarkets.join("，"),
    ),
    [invalidQuarters, setInvalidQuarters] = React.useState<string[]>([]);
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
      {ECOSYSTEM_BY_ID.get(template.id)&&<p>所需内容：{ECOSYSTEM_BY_ID.get(template.id)!.fields.join('、')}。</p>}
      {error && <p role="alert">{error}</p>}
      {dynamic ? (
        <>
          <BuildingPicker
            call={call}
            ids={params.buildingIds}
            label={stacking ? "历史堆叠图楼宇" : undefined}
            maxSelection={stacking ? 1 : undefined}
            onChange={(buildingIds) =>
              setParams((v) => ({
                ...v,
                buildingIds,
                targetBuildingId: buildingIds.includes(v.targetBuildingId ?? "")
                  ? v.targetBuildingId
                  : visual ? undefined : buildingIds[0],
              }))
            }
          />
          {visual ? (map && !params.buildingIds.length && <label>
            子市场（可选，逗号分隔）
            <input value={submarketText} onChange={e => setSubmarketText(e.target.value)} />
          </label>) : lease ? (
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
          {!visual && (
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
              {!ECOSYSTEM_BY_ID.has(template.id)&&<option value="alternate">替换布局</option>}
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
          busy || invalidQuarters.length > 0 || (!dynamic && !selected.length) ||
          (stacking && params.buildingIds.length !== 1)
        }
        loading={busy}
        onClick={() => void generate()}
      >
        {actionLabel}
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
