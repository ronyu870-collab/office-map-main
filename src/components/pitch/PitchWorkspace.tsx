/* eslint-disable @next/next/no-img-element -- private server-rendered page thumbnails. */
"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  Plus,
  PanelLeftClose,
  PanelRightClose,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
} from "lucide-react";
import { useAppSession } from "@/src/components/SessionProvider";
import { WorkspaceShell } from "@/src/components/layout";
import { AppHeader, Button, Dialog, IconButton } from "@/src/components/ui";
import { getSessionIdFromAccessToken } from "@/src/utils/authSession";
import { supabase } from "@/src/services/supabaseClient";
import type { AuthSessionResult } from "@/src/services/Auth";
import {
  workspaceDetailSchema,
  preferencesSchema,
  projectContextSchema,
  type WorkspaceDetail,
  type WorkspaceSave,
  type WorkspacePart,
} from "@/src/lib/pitch/workspace/protocol";
import {
  recipeSchema,
  type Generation,
} from "@/src/lib/pitch/business/protocol";
import { ECOSYSTEM_BY_ID } from '@/src/lib/pitch/templates/ecosystem';
import { PATTERN_BY_ID } from '@/src/lib/pitch/layout/patterns/catalog';
import { LAYOUTS } from "@/src/lib/pitch/layout/definitions";
import type { LayoutId } from "@/src/lib/pitch/contracts/scene";
import {
  draftOf,
  WorkspaceError,
  themeLabel,
  type Draft,
  type Catalog,
  type Call,
} from "./workspace/client";
import { TemplatePicker, type Template } from "./workspace/TemplatePicker";
import { TemplateParameters, BuildingPicker } from "./workspace/Parameters";
import { AssetPicker } from "./workspace/Assets";
import { PagePreview, usePagePreviews } from "./workspace/Preview";
import { Projects } from "./workspace/Projects";
import { ExportPanel } from "./workspace/ExportPanel";
import styles from "./workspace/workspace.module.css";
const AiAssist = dynamic(
  () => import("./workspace/AiAssist").then((m) => m.AiAssist),
  { loading: () => <p>正在打开辅助工具…</p> },
);
const Examples = dynamic(()=>import('./workspace/Examples').then(m=>m.Examples),{loading:()=><p>正在打开示例与套装…</p>});
const Manager = dynamic(
  () => import("./workspace/Manager").then((m) => m.Manager),
  { loading: () => <p>正在打开管理中心…</p> },
);
type Panel = "examples" | "quick" | "templates" | "assets" | "projects" | "admin";
const tabs: { id: Panel; label: string }[] = [
  { id: "quick", label: "快速生成" },
  { id: "assets", label: "企业素材库" },
  { id: "templates", label: "模板中心" },
  { id: "examples", label: "示例与套装" },
  { id: "projects", label: "我的 Pitch" },
  { id: "admin", label: "管理中心" },
];
const businessCatalog = z.object({
  recipes: z.array(recipeSchema),
  dynamic: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      reason: z.string(),
    }),
  ),
});
export function PitchWorkspace() {
  const { session, status } = useAppSession(),
    router = useRouter();
  React.useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);
  return (
    <WorkspaceShell header={<AppHeader title="Pitch Studio" homeHref="/" />}>
      {status !== "authenticated" || !session ? (
        <p className={styles.content}>正在读取登录状态…</p>
      ) : (
        <Studio
          key={JSON.stringify([
            session.session.user.id,
            session.user.id,
            session.role,
            getSessionIdFromAccessToken(session.session.access_token),
          ])}
          session={session}
        />
      )}
    </WorkspaceShell>
  );
}
function Studio({ session }: { session: AuthSessionResult }) {
  const [panel, setPanel] = React.useState<Panel>("quick"),
    [catalog, setCatalog] = React.useState<Catalog | null>(null),
    [templates, setTemplates] = React.useState<Template[]>([]),
    [preferences, setPreferences] = React.useState({
      favorites: [] as string[],
      recent: [] as string[],
    });
  const [detail, setDetail] = React.useState<WorkspaceDetail | null>(null),
    [draft, setDraft] = React.useState<Draft | null>(null),
    [dirty, setDirty] = React.useState(false),
    [saving, setSaving] = React.useState(false),
    [conflict, setConflict] = React.useState(false),
    [message, setMessage] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  const [exportTrigger, setExportTrigger] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false),
    [name, setName] = React.useState(""),
    [context, setContext] = React.useState(projectContextSchema.parse({})),
    [scopeIndex, setScopeIndex] = React.useState(0),
    [quickMode, setQuickMode] = React.useState("template"),
    [buildingSearch, setBuildingSearch] = React.useState(false);
  const [left, setLeft] = React.useState(true),
    [right, setRight] = React.useState(true),
    [mobile, setMobile] = React.useState("preview"),
    [width, setWidth] = React.useState(260),
    [leftTab, setLeftTab] = React.useState("templates"),
    [chosen, setChosen] = React.useState<Template | null>(null),
    [regenerating, setRegenerating] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]),
    [task, setTask] = React.useState<{
      id: string;
      state: string;
      attempts?: number;
      error_code?: string;
    } | null>(null),
    [customOpen, setCustomOpen] = React.useState(false),
    [custom, setCustom] = React.useState({
      title: "",
      body: "",
      imageId: "",
      imageVersion: 1,
    }),
    [media, setMedia] = React.useState<
      { id: string; version: number; alt: string }[]
    >([]);
  const [confirmation, setConfirmation] = React.useState<{
      title: string;
      body: string;
      run: () => Promise<void>;
    } | null>(null),
    [taskPollFailed, setTaskPollFailed] = React.useState(false),
    [readingResult, setReadingResult] = React.useState(false),
    [historyOpen, setHistoryOpen] = React.useState(false);
  const life = React.useRef(new AbortController()),
    current = React.useRef({ detail, draft, dirty }),
    pending = React.useRef<Promise<WorkspaceDetail> | null>(null),
    draftSequence = React.useRef(0),
    drag = React.useRef<string | null>(null);
  React.useEffect(() => {
    current.current = { detail, draft, dirty };
  }, [detail, draft, dirty]);
  const call = React.useCallback<Call>(
    async <T,>(
      input: Record<string, unknown>,
      write = false,
      path: "workspace" | "business" | "library" | "ai" | "" = "workspace",
      signal?: AbortSignal,
    ) => {
      if (session.user.id !== session.session.user.id)
        throw new WorkspaceError("请先退出模拟身份。", 401);
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== session.session.user.id)
        throw new WorkspaceError("账号已切换，请重新进入工作台。", 401);
      const query = new URLSearchParams(
        Object.entries(input)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      );
      const response = await fetch(
        "/api/intelligence/pitch" +
          (path ? "/" + path : "") +
          (write ? "" : "?" + query),
        {
          method: write ? "POST" : "GET",
          cache: "no-store",
          signal: AbortSignal.any([
            life.current.signal,
            ...(signal ? [signal] : []),
          ]),
          headers: {
            Authorization: "Bearer " + data.session.access_token,
            ...(write ? { "Content-Type": "application/json" } : {}),
          },
          ...(write ? { body: JSON.stringify(input) } : {}),
        },
      );
      if (!response.ok) {
        const body = await response.json();
        throw new WorkspaceError(
          body.error ?? "操作未完成，请重试。",
          response.status,
        );
      }
      return (
        input.action === "download"
          ? await response.blob()
          : await response.json()
      ) as T;
    },
    [session.session.user.id, session.user.id],
  );
  React.useEffect(() => {
    const c = life.current;
    return () => c.abort();
  }, []);
  React.useEffect(() => {
    let alive = true;
    void Promise.all([
      call<Catalog>({ action: "catalog" }, false, ""),
      call({ action: "catalog" }, false, "business"),
      call({ action: "preferences" }),
      call<{ allowedDynamic: string[]; buildingSearch: boolean }>({
        action: "capabilities",
      }),
    ])
      .then(([c, b, p, cap]) => {
        if (!alive) return;
        setCatalog(c);
        if (
          new URLSearchParams(window.location.search).get("panel") ===
            "admin" &&
          c.scopes.some((s) => s.canAdmin)
        )
          setPanel("admin");
        setBuildingSearch(cap.buildingSearch);
        setPreferences(preferencesSchema.parse(p));
        const parsed = businessCatalog.parse(b);
        setTemplates([
          ...parsed.recipes
            .filter((r) => r.enabled)
            .map((r) => ({
              id: r.id,
              name: r.names.zh ?? r.names.en,
              description: r.description,
              kind: r.accepts[0],
              recipe: r,
              group:ECOSYSTEM_BY_ID.get(r.id)?.group,
            })),
          ...parsed.dynamic
            .filter(
              (r) =>
                r.status === "available" && cap.allowedDynamic.includes(r.id),
            )
            .map((r) => ({
              id: r.id,
              name: r.name,
              description: r.reason,
              kind: "dynamic",
            })),
        ]);
      })
      .catch((e) => {
        if (alive) setMessage(e.message);
      });
    return () => {
      alive = false;
    };
  }, [call]);
  const accept = React.useCallback((value: WorkspaceDetail) => {
    setTaskPollFailed(false);
    setReadingResult(false);
    setDetail(value);
    setDraft(draftOf(value));
    setDirty(false);
    setConflict(false);
    current.current = { detail: value, draft: draftOf(value), dirty: false };
    setSelected((v) => v.filter((id) => value.slides.some((p) => p.id === id)));
    const work =
      value.tasks.find((t) =>
        ["queued", "processing"].includes(String(t.state)),
      ) ??
      value.tasks.find((t) =>
        ["failed", "cancelled"].includes(String(t.state)),
      );
    setTask(
      work
        ? {
            id: String(work.id),
            state: String(work.state),
            attempts: Number(work.attempts),
          }
        : null,
    );
  }, []);
  const linkedProjectRead = React.useRef(false);
  React.useEffect(() => {
    if (!catalog || linkedProjectRead.current) return;
    const id = new URLSearchParams(window.location.search).get("project");
    if (!id || !z.uuid().safeParse(id).success) return;
    linkedProjectRead.current = true;
    const c = new AbortController();
    void call({ action: "get", projectId: id }, true, "workspace", c.signal)
      .then((raw) => {
        if (!c.signal.aborted) {
          accept(workspaceDetailSchema.parse(raw));
          setPanel("quick");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setMessage(e.message);
      });
    return () => c.abort();
  }, [catalog, call, accept]);

  const edit = React.useCallback((update: (d: Draft) => Draft) => {
    draftSequence.current++;
    setDraft((value) => {
      if (!value) return value;
      const next = update(value);
      current.current = { ...current.current, draft: next, dirty: true };
      return next;
    });
    setDirty(true);
    setMessage("");
  }, []);
  const flush = React.useCallback(
    async function saveLatest(): Promise<WorkspaceDetail> {
      if (pending.current) {
        await pending.current;
        return saveLatest();
      }
      const value = current.current;
      if (!value.detail || !value.draft) throw new Error("请先选择 Pitch。");
      if (!value.dirty) return value.detail;
      const sequence = draftSequence.current;
      setSaving(true);
      const work = call(
        {
          action: "save",
          projectId: value.detail.project.id,
          expectedVersion: value.detail.project.version,
          ...value.draft,
        },
        true,
      ).then(workspaceDetailSchema.parse);
      pending.current = work;
      try {
        const saved = await work;
        if (sequence === draftSequence.current) accept(saved);
        else {
          setDetail(saved);
          current.current = { ...current.current, detail: saved };
        }
        setMessage("已保存");
        return saved;
      } catch (e) {
        if (e instanceof WorkspaceError && e.status === 409) setConflict(true);
        setMessage(e instanceof Error ? e.message : "保存未完成。");
        throw e;
      } finally {
        pending.current = null;
        setSaving(false);
      }
    },
    [call, accept],
  );
  React.useEffect(() => {
    if (!dirty || conflict || busy) return;
    const timer = setTimeout(() => void flush().catch(() => {}), 900);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict, busy, flush]);
  React.useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (current.current.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      if (!life.current.signal.aborted)
        setMessage(e instanceof Error ? e.message : "操作未完成。");
    } finally {
      if (!life.current.signal.aborted) setBusy(false);
    }
  }
  const open = async (id: string) => {
    if (current.current.dirty) await flush();
    accept(
      workspaceDetailSchema.parse(
        await call({ action: "get", projectId: id }, true),
      ),
    );
    setPanel("quick");
    setChosen(null);
    setMobile("preview");
  };
  async function ensureProject() {
    if (detail) return flush();
    setCreateOpen(true);
    throw new Error("请先填写项目名称。");
  }
  const updatePreference = async (id: string) => {
    const value = {
      ...preferences,
      favorites: preferences.favorites.includes(id)
        ? preferences.favorites.filter((v) => v !== id)
        : [...preferences.favorites, id],
    };
    await call({ action: "preferences", value }, true);
    setPreferences(value);
  };
  async function choose(template: Template) {
    setChosen(template);
    setRegenerating(false);
    if (!detail) {
      setCreateOpen(true);
    } else {
      setPanel("quick");
      setRight(true);
      setMobile("edit");
    }
  }
  async function generate(part: Generation["parts"][number]) {
    const saved = await flush(),
      taskId = crypto.randomUUID();
    const ids =
      regenerating && draft?.activeSlide
        ? saved.slides
            .filter(
              (p) =>
                p.asset_id ===
                saved.slides.find((s) => s.id === draft.activeSlide)?.asset_id,
            )
            .map((p) => p.id)
        : [];
    const start = async () => {
      await call(
        {
          action: "start",
          projectId: saved.project.id,
          expectedVersion: saved.project.version,
          taskId,
          part,
          replaceIds: ids,
        },
        true,
      );
      setTask({ id: taskId, state: "queued" });
      const value = {
        ...preferences,
        recent: [
          chosen?.id ?? "",
          ...preferences.recent.filter((id) => id !== chosen?.id),
        ]
          .filter(Boolean)
          .slice(0, 20),
      };
      setPreferences(value);
      void call({ action: "preferences", value }, true).catch(() => {});
    };
    if (ids.some((id) => saved.workspace.page_settings[id]?.manual)) {
      setConfirmation({
        title: "重新生成这组页面？",
        body: "已有正文改写将被新结果替换。旧版本保留在历史记录中，可恢复。",
        run: start,
      });
    } else await start();
  }
  React.useEffect(() => {
    if (!task || !["queued", "processing"].includes(task.state) || !detail)
      return;
    const id = task.id,
      projectId = detail.project.id,
      c = new AbortController(),
      timer = setTimeout(() => {
        void call<{
          id: string;
          state: string;
          attempts: number;
          error_code?: string;
        }>(
          { action: "status", projectId, taskId: id },
          true,
          "workspace",
          c.signal,
        )
          .then(async (result) => {
            if (c.signal.aborted) return;
            setTaskPollFailed(false);
            if (result.state === "completed") {
              setReadingResult(true);
              const saved = workspaceDetailSchema.parse(
                await call(
                  { action: "get", projectId },
                  true,
                  "workspace",
                  c.signal,
                ),
              );
              if (c.signal.aborted) return;
              if (current.current.dirty) {
                setReadingResult(false);
                setTask(result);
                setConflict(true);
                setMessage(
                  "页面已生成；当前未保存的编辑已保留，请重新读取或另存副本。",
                );
              } else {
                accept(saved);
                setTask(result);
                setChosen(null);
                setRegenerating(false);
                setMobile("preview");
                setMessage("页面已生成并保存。");
              }
            } else {
              setReadingResult(false);
              setTask(result);
            }
          })
          .catch((e) => {
            if (!c.signal.aborted) {
              setMessage(e.message);
              setTaskPollFailed(true);
            }
          });
      }, 800);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [task, detail, call, accept]);
  const active = draft?.activeSlide ?? null,
    pageEdit = draft?.pages.find((p) => p.id === active),
    page = detail?.slides.find(
      (p) => p.id === (pageEdit?.duplicateOf ?? active),
    ),
    previews = usePagePreviews(call, detail, active),
    canGenerate = catalog?.scopes.some((s) => s.canGenerate) ?? false,
    canManage =
      catalog?.scopes.some((s) => s.canMaintain || s.canAdmin) ?? false;
  const grants =
    catalog?.scopes.filter(
      (s) => s.canGenerate && s.region && s.city && s.businessLine,
    ) ?? [];
  const rendering = !!task && ["queued", "processing"].includes(task.state);
  const editPage = (change: Partial<WorkspaceSave["pages"][number]>) => {
    if (active)
      edit((d) => ({
        ...d,
        pages: d.pages.map((p) => (p.id === active ? { ...p, ...change } : p)),
      }));
  };
  async function addAssets(ids: string[], layout: LayoutId) {
    const saved = await ensureProject(),
      sourceProjectId = crypto.randomUUID();
    await call(
      {
        action: "project_compose",
        projectId: sourceProjectId,
        title: saved.project.title,
        parts: ids.map((assetId) => ({
          assetId,
          layoutId: layout,
          variant: "standard",
        })),
        themeId: saved.project.theme_id,
        themeVersion: saved.project.theme_version,
      },
      true,
      "",
    );
    accept(
      workspaceDetailSchema.parse(
        await call(
          {
            action: "append",
            projectId: saved.project.id,
            expectedVersion: saved.project.version,
            sourceProjectId,
          },
          true,
        ),
      ),
    );
    setPanel("quick");
    setMobile("preview");
  }
  async function addExamples(templateIds:string[],kit?:{id:string;version:number},newDemo=false) {
    if (newDemo && detail && dirty) await flush();
    const grant=grants[scopeIndex];
    let saved:WorkspaceDetail;
    if(!detail||newDemo){
      if(!grant)throw new Error('请选择获权区域后重试。');
      saved=workspaceDetailSchema.parse(await call({action:'create',projectId:crypto.randomUUID(),title:(kit?'提案套装演示':'模板示例')+' · 合成资料',scope:{organizationId:grant.organizationId,region:grant.region,city:grant.city,businessLine:grant.businessLine},themeId:detail?.project.theme_id??catalog!.themes[0].id,themeVersion:detail?.project.theme_version??catalog!.themes[0].current_version,context:detail?.workspace.context??context},true));
      accept(saved);
    }else saved=await flush();
    const taskId=crypto.randomUUID();
    await call({action:'start',projectId:saved.project.id,expectedVersion:saved.project.version,taskId,part:{mode:'example',templateIds,...(kit?{kit}:{})},replaceIds:[]},true);
    setTask({id:taskId,state:'queued'});setPanel('quick');setChosen(null);setMobile('preview');
  }
  async function addBundle(part:WorkspacePart){
    if(busy||rendering)return;
    setBusy(true);
    try{const saved=await ensureProject(),taskId=crypto.randomUUID();await call({action:'start',projectId:saved.project.id,expectedVersion:saved.project.version,taskId,part,replaceIds:[]},true);setTask({id:taskId,state:'queued'});setPanel('quick');setChosen(null);}finally{setBusy(false);}
  }
  function reorder(id: string, to: number) {
    edit((d) => {
      const pages = [...d.pages],
        from = pages.findIndex((p) => p.id === id);
      if (from < 0) return d;
      const [item] = pages.splice(from, 1);
      pages.splice(Math.max(0, Math.min(to, pages.length)), 0, item);
      return { ...d, pages };
    });
  }
  async function remove(ids: string[]) {
    const perform = async () => {
      edit((d) => {
        const pages = d.pages.filter((p) => !ids.includes(p.id));
        return {
          ...d,
          pages,
          activeSlide: ids.includes(d.activeSlide ?? "")
            ? (pages[0]?.id ?? null)
            : d.activeSlide,
        };
      });
      setSelected([]);
    };
    if (
      ids.some(
        (id) =>
          detail?.workspace.page_settings[id]?.manual ||
          draft?.pages.find((p) => p.id === id)?.paragraphs,
      )
    ) {
      setConfirmation({
        title: "删除选中页面？",
        body: "这些页面包含正文编辑。删除后可以从历史记录恢复。",
        run: perform,
      });
    } else await perform();
  }
  async function copyProject(id: string, title: string) {
    const value = workspaceDetailSchema.parse(
      await call(
        {
          action: "copy",
          projectId: id,
          newProjectId: crypto.randomUUID(),
          title,
        },
        true,
      ),
    );
    accept(value);
    setPanel("quick");
  }
  async function conflictCopy() {
    const value = current.current;
    if (!value.detail || !value.draft) return;
    const copied = workspaceDetailSchema.parse(
      await call(
        {
          action: "copy",
          projectId: value.detail.project.id,
          newProjectId: crypto.randomUUID(),
          title: value.draft.title + " · 编辑副本",
          revision: value.detail.project.version,
        },
        true,
      ),
    );
    const map = new Map(
      copied.slides.map((p) => [
        String(copied.workspace.page_settings[p.id]?.copiedFrom),
        p.id,
      ]),
    );
    const pages = value.draft.pages.map((p) => ({
      ...p,
      id: p.duplicateOf ? crypto.randomUUID() : (map.get(p.id) ?? p.id),
      ...(p.duplicateOf ? { duplicateOf: map.get(p.duplicateOf) } : {}),
    }));
    const saved = workspaceDetailSchema.parse(
      await call(
        {
          action: "save",
          projectId: copied.project.id,
          expectedVersion: copied.project.version,
          ...value.draft,
          title: copied.project.title,
          pages,
          activeSlide: map.get(value.draft.activeSlide ?? "") ?? null,
        },
        true,
      ),
    );
    accept(saved);
  }
  return (
    <div className={styles.studio}>
      <nav className={styles.nav} aria-label="Pitch Studio 板块">
        {tabs
          .filter((t) => t.id !== "admin" || canManage)
          .map((t) => (
            <button
              key={t.id}
              aria-current={panel === t.id ? "page" : undefined}
              onClick={() => setPanel(t.id)}
            >
              {t.label}
            </button>
          ))}
      </nav>
      {message && (
        <p role={conflict ? "alert" : "status"} className={styles.notice}>
          {message}
        </p>
      )}
      {conflict && (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            onClick={() =>
              setConfirmation({
                title: "重新读取服务器版本？",
                body: "当前未保存的编辑将被替换。也可以先将编辑另存为副本。",
                run: async () => {
                  if (detail)
                    accept(
                      workspaceDetailSchema.parse(
                        await call(
                          { action: "get", projectId: detail.project.id },
                          true,
                        ),
                      ),
                    );
                },
              })
            }
          >
            重新读取
          </Button>
          <Button onClick={() => void run(conflictCopy)}>将编辑另存副本</Button>
        </div>
      )}
      {!catalog ? (
        <p className={styles.content}>
          {message ? "当前无法打开工作台。" : "正在读取工作台…"}
        </p>
      ) : (
        <>
          {panel === "templates" && (
            <TemplatePicker
              call={call}
              templates={templates}
              onChoose={(t) => void choose(t)}
              favorites={preferences.favorites}
              recent={preferences.recent}
              onFavorite={(id) => void run(() => updatePreference(id))}
            />
          )}
          {panel === 'examples' && <Examples call={call} templates={templates} busy={busy||rendering||!canGenerate} onExample={async(ids,kit,newDemo)=>{if(busy||rendering)return;setBusy(true);try{await addExamples(ids,kit,newDemo);}finally{setBusy(false);}}} onBundle={addBundle} buildingIds={draft?.context.buildingIds??context.buildingIds} period={draft?.context.period??context.period}/>}
          {panel === "assets" && (
            <div className={styles.content}>
              <AssetPicker
                call={call}
                onAdd={addAssets}
                busy={busy || !canGenerate}
              />
            </div>
          )}
          {panel === "projects" && (
            <Projects call={call} onOpen={open} onCopy={copyProject} />
          )}
          {panel === "admin" && canManage && (
            <Manager
              call={call}
              catalog={catalog}
              session={session}
              onProject={open}
            />
          )}
          {panel === "quick" && !detail && (
            <section className={styles.content}>
              <div className={styles.actions}>
                <Button
                  onClick={() => setCreateOpen(true)}
                  disabled={!canGenerate}
                >
                  <Plus size={16} />
                  新建 Pitch
                </Button>
              </div>
              <div
                className={styles.modeTabs}
                role="tablist"
                aria-label="生成方式"
              >
                {[
                  ["project", "按项目生成"],
                  ["template", "按模板生成"],
                  ["asset", "按素材生成"],
                ].map(([id, label]) => (
                  <button
                    role="tab"
                    aria-selected={quickMode === id}
                    key={id}
                    onClick={() => setQuickMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {quickMode === "project" ? (
                <div className={styles.form}>
                  <label>
                    项目名称
                    <input
                      value={name}
                      maxLength={160}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  {buildingSearch && (
                    <BuildingPicker
                      call={call}
                      ids={context.buildingIds}
                      onChange={(buildingIds) =>
                        setContext((v) => ({ ...v, buildingIds }))
                      }
                    />
                  )}
                  <Button
                    disabled={!canGenerate}
                    onClick={() => setCreateOpen(true)}
                  >
                    选择模板
                  </Button>
                </div>
              ) : quickMode === "asset" ? (
                <AssetPicker
                  call={call}
                  onAdd={addAssets}
                  busy={busy || !canGenerate}
                />
              ) : (
                <TemplatePicker
                  call={call}
                  templates={templates}
                  onChoose={(t) => void choose(t)}
                  favorites={preferences.favorites}
                  recent={preferences.recent}
                  onFavorite={(id) => void run(() => updatePreference(id))}
                  compact
                />
              )}
              <h2>最近编辑</h2>
              <Projects call={call} onOpen={open} onCopy={copyProject} />
            </section>
          )}
          {panel === "quick" && detail && draft && (
            <>
              <header className={styles.projectBar}>
                <IconButton
                  label="返回我的 Pitch"
                  onClick={() => setPanel("projects")}
                >
                  <ArrowLeft size={18} />
                </IconButton>
                <label className={styles.projectName}>
                  <span className={styles.srOnly}>项目名称</span>
                  <input
                    value={draft.title}
                    maxLength={160}
                    onChange={(e) =>
                      edit((d) => ({ ...d, title: e.target.value }))
                    }
                  />
                </label>
                <span role="status" className={styles.saveStatus}>
                  {conflict
                    ? "版本冲突"
                    : saving
                      ? "正在保存…"
                      : dirty
                        ? "待保存"
                        : "已保存"}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy || saving || conflict || !dirty}
                  onClick={() => void flush().catch(() => {})}
                >
                  保存
                </Button>
                <Button variant="ghost" onClick={() => setHistoryOpen(true)}>
                  历史
                </Button>
                <ExportPanel
                  openSignal={exportTrigger}
                  call={call}
                  detail={detail}
                  active={active}
                  selected={selected}
                  flush={flush}
                  canClient={catalog.scopes.some((s) => s.canClientExport)}
                  disabled={busy || conflict || rendering}
                />
              </header>
              <div
                className={styles.mobileTabs}
                role="tablist"
                aria-label="工作区面板"
              >
                {[
                  ["add", "添加内容"],
                  ["preview", "页面预览"],
                  ["edit", "页面编辑"],
                ].map(([id, label]) => (
                  <button
                    role="tab"
                    key={id}
                    aria-selected={mobile === id}
                    onClick={() => setMobile(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.panelTools}>
                <Button
                  variant="ghost"
                  onClick={() => setLeft((v) => !v)}
                  aria-expanded={left}
                >
                  <PanelLeftClose size={16} />
                  {left ? "收起内容" : "添加内容"}
                </Button>
                {left && (
                  <label className={styles.widthControl}>
                    内容区宽度
                    <input
                      type="range"
                      min={220}
                      max={360}
                      step={10}
                      value={width}
                      onChange={(e) => setWidth(+e.target.value)}
                    />
                  </label>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setRight((v) => !v)}
                  aria-expanded={right}
                >
                  <PanelRightClose size={16} />
                  {right ? "收起编辑" : "编辑页面"}
                </Button>
              </div>
              <div
                className={styles.editor}
                style={
                  {
                    "--pitch-left": `${left ? width : 0}px`,
                    "--pitch-right": `${right ? 280 : 0}px`,
                  } as React.CSSProperties
                }
                data-mobile={mobile}
              >
                <aside
                  className={`${styles.left} ${!left ? styles.collapsed : ""}`}
                >
                  <div className={styles.modeTabs}>
                    {[
                      ["templates", "模板"],
                      ["assets", "素材"],
                      ["assist", "辅助"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={leftTab === id}
                        onClick={() => setLeftTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                    <Button
                      variant="ghost"
                      disabled={busy || rendering}
                      onClick={() => {
                        setCustomOpen(true);
                        void call<{ items: typeof media }>(
                          {
                            action: "search",
                            kind: "media",
                            state: "published",
                            validity: "valid",
                          },
                          false,
                          "library",
                        )
                          .then((r) => setMedia(r.items))
                          .catch((e) => setMessage(e.message));
                      }}
                    >
                      自定义
                    </Button>
                  </div>
                  {leftTab === "assist" ? (
                    <AiAssist
                      key={detail.project.id}
                      call={call}
                      projectId={detail.project.id}
                      buildingIds={draft.context.buildingIds}
                      period={draft.context.period}
                      language={draft.context.language}
                      admin={catalog.scopes.some((s) => s.canAdmin)}
                      busy={busy || rendering || conflict}
                      onGenerate={generate}
                      onReload={() => open(detail.project.id)}
                      onExport={() => setExportTrigger((v) => v + 1)}
                    />
                  ) : leftTab === "templates" ? (
                    <TemplatePicker
                      call={call}
                      compact
                      templates={templates}
                      onChoose={(t) => void choose(t)}
                      favorites={preferences.favorites}
                      recent={preferences.recent}
                      onFavorite={(id) => void run(() => updatePreference(id))}
                    />
                  ) : (
                    <AssetPicker
                      call={call}
                      onAdd={addAssets}
                      busy={busy || rendering}
                    />
                  )}
                </aside>
                <div className={styles.center}>
                  {page ? (
                    <PagePreview
                      src={previews.images[page.id]}
                      error={previews.errors[page.id]}
                      title={pageEdit?.title ?? page.content.title}
                      pending={dirty || saving}
                      onRetry={previews.retry}
                    />
                  ) : (
                    <div className={styles.empty}>
                      <h2>添加第一张页面</h2>
                      <p>选择模板、企业素材，或添加自定义图文。</p>
                      <Button
                        onClick={() => {
                          setLeft(true);
                          setMobile("add");
                        }}
                      >
                        添加内容
                      </Button>
                    </div>
                  )}
                </div>
                <aside
                  className={`${styles.right} ${!right ? styles.collapsed : ""}`}
                >
                  {chosen ? (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setChosen(null);
                          setRegenerating(false);
                        }}
                      >
                        返回页面编辑
                      </Button>
                      <TemplateParameters
                        key={chosen.id + ":" + String(regenerating)}
                        call={call}
                        template={chosen}
                        buildingIds={draft.context.buildingIds}
                        period={draft.context.period}
                        busy={rendering || busy || conflict}
                        onGenerate={generate}
                        initial={
                          regenerating && page
                            ? (detail.workspace.page_settings[page.id]?.part as
                                | Generation["parts"][number]
                                | undefined)
                            : undefined
                        }
                      />
                    </>
                  ) : (
                    <div className={styles.form}>
                      {page && (
                        <>
                          <h2>当前页面</h2>
                          <Button
                            variant="ghost"
                            disabled={busy || rendering || conflict}
                            onClick={() =>
                              void run(async () => {
                                const saved = await flush();
                                await call(
                                  {
                                    action: "submit_candidate",
                                    projectId: saved.project.id,
                                    slideId: page.id,
                                    expectedVersion: saved.project.version,
                                    candidateId: crypto.randomUUID(),
                                  },
                                  true,
                                  "ai",
                                );
                                setMessage(
                                  "已主动提交给素材管理员；原 Pitch 仍为私人项目。",
                                );
                              })
                            }
                          >
                            推荐为企业素材
                          </Button>
                          <label>
                            页面标题
                            <input
                              value={pageEdit?.title ?? page.content.title}
                              maxLength={160}
                              onChange={(e) =>
                                editPage({ title: e.target.value })
                              }
                            />
                          </label>
                          {page.content.blocks.some(
                            (b) => b.kind === "paragraph",
                          ) && (
                            <>
                              <p>
                                {detail.workspace.page_settings[page.id]
                                  ?.origin === "data"
                                  ? "正式数据保持绑定，正文改写将标为用户输入。"
                                  : "正文改写仅保存到此 Pitch。"}
                              </p>
                              {(page.scene.pagination?.count ?? 1) > 1 ? (
                                <p>
                                  此内容已分页。请在素材库修改后重新生成整组。
                                </p>
                              ) : (
                                page.content.blocks
                                  .filter((b) => b.kind === "paragraph")
                                  .map((b, i) => (
                                    <label key={i}>
                                      正文 {i + 1}
                                      <textarea
                                        rows={5}
                                        maxLength={4000}
                                        value={
                                          pageEdit?.paragraphs?.[i] ?? b.text
                                        }
                                        onChange={(e) => {
                                          const paragraphs =
                                            pageEdit?.paragraphs ??
                                            page.content.blocks.flatMap((b) =>
                                              b.kind === "paragraph"
                                                ? [b.text]
                                                : [],
                                            );
                                          editPage({
                                            paragraphs: paragraphs.map(
                                              (p, n) =>
                                                n === i ? e.target.value : p,
                                            ),
                                          });
                                        }}
                                      />
                                    </label>
                                  ))
                              )}
                            </>
                          )}
                          {page.content.blocks.some(
                            (b) => b.kind === "image",
                          ) && (
                            <details
                              onToggle={(e) => {
                                if (e.currentTarget.open)
                                  void call<{ items: typeof media }>(
                                    {
                                      action: "search",
                                      kind: "media",
                                      state: "published",
                                      validity: "valid",
                                    },
                                    false,
                                    "library",
                                  )
                                    .then((r) => setMedia(r.items))
                                    .catch((e) => setMessage(e.message));
                              }}
                            >
                              <summary>更换图片</summary>
                              {page.content.blocks
                                .filter((b) => b.kind === "image")
                                .map((b, i) => (
                                  <label key={i}>
                                    项目图片 {i + 1}
                                    <select
                                      value={
                                        pageEdit?.images?.[i]?.id ??
                                        b.mediaAssetId
                                      }
                                      onChange={(e) => {
                                        const selected = media.find(
                                          (m) => m.id === e.target.value,
                                        );
                                        if (selected) {
                                          const images =
                                            pageEdit?.images ??
                                            page.content.blocks.flatMap((b) =>
                                              b.kind === "image"
                                                ? [
                                                    {
                                                      id: b.mediaAssetId,
                                                      version: b.mediaVersion,
                                                      alt: b.alt.slice(0, 400),
                                                    },
                                                  ]
                                                : [],
                                            );
                                          editPage({
                                            images: images.map((v, n) =>
                                              n === i
                                                ? {
                                                    id: selected.id,
                                                    version: selected.version,
                                                    alt: selected.alt.slice(
                                                      0,
                                                      400,
                                                    ),
                                                  }
                                                : v,
                                            ),
                                          });
                                        }
                                      }}
                                    >
                                      <option value={b.mediaAssetId}>
                                        当前图片
                                      </option>
                                      {media
                                        .filter((m) => m.id !== b.mediaAssetId)
                                        .map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.alt || "企业图片"}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                ))}
                            </details>
                          )}
                          <label>
                            页面布局
                            <select
                              value={pageEdit?.layoutId ?? page.scene.layoutId}
                              onChange={(e) =>
                                editPage({
                                  layoutId: e.target.value as LayoutId,
                                  variant: "standard",
                                })
                              }
                            >
                              {LAYOUTS.filter((l) =>
                                page.content.blocks.every((b) =>
                                  l.kinds.includes(b.kind),
                                ),
                              ).map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.zh}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            布局变体
                            <select
                              value={
                                pageEdit?.variant ??
                                page.scene.variant ??
                                "standard"
                              }
                              onChange={(e) =>
                                editPage({
                                  variant: e.target.value as
                                    | "standard"
                                    | "alternate",
                                })
                              }
                            >
                              <option value="standard">标准</option>
                              {!PATTERN_BY_ID.has(pageEdit?.layoutId??page.scene.layoutId)&&<option value="alternate">替换布局</option>}
                            </select>
                          </label>
                          {detail.workspace.page_settings[page.id]?.part && !detail.workspace.page_settings[page.id]?.example && !detail.workspace.page_settings[page.id]?.kit && (
                            <Button
                              variant="secondary"
                              disabled={rendering || dirty || busy}
                              onClick={() => {
                                const part = detail.workspace.page_settings[
                                  page.id
                                ].part as Generation["parts"][number];
                                const id =
                                  part.mode === "dynamic"
                                    ? part.parameters.templateId
                                    : part.templateId;
                                setChosen(
                                  templates.find((t) => t.id === id) ?? null,
                                );
                                setRegenerating(true);
                              }}
                            >
                              调整参数并重新生成
                            </Button>
                          )}
                          <details>
                            <summary>数据与来源</summary>
                            <p>数据截至 {page.content.dataAsOf}</p>
                            <p>
                              {detail.workspace.page_settings[page.id]?.manual
                                ? "含用户输入，仅供内部使用"
                                : "内容来自已授权素材或业务数据"}
                            </p>
                            <ul>
                              {page.content.sources.map((s) => (
                                <li key={s.id}>
                                  {s.label} · {s.locator} · {s.dataAsOf}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </>
                      )}
                      <details>
                        <summary>项目设置</summary>
                        <div className={styles.form}>
                          <label>
                            设计主题
                            <select
                              value={JSON.stringify([
                                draft.themeId,
                                draft.themeVersion,
                              ])}
                              onChange={(e) => {
                                const [themeId, themeVersion] = JSON.parse(
                                  e.target.value,
                                ) as [string, number];
                                edit((d) => ({ ...d, themeId, themeVersion }));
                              }}
                            >
                              {catalog.themes.map((t) => (
                                <option
                                  key={t.id}
                                  value={JSON.stringify([
                                    t.id,
                                    t.current_version,
                                  ])}
                                >
                                  {themeLabel(t.id)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <ContextFields
                            buildingSearch={buildingSearch}
                            call={call}
                            value={draft.context}
                            onChange={(value) =>
                              edit((d) => ({ ...d, context: value }))
                            }
                          />
                        </div>
                      </details>
                    </div>
                  )}
                </aside>
              </div>
              {task && (
                <div role="status" className={styles.task}>
                  {rendering ? (
                    <>
                      <span>
                        {readingResult
                          ? "页面已生成，正在读取结果"
                          : task.state === "queued"
                            ? "页面正在排队"
                            : "正在生成页面，原页面可继续查看"}
                      </span>
                      {!readingResult && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void run(async () => {
                              const r = await call<typeof task>(
                                {
                                  action: "cancel",
                                  projectId: detail.project.id,
                                  taskId: task.id,
                                },
                                true,
                              );
                              setTask(r);
                            })
                          }
                        >
                          取消生成
                        </Button>
                      )}
                      {taskPollFailed && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setTaskPollFailed(false);
                            setMessage("");
                            setTask({ ...task });
                          }}
                        >
                          重新查询生成进度
                        </Button>
                      )}
                    </>
                  ) : task.state === "failed" ? (
                    <>
                      <span>
                        生成未完成，原页面已保留。
                        {task.error_code === "PITCH_CONFLICT"
                          ? "项目已更新，请按最新参数重新生成。"
                          : ""}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={(task.attempts ?? 0) >= 3}
                        onClick={() =>
                          void run(async () => {
                            const r = await call<typeof task>(
                              {
                                action: "retry",
                                projectId: detail.project.id,
                                taskId: task.id,
                              },
                              true,
                            );
                            setTask(r);
                          })
                        }
                      >
                        重试生成
                      </Button>
                    </>
                  ) : task.state === "cancelled" ? (
                    <span>生成已取消，原页面保留。</span>
                  ) : null}
                </div>
              )}
              <section className={styles.basket} aria-label="Pitch 页面">
                <div className={styles.actions}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={
                        draft.pages.length > 0 &&
                        selected.length === draft.pages.length
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? draft.pages.map((p) => p.id) : [],
                        )
                      }
                    />
                    全选
                  </label>
                  <span>{draft.pages.length} 页</span>
                  <Button
                    variant="ghost"
                    disabled={!selected.length}
                    onClick={() => void remove(selected)}
                  >
                    <Trash2 size={16} />
                    删除选中
                  </Button>
                  {detail.history[0] && (
                    <Button
                      variant="ghost"
                      disabled={busy || dirty || rendering}
                      onClick={() =>
                        void run(async () => {
                          accept(
                            workspaceDetailSchema.parse(
                              await call(
                                {
                                  action: "restore",
                                  projectId: detail.project.id,
                                  expectedVersion: detail.project.version,
                                  revision: detail.history[0].version,
                                },
                                true,
                              ),
                            ),
                          );
                        })
                      }
                    >
                      撤销上次保存
                    </Button>
                  )}
                </div>
                <ol className={styles.ribbon}>
                  {draft.pages.map((p, i) => {
                    const original = detail.slides.find(
                      (s) => s.id === (p.duplicateOf ?? p.id),
                    );
                    return (
                      <li
                        key={p.id}
                        data-active={active === p.id}
                        draggable={!busy && !rendering}
                        onDragStart={() => {
                          drag.current = p.id;
                        }}
                        onDragEnd={() => {
                          drag.current = null;
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (drag.current) reorder(drag.current, i);
                        }}
                      >
                        <div className={styles.thumbHeader}>
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              aria-label={`选择第 ${i + 1} 页`}
                              checked={selected.includes(p.id)}
                              onChange={(e) =>
                                setSelected((v) =>
                                  e.target.checked
                                    ? [...v, p.id]
                                    : v.filter((id) => id !== p.id),
                                )
                              }
                            />
                            {i + 1}
                          </label>
                          <IconButton
                            label={`复制第 ${i + 1} 页`}
                            onClick={() =>
                              edit((d) => ({
                                ...d,
                                pages: [
                                  ...d.pages.slice(0, i + 1),
                                  {
                                    ...p,
                                    id: crypto.randomUUID(),
                                    duplicateOf: p.duplicateOf ?? p.id,
                                  },
                                  ...d.pages.slice(i + 1),
                                ],
                              }))
                            }
                          >
                            <Copy size={14} />
                          </IconButton>
                        </div>
                        <button
                          className={styles.thumbButton}
                          aria-label={`打开第 ${i + 1} 页：${p.title ?? original?.content.title ?? "页面"}`}
                          aria-current={active === p.id ? "page" : undefined}
                          onClick={() =>
                            edit((d) => ({ ...d, activeSlide: p.id }))
                          }
                          onKeyDown={(e) => {
                            if (
                              e.altKey &&
                              [
                                "ArrowLeft",
                                "ArrowUp",
                                "ArrowRight",
                                "ArrowDown",
                              ].includes(e.key)
                            ) {
                              e.preventDefault();
                              reorder(
                                p.id,
                                i +
                                  (["ArrowLeft", "ArrowUp"].includes(e.key)
                                    ? -1
                                    : 1),
                              );
                            }
                          }}
                        >
                          {previews.images[p.duplicateOf ?? p.id] ? (
                            <img
                              src={previews.images[p.duplicateOf ?? p.id]}
                              alt=""
                            />
                          ) : (
                            <span>预览加载中</span>
                          )}
                          <span>
                            {p.title ?? original?.content.title ?? "新页面"}
                          </span>
                        </button>
                        <div className={styles.thumbMoves}>
                          <IconButton
                            label={`前移第 ${i + 1} 页`}
                            disabled={i === 0}
                            onClick={() => reorder(p.id, i - 1)}
                          >
                            <ArrowUp size={14} />
                          </IconButton>
                          <IconButton
                            label={`后移第 ${i + 1} 页`}
                            disabled={i === draft.pages.length - 1}
                            onClick={() => reorder(p.id, i + 1)}
                          >
                            <ArrowDown size={14} />
                          </IconButton>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </>
          )}
        </>
      )}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建 Pitch"
        size="md"
        footer={
          <Button
            disabled={busy || !name.trim() || !grants.length}
            onClick={() =>
              void run(async () => {
                const g = grants[scopeIndex] ?? grants[0],
                  value = workspaceDetailSchema.parse(
                    await call(
                      {
                        action: "create",
                        projectId: crypto.randomUUID(),
                        title: name.trim(),
                        scope: {
                          organizationId: g.organizationId,
                          region: g.region,
                          city: g.city,
                          businessLine: g.businessLine,
                        },
                        themeId: "colliers-default-v1",
                        themeVersion: 2,
                        context,
                      },
                      true,
                    ),
                  );
                accept(value);
                setCreateOpen(false);
                setPanel("quick");
                setMobile(chosen ? "edit" : "add");
                setName("");
              })
            }
          >
            创建
          </Button>
        }
      >
        <div className={`${styles.studio} ${styles.form}`}>
          <label>
            Pitch 名称
            <input
              autoFocus
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            所属区域
            <select
              value={scopeIndex}
              onChange={(e) => setScopeIndex(+e.target.value)}
            >
              {grants.map((g, i) => (
                <option key={i} value={i}>
                  {g.region} · {g.city} · {g.businessLine}
                </option>
              ))}
            </select>
          </label>
          <label>
            语言
            <select
              value={context.language}
              onChange={(e) =>
                setContext((v) => ({
                  ...v,
                  language: e.target.value as "zh" | "en",
                }))
              }
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <details>
            <summary>更多项目设置（可选）</summary>
            <ContextFields
              buildingSearch={buildingSearch}
              call={call}
              value={context}
              onChange={setContext}
            />
          </details>
          {!grants.length && <p>当前没有可生成页面的区域授权。</p>}
        </div>
      </Dialog>
      <Dialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        title="添加自定义图文"
        footer={
          <Button
            disabled={busy || !custom.title.trim() || !custom.body.trim()}
            onClick={() =>
              void run(async () => {
                const saved = await flush();
                accept(
                  workspaceDetailSchema.parse(
                    await call(
                      {
                        action: "custom",
                        projectId: saved.project.id,
                        expectedVersion: saved.project.version,
                        title: custom.title,
                        body: custom.body,
                        ...(custom.imageId
                          ? {
                              image: {
                                id: custom.imageId,
                                version: custom.imageVersion,
                                alt:
                                  media.find((m) => m.id === custom.imageId)
                                    ?.alt ?? "用户选择图片",
                              },
                            }
                          : {}),
                      },
                      true,
                    ),
                  ),
                );
                setCustomOpen(false);
                setCustom({
                  title: "",
                  body: "",
                  imageId: "",
                  imageVersion: 1,
                });
              })
            }
          >
            添加页面
          </Button>
        }
      >
        <div className={`${styles.studio} ${styles.form}`}>
          <label>
            自定义标题
            <input
              value={custom.title}
              maxLength={160}
              onChange={(e) =>
                setCustom((v) => ({ ...v, title: e.target.value }))
              }
            />
          </label>
          <label>
            自定义正文
            <textarea
              rows={8}
              maxLength={12000}
              value={custom.body}
              onChange={(e) =>
                setCustom((v) => ({ ...v, body: e.target.value }))
              }
            />
          </label>
          <label>
            配图（可选）
            <select
              value={custom.imageId}
              onChange={(e) =>
                setCustom((v) => ({
                  ...v,
                  imageId: e.target.value,
                  imageVersion:
                    media.find((m) => m.id === e.target.value)?.version ?? 1,
                }))
              }
            >
              <option value="">无配图</option>
              {media.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.alt || "企业图片"}
                </option>
              ))}
            </select>
          </label>
          <p>内容标为用户输入，仅保存到当前 Pitch，默认仅供内部使用。</p>
        </div>
      </Dialog>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={confirmation?.title ?? "确认操作"}
        footer={
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await confirmation?.run();
                setConfirmation(null);
              })
            }
          >
            继续
          </Button>
        }
      >
        <p className={styles.studio}>{confirmation?.body}</p>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen} title="历史版本">
        <ul className={`${styles.studio} ${styles.rows}`}>
          {detail?.history.map((h) => (
            <li key={h.version}>
              <span>
                {new Date(h.created_at).toLocaleString("zh-CN")} · 版本{" "}
                {h.version}
              </span>
              <Button
                disabled={busy || dirty || rendering}
                variant="secondary"
                onClick={() =>
                  void run(async () => {
                    if (detail)
                      accept(
                        workspaceDetailSchema.parse(
                          await call(
                            {
                              action: "restore",
                              projectId: detail.project.id,
                              expectedVersion: detail.project.version,
                              revision: h.version,
                            },
                            true,
                          ),
                        ),
                      );
                    setHistoryOpen(false);
                  })
                }
              >
                恢复
              </Button>
            </li>
          ))}
        </ul>
        {!detail?.history.length && <p>保存编辑后可恢复历史版本。</p>}
      </Dialog>
    </div>
  );
}
function ContextFields({
  call,
  value,
  onChange,
  buildingSearch,
}: {
  buildingSearch: boolean;
  call: Call;
  value: Draft["context"];
  onChange: (value: Draft["context"]) => void;
}) {
  return (
    <div className={styles.form}>
      {buildingSearch && (
        <BuildingPicker
          call={call}
          ids={value.buildingIds}
          onChange={(buildingIds) => onChange({ ...value, buildingIds })}
        />
      )}{" "}
      {[
        ["client", "客户名称"],
        ["business", "业务类型"],
        ["period", "默认季度"],
      ].map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            placeholder={key === "period" ? "2026-Q3" : undefined}
            value={value[key as "client" | "business" | "period"]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        页面语言
        <select
          value={value.language}
          onChange={(e) =>
            onChange({ ...value, language: e.target.value as "zh" | "en" })
          }
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        项目说明
        <textarea
          rows={3}
          value={value.notes}
          maxLength={2000}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </label>
    </div>
  );
}
