"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { Button } from "@/src/components/ui";
import type { AuthSessionResult } from "@/src/services/Auth";
import type { Call, Catalog } from "./client";
import { themeLabel } from "./client";
import styles from "./workspace.module.css";
const AiManager = dynamic(
  () => import("./AiManager").then((m) => m.AiManager),
  { loading: () => <p>正在读取辅助能力管理…</p> },
);
const MaterialLibrary = dynamic(
  () => import("../library/MaterialLibrary").then((m) => m.MaterialLibrary),
  { loading: () => <p>正在打开素材管理…</p> },
);
const BusinessStudio = dynamic(
  () => import("../business/BusinessStudio").then((m) => m.BusinessStudio),
  { loading: () => <p>正在打开模板管理…</p> },
);
type Metrics = {
  documents: number;
  projects: number;
  storageBytes: number;
  exports: {
    id: string;
    title: string;
    filename: string;
    state: string;
    format: string;
    created_at: string;
  }[];
  failures: {
    id: string;
    title: string;
    state: string;
    error_code: string;
    updated_at: string;
  }[];
  grants: Record<string, unknown>[];
};
export function Manager({
  call,
  catalog,
  session,
  onProject,
}: {
  call: Call;
  catalog: Catalog;
  session: AuthSessionResult;
  onProject: (id: string) => Promise<void>;
}) {
  const admin = catalog.scopes.some((s) => s.canAdmin),
    [tab, setTab] = React.useState("library"),
    [stats, setStats] = React.useState<Metrics | null>(null),
    [offset, setOffset] = React.useState(0),
    [name, setName] = React.useState(""),
    [code, setCode] = React.useState(""),
    [categoryId, setCategoryId] = React.useState(""),
    [enabled, setEnabled] = React.useState(true),
    [categories, setCategories] = React.useState(catalog.categories),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!admin || tab !== "operations") return;
    const c = new AbortController();
    void call<Metrics>(
      { action: "admin", offset },
      false,
      "workspace",
      c.signal,
    )
      .then(setStats)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [call, admin, tab, offset]);
  const props = {
    userId: session.session.user.id,
    simulated: session.user.id !== session.session.user.id,
    scopes: catalog.scopes,
    categories: catalog.categories,
    themes: catalog.themes,
    onProject,
  };
  return (
    <section className={styles.content}>
      <nav className={styles.modeTabs} aria-label="管理功能">
        {[
          ["library", "企业素材与导入"],
          ["templates", "资产档案与模板"],
          ...(admin
            ? [
                ["settings", "分类与主题"],
                ["operations", "权限与运行记录"],
                ["ai", "AI 与持续学习"],
              ]
            : []),
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
      {tab === "ai" && admin && <AiManager call={call} catalog={catalog} />}
      {tab === "library" && <MaterialLibrary {...props} />}{" "}
      {tab === "templates" && <BusinessStudio {...props} />}
      {tab === "settings" && admin && (
        <>
          <h2>内容分类</h2>
          <ul className={styles.rows}>
            {categories.map((c) => (
              <li key={c.id}>
                <span>{c.names.zh ?? c.names.en}</span>
                <span>{c.enabled ? "启用" : "停用"}</span>
              </li>
            ))}
          </ul>
          <div className={styles.form}>
            <label>
              编辑分类
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  const found = categories.find((c) => c.id === e.target.value);
                  setName(found?.names.zh ?? found?.names.en ?? "");
                  setCode(found?.system_code ?? "");
                  setEnabled(found?.enabled ?? true);
                }}
              >
                <option value="">新建分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.names.zh ?? c.names.en}
                  </option>
                ))}
              </select>
            </label>
            <label>
              分类名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              稳定标识
              <input
                disabled={!!categoryId}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="service-plan"
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用分类
            </label>
            <Button
              disabled={busy || !name.trim() || !/^[a-z0-9-]+$/.test(code)}
              onClick={() => {
                setBusy(true);
                const id = categoryId || crypto.randomUUID(),
                  prior = categories.find((c) => c.id === id);
                void call(
                  {
                    action: "category_save",
                    id,
                    expectedRevision: prior?.revision ?? 0,
                    systemCode: code,
                    names: { ...prior?.names, zh: name },
                    enabled,
                  },
                  true,
                  "",
                )
                  .then(() => {
                    setCategories((v) => [
                      ...v.filter((c) => c.id !== id),
                      {
                        id,
                        system_code: code,
                        names: { ...prior?.names, zh: name },
                        enabled,
                        revision: (prior?.revision ?? 0) + 1,
                      },
                    ]);
                    setCategoryId("");
                    setName("");
                    setCode("");
                    setEnabled(true);
                    setError("分类已保存。");
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              保存分类
            </Button>
          </div>
          <h2>设计主题</h2>
          <ul className={styles.rows}>
            {catalog.themes.map((t) => (
              <li key={t.id}>
                <span>{themeLabel(t.id)}</span>
                <span>
                  版本 {t.current_version} ·{" "}
                  {t.id.startsWith("colliers-") ? "临时主题" : "已注册主题"}
                </span>
              </li>
            ))}
          </ul>
          <p>主题版本由已验证的渲染配置注册，业务素材与模板无需随之修改。</p>
        </>
      )}
      {tab === "operations" && admin && stats && (
        <>
          <dl className={styles.metrics}>
            <div>
              <dt>素材原件</dt>
              <dd>{stats.documents}</dd>
            </div>
            <div>
              <dt>Pitch 项目</dt>
              <dd>{stats.projects}</dd>
            </div>
            <div>
              <dt>原件存储</dt>
              <dd>{(stats.storageBytes / 1024 / 1024).toFixed(1)} MiB</dd>
            </div>
          </dl>
          <h2>导出记录</h2>
          <div className={styles.tableScroll}>
            <table>
              <thead>
                <tr>
                  <th>Pitch</th>
                  <th>文件</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {stats.exports.slice(0, 30).map((e) => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td>{e.filename}</td>
                    <td>
                      {e.state === "ready"
                        ? "已生成"
                        : e.state === "failed"
                          ? "失败"
                          : "处理中"}
                    </td>
                    <td>{new Date(e.created_at).toLocaleString("zh-CN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!offset}
              onClick={() => setOffset((v) => Math.max(0, v - 30))}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              disabled={stats.exports.length <= 30}
              onClick={() => setOffset((v) => v + 30)}
            >
              下一页
            </Button>
          </div>
          <h2>最近生成失败</h2>
          <ul className={styles.rows}>
            {stats.failures.map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
                <span>
                  {t.error_code === "PITCH_WORKER_TIMEOUT"
                    ? "任务超时"
                    : "生成未完成"}{" "}
                  · {new Date(t.updated_at).toLocaleString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
          <h2>当前管理范围</h2>
          <ul className={styles.rows}>
            {stats.grants.map((g, i) => (
              <li key={i}>
                <span>
                  {String(g.region ?? "全部区域")} ·{" "}
                  {String(g.city ?? "全部城市")} ·{" "}
                  {String(g.businessLine ?? "全部业务线")}
                </span>
                <span>
                  对客导出：{g.clientExport ? "允许" : "未授权"} · 维护：
                  {g.maintainer ? "允许" : "未授权"}
                </span>
              </li>
            ))}
          </ul>
          <p>数据模块的独立授权仍由原权限管理入口维护。</p>
        </>
      )}
    </section>
  );
}
