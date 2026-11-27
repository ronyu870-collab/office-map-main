"use client";
import * as React from "react";
import { z } from "zod";
import { Button } from "@/src/components/ui";
import type { Call, Catalog } from "./client";
import { slideContentSchema, type SlideContent } from "@/src/lib/pitch/contracts/content";
import { layoutIdSchema, type LayoutId } from "@/src/lib/pitch/contracts/scene";
import { LAYOUTS } from "@/src/lib/pitch/layout/definitions";
import styles from "./workspace.module.css";
type Asset = {
  id: string;
  names: Record<string, string>;
  current_version: number;
  is_test_data: boolean;
  data_as_of?: string | null;
};
const MAX_SELECTED_ASSETS = 12;
export const pitchAssetDragType = "application/x-colliers-pitch-assets";
const assetTransferSchema = z.strictObject({
  projectId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(MAX_SELECTED_ASSETS),
  layout: layoutIdSchema,
});

export function readAssetTransfer(transfer: DataTransfer) {
  try {
    const result = assetTransferSchema.safeParse(JSON.parse(transfer.getData(pitchAssetDragType)));
    return result.success ? { ...result.data, ids: [...new Set(result.data.ids)] } : null;
  } catch {
    return null;
  }
}

type AssetPage = { items: Asset[]; next: string | null };
const previewSchema = z.object({ version: z.object({ content: slideContentSchema }) });
const assetName = (asset: Asset) => asset.names.zh ?? asset.names.en ?? Object.values(asset.names)[0] ?? "企业素材";

function AssetPreview({ call, asset }: { call: Call; asset: Asset }) {
  const [result, setResult] = React.useState<{ content?: SlideContent; error?: string }>();
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    const controller = new AbortController();
    void call({ action: "asset", assetId: asset.id, version: asset.current_version }, false, "library", controller.signal)
      .then(response => {
        if (controller.signal.aborted) return;
        const parsed = previewSchema.safeParse(response);
        setResult(parsed.success ? { content: parsed.data.version.content } : { error: "素材预览无法读取。" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({ error: error instanceof Error ? error.message : "素材预览无法读取。" });
      });
    return () => controller.abort();
  }, [asset.id, asset.current_version, attempt, call]);

  if (!result) return <p role="status">正在读取素材…</p>;
  if (result.error) return <div role="alert">
    <p>{result.error}</p>
    <Button size="sm" variant="ghost" onClick={() => { setResult(undefined); retry(); }}>重试预览</Button>
  </div>;
  const content = result.content;
  if (!content) return null;
  const caseBlock = content.blocks.find(block => block.kind === "case");
  const paragraph = content.blocks.find(block => block.kind === "paragraph");

  const previewTitle = caseBlock?.title ?? content.title;
  return <div className={styles.assetPreview}>
    {previewTitle !== assetName(asset) && <p><strong>{previewTitle}</strong></p>}
    {content.subtitle && <p>{content.subtitle}</p>}
    {caseBlock ? (
      <dl>
        <dt>项目挑战</dt><dd>{caseBlock.challenge}</dd>
        <dt>服务方案</dt><dd>{caseBlock.approach}</dd>
        <dt>项目成果</dt><dd>{caseBlock.outcome}</dd>
      </dl>
    ) : paragraph && <p>{paragraph.text}</p>}
    <p>资料日期 {content.dataAsOf} · v{asset.current_version}</p>
    <ul aria-label="素材来源">
      {content.sources.map(source => (
        <li key={source.id}>{source.label} · {source.locator}</li>
      ))}
    </ul>
  </div>;
}

export function AssetPicker({
  call,
  categories = [],
  onAdd,
  busy,
  projectId,
}: {
  call: Call;
  categories?: Catalog["categories"];
  projectId?: string;
  onAdd: (ids: string[], layout: LayoutId) => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [selected, setSelected] = React.useState<Asset[]>([]);
  const [layout, setLayout] = React.useState<LayoutId>("two-columns");
  const [openAssetId, setOpenAssetId] = React.useState<string>();
  const [addError, setAddError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const enabledCategories = categories.filter(category => category.enabled);
  const activeCategoryId = enabledCategories.some(category => category.id === categoryId) ? categoryId : "";
  const previewPrefix = React.useId();
  const trimmedTag = tag.trim();
  const search = React.useMemo(() => ({
    retry,
    query: {
      action: "search",
      kind: "assets",
      q,
      state: "published",
      validity: "valid",
      ...(activeCategoryId ? { categoryId: activeCategoryId } : {}),
      ...(trimmedTag ? { tag: trimmedTag } : {}),
    },
  }), [q, activeCategoryId, trimmedTag, retry]);
  const [result, setResult] = React.useState<{
    search: typeof search; page?: AssetPage; error?: string; loadingMore?: boolean;
  }>();
  const active = React.useRef<{
    search: typeof search; controller: AbortController; loadingMore: boolean;
  }>(null);
  const composing = React.useRef(false);
  const current = result?.search === search ? result : undefined;

  React.useEffect(() => {
    const controller = new AbortController();
    active.current = { search, controller, loadingMore: false };
    const timer = setTimeout(() => {
      void call<AssetPage>(search.query, false, "library", controller.signal)
        .then(page => {
          if (!controller.signal.aborted) setResult({ search, page });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setResult({ search, error: error instanceof Error ? error.message : "素材暂未加载。" });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [call, search]);

  async function loadMore() {
    const request = active.current;
    const page = current?.page;
    if (!request || request.search !== search || request.loadingMore || !page?.next) return;
    request.loadingMore = true;
    setResult({ search, page, loadingMore: true });
    try {
      const next = await call<AssetPage>({ ...search.query, before: page.next }, false, "library", request.controller.signal);
      if (request.controller.signal.aborted) return;
      const items = [...new Map([...page.items, ...next.items].map(asset => [asset.id, asset])).values()];
      setResult({ search, page: { items, next: next.next } });
    } catch (error) {
      if (!request.controller.signal.aborted)
        setResult({ search, page, error: error instanceof Error ? error.message : "更多素材暂无法读取。" });
    } finally {
      request.loadingMore = false;
    }
  }

  function removeAsset(id: string) {
    setAddError("");
    setSelected(previous => previous.filter(asset => asset.id !== id));
  }

  async function addSelected() {
    const ids = selected.map(asset => asset.id);
    setAddError("");
    try {
      await onAdd(ids, layout);
      setSelected(previous => previous.filter(asset => !ids.includes(asset.id)));
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "素材暂未加入，请重试。");
    }
  }

  return (
    <section className={styles.form} aria-label="企业素材选择">
      <label>
        搜索企业素材
        <input type="search" value={text} onChange={event => {
          setText(event.target.value);
          if (!composing.current) setQ(event.target.value.trim());
        }} onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={event => {
            composing.current = false;
            setText(event.currentTarget.value);
            setQ(event.currentTarget.value.trim());
          }} />
      </label>
      <div className={styles.assetFilters}>
        {enabledCategories.length > 0 && <label>
          素材分类
          <select value={activeCategoryId} onChange={event => setCategoryId(event.target.value)}>
            <option value="">全部分类</option>
            {enabledCategories.map(category => (
              <option value={category.id} key={category.id}>{category.names.zh ?? category.names.en ?? category.system_code}</option>
            ))}
          </select>
        </label>}
        <label>
          素材标签
          <input value={tag} onChange={event => setTag(event.target.value)} />
        </label>
      </div>
      {!current && <p role="status">正在查找已发布素材…</p>}
      {current?.error && <div role="alert">
        <p>{current.error}</p>
        {!current.page && <Button variant="ghost" onClick={() => setRetry(value => value + 1)}>重试搜索</Button>}
      </div>}
      {current?.page?.items.length ? (
        <ul className={styles.assetRows} aria-busy={current.loadingMore}>
          {current.page.items.map(asset => {
            const checked = selected.some(item => item.id === asset.id);
            const expanded = openAssetId === asset.id;
            const previewId = `${previewPrefix}-${asset.id}`;

            return <li key={asset.id}>
              <div className={styles.assetRow} draggable={!!projectId && !busy}
                onDragStart={event => {
                  if (!projectId || busy) return;
                  const ids = checked ? selected.map(item => item.id) : [asset.id];
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(pitchAssetDragType, JSON.stringify({ projectId, ids, layout }));
                }}>
                <label className={styles.check}>
                  <input type="checkbox" checked={checked}
                    disabled={busy || (!checked && selected.length >= MAX_SELECTED_ASSETS)}
                    onChange={event => {
                      if (!event.target.checked) {
                        removeAsset(asset.id);
                        return;
                      }
                      setAddError("");
                      setSelected(previous => [...previous, asset]);
                    }} />
                  <span>
                    <strong>{assetName(asset)}</strong>
                    {(asset.data_as_of || asset.is_test_data) && <span>
                      {[asset.data_as_of, asset.is_test_data && "测试素材"].filter(Boolean).join(" · ")}
                    </span>}
                  </span>
                </label>
                <Button variant="ghost" size="sm" aria-label={`预览${assetName(asset)}`}
                  aria-expanded={expanded} aria-controls={previewId}
                  onClick={() => setOpenAssetId(expanded ? undefined : asset.id)}>预览</Button>
              </div>
              <div id={previewId} hidden={!expanded}>
                {expanded && <AssetPreview call={call} asset={asset} key={asset.current_version} />}
              </div>
            </li>;
          })}
        </ul>
      ) : current?.page && <p>没有匹配的已发布素材。</p>}
      {current?.page?.next && <Button variant="secondary" loading={current.loadingMore} loadingLabel="正在加载…"
        onClick={() => void loadMore()}>
        {current.error ? "重试读取更多素材" : "更多素材"}
      </Button>}
      {selected.length > 0 && (
        <details>
          <summary>已选素材（{selected.length}）</summary>
          <ul className={styles.assetRows}>
            {selected.map(asset => (
              <li className={styles.assetRow} key={asset.id}>
                <span>{assetName(asset)}</span>
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`移除${assetName(asset)}`}
                  onClick={() => removeAsset(asset.id)}>移除</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <label>
        组合布局
        <select value={layout} onChange={event => setLayout(event.target.value as LayoutId)}>
          {LAYOUTS.map(item => <option key={item.id} value={item.id}>{item.zh}</option>)}
        </select>
      </label>
      {addError && <p role="alert">{addError}</p>}
      <Button disabled={busy || !selected.length} onClick={() => void addSelected()}>
        添加到 Pitch（{selected.length}）
      </Button>
    </section>
  );
}
