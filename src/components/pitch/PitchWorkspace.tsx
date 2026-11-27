"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
  Maximize,
  Minimize,
  Undo2,
  Redo2,
  Sparkles,
  Star,
  Ellipsis,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FilePlus2,
  Images,
  Layers,
  Link2,
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
  type OutlinePart,
  type WorkspaceCommand,
} from "@/src/lib/pitch/workspace/protocol";
import {
  recipeSchema,
  type Generation,
} from "@/src/lib/pitch/business/protocol";
import { ECOSYSTEM_BY_ID } from '@/src/lib/pitch/templates/ecosystem';
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
import { readPitchHandoff, type PitchHandoffNavigation } from "./PitchHandoffLink";
import { HandoffReview, type HandoffDestination } from "./workspace/HandoffReview";
import { LayoutVariants } from "./workspace/LayoutVariants";
import { DataRefresh } from "./workspace/DataRefresh";
import { CurrentPageRevision } from "./workspace/CurrentPageRevision";
import { ImageReplacement, libraryImagesForReplacement } from "./workspace/ImageReplacement";
import { PhotoReplacementPicker } from "./workspace/PhotoReplacementPicker";
import { pinnedBuildingPhoto } from "./workspace/PhotoRevisionReview";
import { AssetPicker, pitchAssetDragType, readAssetTransfer } from "./workspace/Assets";
import { PagePreview, usePagePreviews } from "./workspace/Preview";
import { Projects } from "./workspace/Projects";
import { PanelSeparator } from "./workspace/PanelSeparator";
import { SlideNavigator } from "./workspace/SlideNavigator";
import { Presentation } from "./workspace/Presentation";
import { ProposalPreview, type ProposalProjectInput } from "./workspace/ProposalPreview";
import { canMoveObject, objectId } from "@/src/lib/pitch/workspace/object-layout";
const ObjectCanvas = dynamic(() => import("./workspace/ObjectCanvas").then(module => module.ObjectCanvas), {
  loading: () => <p role="status">正在打开对象编辑…</p>,
});
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
type Panel = "home" | "examples" | "quick" | "templates" | "assets" | "projects" | "admin";
const mobilePanes = [
  ["pages", "页面"],
  ["add", "添加内容"],
  ["preview", "页面预览"],
  ["edit", "页面编辑"],
] as const;
type MobilePane = (typeof mobilePanes)[number][0];
type Inspector = "properties" | "data" | "assets" | "design" | "assist";
const inspectorTabs: { id: Inspector; label: string }[] = [
  { id: "properties", label: "属性" },
  { id: "data", label: "数据" },
  { id: "assets", label: "素材" },
  { id: "design", label: "设计" },
  { id: "assist", label: "AI" },
];
type OutlineStart = Extract<WorkspaceCommand, { action: "start" }> & { part: OutlinePart };
type TaskReceipt = { id: string; state: string; attempts?: number; error_code?: string; stage?: string };
type WorkspaceTask = TaskReceipt & { outline?: boolean; unconfirmed?: OutlineStart; revisionBase?: number };
type SavedCanvasHistory = {
  projectId: string;
  slideId: string;
  version: number;
  undo: number[];
  redo: number[];
};
const tabs: { id: Panel; label: string }[] = [
  { id: "home", label: "工作台" },
  { id: "projects", label: "我的 Pitch" },
  { id: "templates", label: "模板库" },
  { id: "assets", label: "素材库" },
  { id: "examples", label: "示例与套装" },
  { id: "admin", label: "管理中心" },
];
const proposalStarts = [
  { title: "招商代理", question: "为霄云路33号制作招商代理提案。" },
  { title: "办公选址对比", question: "制作CBD五个甲级写字楼的选址对比。" },
  { title: "季度市场报告", question: "用最新正式季度制作北京写字楼市场报告。" },
  { title: "单楼项目推介", question: "为五矿广场制作项目推介。" },
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
  const [panel, setPanel] = React.useState<Panel>("home"),
    [catalog, setCatalog] = React.useState<Catalog | null>(null),
    [templates, setTemplates] = React.useState<Template[]>([]),
    [templateCategory, setTemplateCategory] = React.useState<"all" | "favorites">("all"),
    [handoff, setHandoff] = React.useState<(PitchHandoffNavigation & { destination?: HandoffDestination }) | null>(null),
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
    [busy, setBusy] = React.useState(false),
    [addingAssets, setAddingAssets] = React.useState(false);
  const assetSubmit = React.useRef(false);
  const [exportTrigger, setExportTrigger] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false),
    [name, setName] = React.useState(""),
    [context, setContext] = React.useState(projectContextSchema.parse({})),
    [scopeIndex, setScopeIndex] = React.useState(0),
    [brief, setBrief] = React.useState(""),
    [homeProposal, setHomeProposal] = React.useState(""),
    [homeGenerating, setHomeGenerating] = React.useState(false),
    [assistSeed, setAssistSeed] = React.useState(""),
    [createFromBrief, setCreateFromBrief] = React.useState(false),
    [buildingSearch, setBuildingSearch] = React.useState(false);
  const [dataBuildingsOpen, setDataBuildingsOpen] = React.useState(false);
  const [refreshSuggestion, setRefreshSuggestion] = React.useState<{ projectId: string; period: string }>();
  const suggestedPeriod = refreshSuggestion && refreshSuggestion.projectId === detail?.project.id
    ? refreshSuggestion.period : undefined;
  const [left, setLeft] = React.useState(true),
    [right, setRight] = React.useState(true),
    [mobile, setMobile] = React.useState<MobilePane>("preview"),
    [leftWidth, setLeftWidth] = React.useState(208),
    [rightWidth, setRightWidth] = React.useState(304),
    [focusedCanvas, setFocusedCanvas] = React.useState(false),
    [leftTab, setLeftTab] = React.useState("pages"),
    [inspector, setInspector] = React.useState<Inspector>("properties"),
    [assistOpened, setAssistOpened] = React.useState(false),
    [pageRevisionBatches, setPageRevisionBatches] = React.useState<Record<string, string>>({}),
    [chosen, setChosen] = React.useState<Template | null>(null),
    [regenerating, setRegenerating] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]),
    [task, setTask] = React.useState<WorkspaceTask | null>(null),
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
    [historyOpen, setHistoryOpen] = React.useState(false),
    [objectPage, setObjectPage] = React.useState<string | null>(null),
    [objectSelection, setObjectSelection] = React.useState<{ ids: string[]; dirty: boolean }>({ ids: [], dirty: false }),
    [imageTarget, setImageTarget] = React.useState<{ slideId: string; index: number; openId: number }>(),
    [photoTarget, setPhotoTarget] = React.useState<{ projectId: string; version: number; pageId: string; objectId: string }>(),
    [reviewUndo, setReviewUndo] = React.useState<{ version: number; revision: number; projectId: string }>(),
    [savedCanvasHistory, setSavedCanvasHistory] = React.useState<SavedCanvasHistory | null>(null);
  const life = React.useRef(new AbortController()),
    current = React.useRef({ detail, draft, dirty }),
    pending = React.useRef<Promise<WorkspaceDetail> | null>(null),
    draftSequence = React.useRef(0);
  const shortcutMenu = React.useRef<HTMLDivElement>(null);
  const shortcutTrigger = React.useRef<HTMLButtonElement>(null);
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
    const work = value.tasks.find(t => t.state === "queued" || t.state === "processing") ?? value.tasks[0];
    setTask(previous => {
      const receipt = work && {
        id: String(work.id), state: String(work.state), attempts: Number(work.attempts),
        error_code: typeof work.error_code === "string" ? work.error_code : undefined,
        stage: typeof work.stage === "string" ? work.stage : undefined,
        outline: previous?.id === work.id && previous?.outline,
      };
      if (previous?.unconfirmed?.projectId === value.project.id && receipt?.id !== previous.id) return previous;
      return receipt && (receipt.state !== "completed" || receipt.outline) ? receipt : null;
    });
  }, []);
  React.useEffect(() => {
    const incoming = readPitchHandoff(window.location.hash);
    if (!incoming) return;
    const timer = setTimeout(() => {
      setHandoff(incoming);
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }, 0);
    return () => clearTimeout(timer);
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
        const edited = value.draft.pages.filter(page => !!(page.objectMoves || page.objectTexts || page.objectOrder || page.objectGroups));
        if (edited.length === 1 && !edited[0].duplicateOf) {
          const slideId = edited[0].id, from = value.detail.project.version;
          setSavedCanvasHistory(previous => ({
            slideId, projectId: saved.project.id, version: saved.project.version,
            undo: [
              ...(previous?.projectId === saved.project.id && previous.slideId === slideId && previous.version === from
                ? previous.undo : []),
              from,
            ].slice(-12),
            redo: [],
          }));
        } else {
          // Navigation and metadata saves can retain history; content/geometry changes
          // on that page or an external version change invalidate it.
          setSavedCanvasHistory(previous => {
            if (!previous || previous.projectId !== saved.project.id || previous.version !== value.detail?.project.version)
              return null;
            const before = value.detail.slides.find(slide => slide.id === previous.slideId);
            const after = saved.slides.find(slide => slide.id === previous.slideId);
            return before && after && JSON.stringify(before) === JSON.stringify(after)
              ? { ...previous, version: saved.project.version } : null;
          });
        }

        if (sequence === draftSequence.current) accept(saved);
        else {
          setDetail(saved);
          current.current = { ...current.current, detail: saved };
        }
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
    setLeftTab("pages");
    setAssistSeed("");
    setAssistOpened(false);
    setInspector("properties");
    setFocusedCanvas(false);
    setObjectPage(null);
    setImageTarget(undefined);
    setPhotoTarget(undefined);
  };
  async function copyProjectLink(id: string) {
    const url = new URL("/intelligence/pitch", window.location.origin);
    url.searchParams.set("project", id);
    await navigator.clipboard.writeText(url.toString());
    setMessage("已复制项目链接。项目权限未更改。");
  }
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
      setFocusedCanvas(false);
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
    if (ids.some((id) => saved.workspace.page_settings[id]?.manual || saved.slides.find(slide => slide.id === id)?.scene.elements.some(element => element.editorId))) {
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
          stage?: string;
        }>(
          { action: "status", projectId, taskId: id },
          true,
          "workspace",
          c.signal,
        )
          .then(async (receipt) => {
            if (c.signal.aborted) return;
            const result: WorkspaceTask = { ...receipt, outline: task.outline, revisionBase: task.revisionBase };
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
                const before = current.current.detail;
                accept(saved);
                if (result.revisionBase !== undefined && before?.project.version === result.revisionBase &&
                  saved.project.version === result.revisionBase + 1) {
                  setReviewUndo({ projectId, version: saved.project.version, revision: result.revisionBase });
                }
                setTask(result);
                setChosen(null);
                setRegenerating(false);
                setMobile("preview");
                if (result.outline) {
                  setLeftTab("pages");
                  setInspector("properties");
                }
                setMessage(result.outline ? "" : result.revisionBase === undefined ? "页面已生成并保存。" : "竞品对比页已追加。");
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
    libraryImages = page ? libraryImagesForReplacement(page) : null,
    pictureTarget = imageTarget?.slideId === active ? imageTarget : undefined,
    previews = usePagePreviews(call, detail, active),
    canGenerate = catalog?.scopes.some((s) => s.canGenerate) ?? false,
    canManage =
      catalog?.scopes.some((s) => s.canMaintain || s.canAdmin) ?? false;
  const canvasRevisionTarget = detail && page && active === page.id && page.content.disclosure === "internal" &&
    !dirty && !saving && !detail.workspace.page_settings[page.id]?.manual &&
    detail.workspace.page_settings[page.id]?.origin !== "data" && !detail.workspace.page_settings[page.id]?.example &&
    !page.scene.elements.some(element => element.editorId) && (page.scene.pagination?.count ?? 1) === 1 ? {
      projectId: detail.project.id, slideId: page.id, expectedVersion: detail.project.version,
      assetId: page.asset_id, assetVersion: page.asset_version,
    } : undefined;
  const savedCanvas = savedCanvasHistory?.projectId === detail?.project.id &&
    savedCanvasHistory?.version === detail?.project.version && savedCanvasHistory?.slideId === active
    ? savedCanvasHistory : null;
  async function restoreCanvas(direction: "undo" | "redo") {
    if (!savedCanvas || !detail || current.current.dirty || saving || pending.current) return;
    const revision = savedCanvas[direction].at(-1);
    if (revision === undefined) return;
    await run(async () => {
      const base = detail.project.version, sequence = draftSequence.current;
      const result = workspaceDetailSchema.parse(await call({
        action: "restore_page", projectId: detail.project.id, slideId: savedCanvas.slideId,
        expectedVersion: base, revision,
      }, true));
      if (current.current.detail?.project.id !== result.project.id) return;
      if (draftSequence.current !== sequence || current.current.dirty) {
        // Keep concurrent edits instead of replacing them with the response.
        setSavedCanvasHistory(null);
        setConflict(true);
        setMessage("页面历史已更新。另有尚未保存的编辑，请重新读取或另存副本。");
        return;
      }
      accept(result);
      setSavedCanvasHistory({
        ...savedCanvas, version: result.project.version,
        undo: direction === "undo" ? savedCanvas.undo.slice(0, -1) : [...savedCanvas.undo, base].slice(-12),
        redo: direction === "redo" ? savedCanvas.redo.slice(0, -1) : [...savedCanvas.redo, base].slice(-12),
      });
    });
  }
  const grants =
    catalog?.scopes.filter(
      (s) => s.canGenerate && s.region && s.city && s.businessLine,
    ) ?? [];
  const homeGrant = grants.length === 1 ? grants[0] : undefined;
  const slidesForDisplay = draft?.pages.map((p) => {
    const sourceId = p.duplicateOf ?? p.id;
    const source = detail?.slides.find((slide) => slide.id === sourceId);
    return {
      id: p.id,
      title: p.title ?? source?.content.title ?? "新页面",
      image: previews.images[sourceId],
      error: previews.errors[sourceId],
      section: (p.layoutId ?? source?.scene.layoutId) === "section-divider",
    };
  }) ?? [];
  function createBrief(question: string) {
    const request = question.trim();
    if (!request || !canGenerate) return;
    setChosen(null);
    setBrief(request);
    if (homeGrant) setHomeProposal(request);
    else openBriefProjectSettings(request);
  }
  function openBriefProjectSettings(request: string) {
    setHomeProposal("");
    setCreateFromBrief(true);
    setName(request.replace(/[。！？!?]+$/u, "").slice(0, 160));
    setContext(projectContextSchema.parse({}));
    setCreateOpen(true);
  }
  async function createHomeProposalProject(input: ProposalProjectInput) {
    if (!homeGrant?.region || !homeGrant.city || !homeGrant.businessLine)
      throw new Error("业务范围已变化，请打开项目设置。");
    if (current.current.dirty) await flush();
    const scope = { organizationId: homeGrant.organizationId, region: homeGrant.region,
      city: homeGrant.city, businessLine: homeGrant.businessLine };
    const theme = input.theme ?? { id: "colliers-default-v1", version: 2 };
    let source: WorkspaceDetail;
    try {
      source = workspaceDetailSchema.parse(await call({
        action: "create", projectId: input.id, title: input.title, scope,
        themeId: theme.id, themeVersion: theme.version,
        context: projectContextSchema.parse({ language: input.language, buildingIds: input.buildingIds, period: input.period }),
      }, true));
    } catch (cause) {
      // A lost create response can be recovered from the same private workspace ID.
      try {
        source = workspaceDetailSchema.parse(await call({ action: "get", projectId: input.id }, true));
      } catch {
        throw cause;
      }
    }
    if (source.project.id !== input.id || source.slides.length ||
      source.project.theme_id !== theme.id || source.project.theme_version !== theme.version)
      throw new Error("提案项目已变化，请重新核对。");
    return { id: source.project.id, version: source.project.version };
  }
  function openInspector(tab: Inspector) {
    setChosen(null);
    setRegenerating(false);
    setFocusedCanvas(false);
    setRight(true);
    setMobile("edit");
    setInspector(tab);
    if (tab === "assist") setAssistOpened(true);
  }
  function acceptReviewedChange(result: WorkspaceDetail, expectedVersion: number, feedback: string) {
    if (current.current.detail?.project.id !== result.project.id) return;
    if (current.current.dirty || current.current.detail.project.version !== expectedVersion) {
      setConflict(true);
      setMessage("修改已保存。当前编辑仍保留，可重新读取项目或另存副本。");
      return;
    }
    accept(result);
    if (result.project.version !== expectedVersion) {
      setReviewUndo({ version: result.project.version, revision: expectedVersion, projectId: result.project.id });
    }
    setMessage(feedback);
  }
  function changeMobilePane(id: MobilePane) {
    setFocusedCanvas(false);
    if (id === "pages") setLeftTab("pages");
    if (id === "add") setLeftTab("templates");
    setMobile(id);
  }
  function openCanvas() {
    setMobile("preview");
    setFocusedCanvas((value) => !value);
  }
  function openCustomPage() {
    setCustomOpen(true);
    void call<{ items: typeof media }>({
      action: "search", kind: "media", state: "published", validity: "valid",
    }, false, "library")
      .then((result) => setMedia(result.items))
      .catch((error) => setMessage(error.message));
  }
  function fromProjectMenu(action: () => void) {
    shortcutMenu.current?.hidePopover?.();
    shortcutTrigger.current?.focus();
    action();
  }
  const rendering = !!task && ["queued", "processing"].includes(task.state);
  const generationPending = rendering || !!task?.unconfirmed;
  const editPage = (change: Partial<WorkspaceSave["pages"][number]>) => {
    if (active)
      edit((d) => ({
        ...d,
        pages: d.pages.map((p) => (p.id === active ? { ...p, ...change } : p)),
      }));
  };
  async function addAssets(ids: string[], layout: LayoutId) {
    if (assetSubmit.current || busy || generationPending || conflict) throw new Error("请先完成当前项目操作。");
    assetSubmit.current = true;
    setAddingAssets(true);
    try {
      await composeAssets(ids, layout);
    } finally {
      assetSubmit.current = false;
      setAddingAssets(false);
    }
  }
  async function composeAssets(ids: string[], layout: LayoutId) {
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
    const result = workspaceDetailSchema.parse(await call({
      action: "append",
      projectId: saved.project.id,
      expectedVersion: saved.project.version,
      sourceProjectId,
    }, true));
    if (current.current.detail?.project.id !== saved.project.id) return;
    if (current.current.dirty) {
      setConflict(true);
      setMessage("素材已加入。当前编辑仍保留，可重新读取项目或另存副本。");
      return;
    }
    accept(result);
    setPanel("quick");
    setMobile("preview");
  }
  async function addExamples(templateIds:string[],kit?:{id:string;version:number},newDemo=false) {
    const previous = newDemo && detail ? await flush() : detail;
    const grant=grants[scopeIndex];
    let saved:WorkspaceDetail;
    if(!detail||newDemo){
      if(!previous&&!grant)throw new Error('请选择获权区域后重试。');
      saved=workspaceDetailSchema.parse(await call({action:'create',projectId:crypto.randomUUID(),title:(kit?'提案套装演示':'模板示例')+' · 合成资料',scope:previous?{organizationId:previous.project.organization_id,region:previous.project.region,city:previous.project.city,businessLine:previous.project.business_line}:{organizationId:grant.organizationId,region:grant.region,city:grant.city,businessLine:grant.businessLine},themeId:previous?.project.theme_id??catalog!.themes[0].id,themeVersion:previous?.project.theme_version??catalog!.themes[0].current_version,context:previous?.workspace.context??context},true));
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
  function trackOutlineReceipt(receipt: TaskReceipt) {
    // Completed receipts still need to load the saved pages through the same path as polling.
    setTask({ ...receipt, state: receipt.state === "completed" ? "processing" : receipt.state, outline: true });
    setTaskPollFailed(false);
  }
  function readOutlineReceipt({ projectId, taskId }: OutlineStart) {
    return call<TaskReceipt>({ action: "status", projectId, taskId }, true);
  }
  async function startOutline(part: OutlinePart) {
    if (busy || generationPending || conflict) throw new Error("当前项目正忙，请处理后再提交。");
    setBusy(true);
    setMessage("");
    try {
      const saved = await flush();
      const command: OutlineStart = { action: "start", projectId: saved.project.id,
        expectedVersion: saved.project.version, taskId: crypto.randomUUID(), part, replaceIds: [] };
      try {
        trackOutlineReceipt(await call<TaskReceipt>(command, true));
      } catch (error) {
        if (error instanceof WorkspaceError && error.status < 500 && error.status !== 408) throw error;
        try {
          trackOutlineReceipt(await readOutlineReceipt(command));
        } catch {
          setTask({ id: command.taskId, state: "unconfirmed", outline: true, unconfirmed: command });
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function recoverOutline(command: OutlineStart) {
    try {
      trackOutlineReceipt(await readOutlineReceipt(command));
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.status !== 403)
        throw new Error("暂时无法查询原任务，请稍后再查。");
      // A missing receipt uses the same 403 as revoked access. The existing
      // start authorization/version checks still apply to an idempotent replay.
      try {
        trackOutlineReceipt(await call<TaskReceipt>(command, true));
      } catch (replayError) {
        if (replayError instanceof WorkspaceError && replayError.status < 500 && replayError.status !== 408) {
          try {
            trackOutlineReceipt(await readOutlineReceipt(command));
          } catch (lookupError) {
            if (replayError.status === 403) throw replayError;
            if (!(lookupError instanceof WorkspaceError) || lookupError.status !== 403)
              throw new Error("原任务仍在确认中，请稍后再查。");
            setTask({ id: command.taskId, state: "not_accepted", outline: true });
            throw replayError;
          }
        } else {
          throw new Error("原任务仍在确认中，请稍后再查。");
        }
      }
    }
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
          detail?.slides.find(slide => slide.id === id)?.scene.elements.some(element => element.editorId) ||
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
    if (current.current.dirty) await flush();
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
              onClick={() => {
                if (t.id === "templates") setTemplateCategory("all");
                setPanel(t.id);
              }}
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
      {panel === "quick" && reviewUndo?.projectId === detail?.project.id &&
        reviewUndo?.version === detail?.project.version && !dirty && !saving && !conflict && (
          <div className={styles.notice}>
            <Button variant="ghost" disabled={busy || generationPending} onClick={() => void run(async () => {
              const before = reviewUndo!;
              const restored = workspaceDetailSchema.parse(await call({
                action: "restore", projectId: before.projectId, expectedVersion: before.version, revision: before.revision,
              }, true));
              if (current.current.detail?.project.id !== before.projectId) return;
              setReviewUndo(undefined);
              if (current.current.dirty) {
                setConflict(true);
                setMessage("上次修改已撤销。当前编辑仍保留，可重新读取项目或另存副本。");
                return;
              }
              accept(restored);
              setMessage("已撤销上次修改。");
            })}>撤销上次修改</Button>
          </div>
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
              key={templateCategory}
              initialCategory={templateCategory}
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
                busy={busy || addingAssets || !canGenerate}
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
          {panel === "home" && (
            <div className={styles.home}>
              <section className={styles.homeCreate} aria-labelledby="pitch-create-heading">
                <h2 id="pitch-create-heading">创建演示文稿</h2>
                <form className={styles.composer} onSubmit={(e) => {
                  e.preventDefault();
                  createBrief(brief);
                }}>
                  <label htmlFor="pitch-brief">你想制作什么？</label>
                  <textarea
                    id="pitch-brief"
                    rows={2}
                    maxLength={1000}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="为霄云路33号制作招商代理提案"
                  />
                  <div className={styles.composerActions}>
                    <Button type="submit" disabled={!canGenerate || !brief.trim()}>
                      进入提案助手 <ArrowRight size={16} />
                    </Button>
                  </div>
                </form>
                <div className={styles.homeActions}>
                  <Button variant="ghost" disabled={!canGenerate} onClick={() => {
                    setChosen(null);
                    setCreateFromBrief(false);
                    setName("");
                    setContext(projectContextSchema.parse({}));
                    setCreateOpen(true);
                  }}>
                    <FilePlus2 size={16} /> 新建空白演示文稿
                  </Button>
                  <Button variant="ghost" onClick={() => {
                    setTemplateCategory("all");
                    setPanel("templates");
                  }}>
                    <BookOpen size={16} /> 专业模板
                  </Button>
                  <Button variant="ghost" onClick={() => {
                    setTemplateCategory("favorites");
                    setPanel("templates");
                  }}>
                    <Star size={16} /> 收藏模板
                  </Button>
                  <Button variant="ghost" onClick={() => setPanel("assets")}>
                    <Images size={16} /> 浏览企业素材
                  </Button>
                  <Button variant="ghost" onClick={() => setPanel("examples")}>
                    <Layers size={16} /> 查看提案套装
                  </Button>
                </div>
              </section>
              <section aria-labelledby="pitch-scenarios-heading">
                <h2 id="pitch-scenarios-heading">按业务场景创建</h2>
                <ul className={styles.proposalStarts}>
                  {proposalStarts.map(({ title, question }) => <li key={title}>
                    <Button variant="ghost" disabled={!canGenerate} onClick={() => createBrief(question)}>
                      {title} <ArrowRight size={16} />
                    </Button>
                  </li>)}
                </ul>
              </section>
              <section className={styles.homeRecent} aria-labelledby="pitch-recent-heading">
                <div className={styles.sectionTitle}>
                  <h2 id="pitch-recent-heading">最近编辑</h2>
                  <Button variant="ghost" onClick={() => setPanel("projects")}>查看全部</Button>
                </div>
                <Projects call={call} onOpen={open} onCopy={copyProject} recentOnly />
              </section>
            </div>
          )}
          {panel === "quick" && detail && draft && (
            <>
              <header className={styles.projectBar}>
                <IconButton
                  label="返回我的 Pitch"
                  variant="ghost"
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
                <div className={styles.projectTools} role="group" aria-label="画布操作">
                  <IconButton variant="ghost" label="撤销已保存的调整"
                    disabled={busy || dirty || saving || conflict || rendering || !savedCanvas?.undo.length}
                    onClick={() => void restoreCanvas("undo")}>
                    <Undo2 size={16} />
                  </IconButton>
                  <IconButton variant="ghost" label="重做已保存的调整"
                    disabled={busy || dirty || saving || conflict || rendering || !savedCanvas?.redo.length}
                    onClick={() => void restoreCanvas("redo")}>
                    <Redo2 size={16} />
                  </IconButton>
                </div>
                <Button variant="ghost" disabled={!canGenerate} onClick={() => openInspector("assist")}>
                  <Sparkles size={16} /> 提案助手
                </Button>
                <Presentation slides={slidesForDisplay} active={active} onRetry={previews.retry} disabled={dirty || saving || conflict} />
                <ExportPanel
                  openSignal={exportTrigger}
                  call={call}
                  detail={detail}
                  active={active}
                  selected={selected}
                  flush={flush}
                  canClient={catalog.scopes.some((s) => s.canClientExport)}
                  disabled={busy || conflict || generationPending}
                  outlineReady={task?.outline && task.state === "completed"}
                />
                <IconButton ref={shortcutTrigger} variant="ghost" label="项目操作"
                  popoverTarget="pitch-project-actions">
                  <Ellipsis size={16} />
                </IconButton>
                <div ref={shortcutMenu} id="pitch-project-actions" popover="auto" className={styles.projectMenu}
                  role="group" aria-label="项目操作">
                  <Button variant="ghost" onClick={() => fromProjectMenu(() => void run(() => copyProjectLink(detail.project.id)))}>
                    <Link2 size={16} /> 复制项目链接
                  </Button>
                  <Button variant="ghost" onClick={() => fromProjectMenu(() => setHistoryOpen(true))}>历史版本</Button>
                  <Button variant="ghost" onClick={() => fromProjectMenu(() => openInspector("design"))}>项目设计</Button>
                </div>
              </header>
              {task && (rendering || task.unconfirmed || task.state !== "completed" || task.outline) && (
                <div role="status" className={styles.task}>
                  {task.unconfirmed ? (
                    <>
                      <span>提交结果待确认。再次查询会使用原任务编号。</span>
                      <Button variant="secondary" disabled={busy}
                        onClick={() => {
                          const command = task.unconfirmed;
                          if (command) void run(() => recoverOutline(command));
                        }}>
                        重新查询生成进度
                      </Button>
                    </>
                  ) : rendering ? (
                    <>
                      <span>
                        {readingResult
                          ? "页面已生成，正在读取结果"
                          : task.state === "queued"
                            ? (task.outline ? "提纲已确认，正在排队" : "页面正在排队")
                            : task.stage === "preparing"
                              ? "正在复核数据和素材"
                              : task.stage === "assembling"
                                ? "正在组装提案页面"
                                : task.stage === "saved"
                                  ? "已保存，正在准备页面"
                                  : (task.outline ? "正在按已审阅提纲生成" : "正在生成页面，原页面可继续查看")}
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
                              setTask(r && { ...r, outline: task.outline, revisionBase: task.revisionBase });
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
                          : task.error_code === "PITCH_OUTLINE_SOURCE_CHANGED"
                            ? "素材版本已变化，请重新推荐并确认提纲。"
                            : task.error_code === "PITCH_OUTLINE_DATA_CHANGED"
                              ? "楼宇数据、季度或权限已变化，请重新核对正式数据。"
                              : ""}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={(task.attempts ?? 0) >= 3 || task.error_code === "PITCH_OUTLINE_SOURCE_CHANGED" || task.error_code === "PITCH_OUTLINE_DATA_CHANGED"}
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
                              setTask(r && { ...r, outline: task.outline, revisionBase: task.revisionBase });
                          })
                        }
                      >
                        重试生成
                      </Button>
                    </>
                  ) : task.state === "not_accepted" ? (
                    <span>生成请求未被接受。请核对当前项目和提纲后重新提交。</span>
                  ) : task.state === "cancelled" ? (
                    <span>生成已取消，原页面保留。</span>
                  ) : task.outline && task.state === "completed" ? (
                    <span>提案已生成并保存。确认页面后即可导出可编辑 PPTX。</span>
                  ) : null}
                </div>
              )}
              <div className={styles.mobileTabs} role="tablist" aria-label="工作区面板"
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  const current = mobilePanes.findIndex(([id]) => id === (focusedCanvas ? "preview" : mobile));
                  const next = event.key === "Home" ? 0 : event.key === "End" ? mobilePanes.length - 1
                    : (current + (event.key === "ArrowLeft" ? -1 : 1) + mobilePanes.length) % mobilePanes.length;
                  const id = mobilePanes[next][0];
                  event.preventDefault();
                  changeMobilePane(id);
                  event.currentTarget.querySelector<HTMLButtonElement>(`[data-pane="${id}"]`)?.focus();
                }}>
                {mobilePanes.map(([id, label]) => {
                  const active = (focusedCanvas ? "preview" : mobile) === id;
                  return <button type="button" role="tab" key={id} data-pane={id}
                    aria-controls={id === "preview" ? "pitch-canvas" : id === "edit" ? "pitch-inspector" : "pitch-navigation"}
                    aria-selected={active} tabIndex={active ? 0 : -1} onClick={() => changeMobilePane(id)}>
                    {label}
                  </button>;
                })}
              </div>
              <div className={styles.panelTools} role="group" aria-label="工作区布局">
                <IconButton variant="ghost" label={left && !focusedCanvas ? "收起左栏" : "显示左栏"}
                  onClick={() => { setFocusedCanvas(false); setLeft((value) => focusedCanvas || !value); }}
                  aria-expanded={!focusedCanvas && left} className={styles.panelToggle}>
                  {left && !focusedCanvas ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                </IconButton>
                <IconButton variant="ghost" label={focusedCanvas ? "退出专注画布" : "专注画布"}
                  onClick={openCanvas} aria-pressed={focusedCanvas}>
                  {focusedCanvas ? <Minimize size={16} /> : <Maximize size={16} />}
                </IconButton>
                <IconButton variant="ghost" label={right && !focusedCanvas ? "收起编辑" : "编辑页面"}
                  onClick={() => { setFocusedCanvas(false); setRight((value) => focusedCanvas || !value); }}
                  aria-expanded={!focusedCanvas && right} className={styles.panelToggle}>
                  {right && !focusedCanvas ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                </IconButton>
              </div>
              <div
                className={styles.editor}
                style={{
                  "--pitch-left": `${left && !focusedCanvas ? leftWidth : 0}px`,
                  "--pitch-right": `${right && !focusedCanvas ? rightWidth : 0}px`,
                } as React.CSSProperties}
                data-mobile={focusedCanvas ? "preview" : mobile}
              >
                {left && !focusedCanvas && <PanelSeparator side="left" width={leftWidth} min={176} max={288} onResize={setLeftWidth} />}
                {right && !focusedCanvas && <PanelSeparator side="right" width={rightWidth} min={260} max={396} onResize={setRightWidth} />}
                <aside id="pitch-navigation" aria-label="页面与模板"
                  className={`${styles.left} ${!left ? styles.collapsed : ""} ${focusedCanvas ? styles.focusedAside : ""}`}
                >
                  <div className={styles.modeTabs}>
                    {[
                      ["pages", "页面"],
                      ["templates", "模板"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={leftTab === id}
                        onClick={() => {
                          setLeftTab(id);
                          setMobile(id === "pages" ? "pages" : "add");
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <Button
                      variant="ghost"
                      disabled={busy || rendering || !canGenerate}
                      onClick={openCustomPage}
                    >
                      自定义
                    </Button>
                  </div>
                  {leftTab === "pages" ? (
                    <SlideNavigator
                      key={detail.project.id}
                      slides={slidesForDisplay}
                      active={active}
                      selected={selected}
                      disabled={busy || rendering || conflict}
                      onOpen={(id) => {
                        if (id !== active) edit((value) => ({ ...value, activeSlide: id }));
                        setMobile("preview");
                      }}
                      onSelect={setSelected}
                      onMove={reorder}
                      onCopy={(ids) => {
                        const copies = new Map(ids.map(id => [id, crypto.randomUUID()]));
                        edit((value) => ({
                          ...value,
                          pages: value.pages.flatMap((page) => {
                            const id = copies.get(page.id);
                            return id ? [page, { ...page, id, duplicateOf: page.duplicateOf ?? page.id }] : [page];
                          }),
                        }));
                        setSelected([]);
                      }}
                      onRemove={(ids) => void remove(ids)}
                      onUndoSave={!dirty && !saving && detail.history[0] ? () => void run(async () => {
                        accept(workspaceDetailSchema.parse(await call({
                          action: "restore",
                          projectId: detail.project.id,
                          expectedVersion: detail.project.version,
                          revision: detail.history[0].version,
                        }, true)));
                      }) : undefined}
                    />
                  ) : (
                    <TemplatePicker
                      call={call}
                      compact
                      templates={templates}
                      onChoose={(t) => void choose(t)}
                      favorites={preferences.favorites}
                      recent={preferences.recent}
                      onFavorite={(id) => void run(() => updatePreference(id))}
                    />
                  )}
                </aside>
                <div id="pitch-canvas" className={styles.center}
                  onDragOver={(event) => {
                    if (!canGenerate || busy || addingAssets || generationPending || conflict ||
                      objectPage === active && !!objectPage || !event.dataTransfer.types.includes(pitchAssetDragType)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(event) => {
                    if (!event.dataTransfer.types.includes(pitchAssetDragType)) return;
                    event.preventDefault();
                    if (!canGenerate || busy || addingAssets || generationPending || conflict || objectPage === active && !!objectPage) return;
                    const asset = readAssetTransfer(event.dataTransfer);
                    if (asset?.projectId === detail.project.id) void addAssets(asset.ids, asset.layout)
                      .catch((error: Error) => setMessage(error.message));
                  }}>
                  {page && active && objectPage === active ? (
                    <ObjectCanvas
                      key={`${detail.project.id}:${page.id}:${detail.project.version}`}
                      call={call}
                      projectId={detail.project.id}
                      slideId={page.id}
                      scene={page.scene}
                      content={page.content}
                      allowParagraphs={detail.workspace.page_settings[page.id]?.origin !== "data"}
                      pendingMoves={pageEdit?.objectMoves}
                      pendingTexts={pageEdit?.objectTexts}
                      pendingOrder={pageEdit?.objectOrder}
                      pendingGroups={pageEdit?.objectGroups}
                      onSelectionChange={setObjectSelection}
                      imageReplacement={libraryImages && canGenerate ? {
                        identify: id => {
                          const layer = page.scene.elements.find((element, index) => objectId(element, index) === id);
                          if (layer?.kind !== "image") return undefined;
                          const matches = libraryImages.flatMap((image, index) =>
                            image.id === layer.mediaAssetId && image.version === layer.mediaVersion ? [index] : []);
                          return matches.length === 1 ? matches[0] : undefined;
                        },
                        open: index => {
                          setImageTarget(previous => ({ slideId: active, index, openId: (previous?.openId ?? 0) + 1 }));
                          setObjectPage(null);
                          openInspector("properties");
                        },
                      } : undefined}
                      photoReplacement={canGenerate && !busy && !saving && !generationPending && !conflict && !dirty &&
                        page.id === active && page.content.disclosure === "internal" && (page.scene.pagination?.count ?? 1) === 1 ? {
                          canOpen: id => !!pinnedBuildingPhoto(page, id),
                          open: objectId => setPhotoTarget({ projectId: detail.project.id, version: detail.project.version, pageId: active, objectId }),
                        } : undefined}
                      onClose={() => setObjectPage(null)}
                      onApply={({ moves, texts, order, groups }) => {
                        editPage({ objectMoves: moves.length ? moves : undefined, objectTexts: texts.length ? texts : undefined, objectOrder: order, objectGroups: groups });
                        setObjectPage(null);
                      }}
                    />
                  ) : page ? (
                    <>
                      {canGenerate && page.scene.rendererVersion === "pitch-scene/2" &&
                        page.scene.elements.some(canMoveObject) && (
                        <div className={styles.objectTools}>
                          <Button variant="ghost" disabled={busy || saving || conflict || rendering || (dirty && !pageEdit?.objectMoves && !pageEdit?.objectTexts && !pageEdit?.objectOrder && !pageEdit?.objectGroups)}
                            onClick={() => setObjectPage(active)}>
                            调整画布对象
                          </Button>
                          {(pageEdit?.objectMoves || pageEdit?.objectTexts || pageEdit?.objectOrder || pageEdit?.objectGroups) && (
                            <Button variant="ghost" disabled={saving} onClick={() => editPage({ objectMoves: undefined, objectTexts: undefined, objectOrder: undefined, objectGroups: undefined })}>
                              丢弃未保存的对象修改
                            </Button>
                          )}
                          {page.scene.elements.some(element => element.editorId) && (
                            <Button variant="ghost" disabled={busy || saving || conflict || rendering || !!pageEdit?.objectMoves || !!pageEdit?.objectTexts || !!pageEdit?.objectOrder || !!pageEdit?.objectGroups}
                              onClick={() => setConfirmation({
                                title: "恢复自动布局？",
                                body: "此页手动摆放的位置将被替换。已保存的旧版仍可从项目历史恢复。",
                                run: async () => editPage({ resetObjectLayout: true }),
                              })}>
                              恢复自动布局
                            </Button>
                          )}
                        </div>
                      )}
                      <PagePreview
                        src={previews.images[page.id]}
                        error={previews.errors[page.id]}
                        title={pageEdit?.title ?? page.content.title}
                        pending={dirty || saving}
                        onRetry={previews.retry}
                      />
                    </>
                  ) : (
                    <div className={styles.empty}>
                      <h2>添加第一张页面</h2>
                      <p>选择模板、企业素材，或添加自定义图文。</p>
                      <Button
                        onClick={() => {
                          setLeft(true);
                          setLeftTab("templates");
                          setMobile("add");
                        }}
                      >
                        添加内容
                      </Button>
                    </div>
                  )}
                </div>
                <aside id="pitch-inspector" aria-label="页面检查器"
                  className={`${styles.right} ${!right ? styles.collapsed : ""} ${focusedCanvas ? styles.focusedAside : ""}`}
                >
                  <div className={styles.modeTabs} role="group" aria-label="检查器">
                    {inspectorTabs.map(({ id, label }) => (
                      <button type="button" key={id} aria-pressed={!chosen && inspector === id}
                        disabled={id === "assist" && !canGenerate} onClick={() => openInspector(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {assistOpened && <div hidden={!!chosen || inspector !== "assist"}>
                    <AiAssist
                      key={detail.project.id}
                      initialQuestion={assistSeed}
                      autoPlan={!!assistSeed}
                      city={detail.project.city}
                      projectVersion={detail.project.version}
                      onProposalGenerated={open}
                      revision={{
                        detail, active: active ?? undefined, selected,
                        objectIds: objectPage && objectPage === active ? objectSelection.ids : [],
                        disabled: busy || saving || dirty || generationPending || conflict || (!!objectPage && objectSelection.dirty),
                        onApplied: (value, previous) => {
                          acceptReviewedChange(value, previous, "AI 修改已应用。");
                          setObjectPage(null);
                        },
                        onOpenData: (period) => {
                          setRefreshSuggestion(period ? { projectId: detail.project.id, period } : undefined);
                          openInspector("data");
                        },
                        onAppend: (receipt, expectedVersion) => {
                          if (current.current.detail?.project.id !== detail.project.id) return;
                          setTaskPollFailed(false);
                          setTask({ ...receipt, state: receipt.state === "completed" ? "processing" : receipt.state,
                            revisionBase: expectedVersion });
                        },
                      }}
                      call={call}
                      projectId={detail.project.id}
                      buildingIds={draft.context.buildingIds}
                      period={draft.context.period}
                      language={draft.context.language}
                      admin={catalog.scopes.some((s) => s.canAdmin)}
                      busy={busy || generationPending || conflict}
                      outlineCanResubmit={task?.outline && ["cancelled", "not_accepted"].includes(task.state)}
                      onGenerate={generate}
                      revisionDestination={catalog.categories.find(c => c.system_code === "general" && c.enabled) &&
                        catalog.scopes.some(s => s.canAdmin && s.canMaintain && s.organizationId === detail.project.organization_id &&
                          (s.region === null || s.region === detail.project.region) && (s.city === null || s.city === detail.project.city) &&
                          (s.businessLine === null || s.businessLine === detail.project.business_line)) ? {
                            categoryId: catalog.categories.find(c => c.system_code === "general" && c.enabled)!.id,
                            scope: { organizationId: detail.project.organization_id, region: detail.project.region,
                              city: detail.project.city, businessLine: detail.project.business_line },
                          } : undefined}
                      canvasTarget={canvasRevisionTarget}
                      onCanvasSaved={result => accept(workspaceDetailSchema.parse(result))}
                      onGenerateOutline={startOutline}
                      onExport={() => setExportTrigger((v) => v + 1)}
                    />
                  </div>}
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
                  ) : inspector === "assets" ? (
                    <AssetPicker key={detail.project.id} call={call} onAdd={addAssets} projectId={detail.project.id}
                      busy={busy || addingAssets || generationPending || conflict || !canGenerate} />
                  ) : inspector === "properties" ? (
                    <div className={styles.form}>
                      {page ? (
                        <>
                          <h2>当前页面</h2>
                          {canvasRevisionTarget && catalog.scopes.some(s =>
                            s.canAdmin && s.organizationId === detail.project.organization_id &&
                            (s.region === null || s.region === detail.project.region) &&
                            (s.city === null || s.city === detail.project.city) &&
                            (s.businessLine === null || s.businessLine === detail.project.business_line)) &&
                            <CurrentPageRevision key={page.id} call={call}
                              target={{ projectId: canvasRevisionTarget.projectId, slideId: canvasRevisionTarget.slideId,
                                expectedVersion: canvasRevisionTarget.expectedVersion }}
                              batchId={pageRevisionBatches[page.id]}
                              rememberBatch={id => setPageRevisionBatches(previous => {
                                const next = { ...previous };
                                if (id) next[page.id] = id;
                                else delete next[page.id];
                                return next;
                              })}
                              onCanvasSaved={result => {
                                accept(workspaceDetailSchema.parse(result));
                                setMessage("所选文字已应用到当前页，原稿可从历史版本恢复。");
                              }}
                              disabled={busy || rendering || conflict} />}
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
                          ) && (detail.workspace.page_settings[page.id]?.origin === "data" ? (
                            <Button variant="ghost" onClick={() => openInspector("data")}>查看数据与来源</Button>
                          ) : (
                            <>
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
                          ))}
                          {libraryImages && <ImageReplacement
                            key={`${active}:${pictureTarget?.openId ?? 0}`}
                            call={call} originals={libraryImages} pending={pageEdit?.images} selectedIndex={pictureTarget?.index}
                            disabled={!canGenerate || busy || saving || generationPending || conflict ||
                              (objectPage === active && objectSelection.dirty) ||
                              !!(pageEdit?.objectMoves || pageEdit?.objectTexts || pageEdit?.objectOrder || pageEdit?.objectGroups)}
                            onChange={images => editPage({ images })} />}
                        </>
                      ) : <p>选择页面以编辑属性。</p>}
                    </div>
                  ) : inspector === "data" ? (
                    <div className={styles.form}>
                      {page ? (
                        <>
                          {active === page.id && (
                            <DataRefresh key={`${detail.project.id}:${detail.project.version}`}
                              call={call} detail={detail} slideId={page.id}
                              suggestedPeriod={suggestedPeriod}
                              disabled={dirty || saving || busy || addingAssets || generationPending || conflict}
                              onApplied={(result, expectedVersion) => {
                                setRefreshSuggestion(undefined);
                                acceptReviewedChange(result, expectedVersion, "正式数据已更新。");
                              }}
                            />
                          )}
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
                      ) : <p>选择页面以查看数据和来源。</p>}
                      {buildingSearch && <details open={dataBuildingsOpen}
                        onToggle={event => setDataBuildingsOpen(event.currentTarget.open)}>
                        <summary>查找楼宇数据</summary>
                        {dataBuildingsOpen && <div className={styles.form}>
                          <BuildingPicker call={call} ids={draft.context.buildingIds} disabled={busy || saving}
                            onChange={buildingIds => edit(value => ({ ...value, context: { ...value.context, buildingIds } }))} />
                          <Button variant="secondary"
                            disabled={!draft.context.buildingIds.length || !canGenerate || busy || saving || generationPending || conflict}
                            onClick={() => void run(async () => {
                              const saved = await flush();
                              if (current.current.detail?.project.id !== saved.project.id) return;
                              if (current.current.dirty) throw new Error("还有未保存的修改，请保存后再核对。");
                              const { buildingIds, period, language } = saved.workspace.context;
                              if (!buildingIds.length) return;
                              setHandoff({ source: { kind: "buildings", buildingIds }, period: period || undefined, language,
                                destination: { id: saved.project.id, title: saved.project.title } });
                            })}>
                            核对季度数据
                          </Button>
                        </div>}
                      </details>}
                      <details>
                        <summary>项目设置</summary>
                        <ContextFields buildingSearch={false} call={call} value={draft.context}
                          onChange={(value) => edit((d) => ({ ...d, context: value }))} />
                      </details>
                    </div>
                  ) : inspector === "design" ? (
                    <div className={styles.form}>
                      {page && <>
                          <label>
                            页面布局
                            <select
                              disabled={page.scene.elements.some(element => element.editorId)}
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
                          {active === page.id && !page.scene.elements.some(element => element.editorId) && (
                            <LayoutVariants key={`${detail.project.version}:${page.id}`} call={call}
                              projectId={detail.project.id} pageIndex={detail.slides.indexOf(page)}
                              layoutId={pageEdit?.layoutId ?? page.scene.layoutId}
                              value={pageEdit?.variant ?? page.scene.variant ?? "standard"}
                              disabled={dirty || saving || busy || generationPending || conflict}
                              onChange={variant => editPage({ variant })} />
                          )}
                      </>}
                      <label>
                            整套设计主题
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
                    </div>
                  ) : null}
                </aside>
              </div>
            </>
          )}
        </>
      )}
      {handoff && catalog && <HandoffReview source={handoff} call={call} theme={catalog.themes[0]} destination={handoff.destination}
        grants={grants.flatMap(scope => scope.region && scope.city && scope.businessLine
          ? [{ ...scope, region: scope.region, city: scope.city, businessLine: scope.businessLine }] : [])}
        onOpen={open} onClose={() => setHandoff(null)} />}
      {photoTarget && detail && photoTarget.projectId === detail.project.id && photoTarget.version === detail.project.version &&
        photoTarget.pageId === active && <PhotoReplacementPicker key={`${photoTarget.pageId}:${photoTarget.objectId}:${photoTarget.version}`}
          call={call} detail={detail} pageId={photoTarget.pageId} objectId={photoTarget.objectId} onClose={() => setPhotoTarget(undefined)}
          onApplied={(result, expectedVersion) => {
            setObjectPage(null);
            acceptReviewedChange(result, expectedVersion, "楼宇照片已更换。");
          }} />}
      {homeProposal && homeGrant && <Dialog open dismissible={!homeGenerating} title="核对提案" size="md"
        onOpenChange={(value) => { if (!value) setHomeProposal(""); }}
        footer={<Button variant="ghost" disabled={homeGenerating} onClick={() => openBriefProjectSettings(homeProposal)}>
          打开项目设置
        </Button>}>
        <div className={`${styles.studio} ${styles.form}`}>
          <p>{homeProposal}</p>
          <ProposalPreview call={call} city={homeGrant.city ?? undefined}
            question={homeProposal} language="zh" period="" buildingIds={[]}
            initialQuestion={homeProposal} disabled={busy} createProject={createHomeProposalProject}
            onGenerating={setHomeGenerating} onGenerated={async (id) => {
              await open(id);
              setHomeProposal("");
              setBrief("");
            }} />
        </div>
      </Dialog>}
      <Dialog
        open={createOpen}
        onOpenChange={(value) => {
          setCreateOpen(value);
          if (!value) setCreateFromBrief(false);
        }}
        title="新建 Pitch"
        size="md"
        footer={
          <Button
            disabled={busy || !name.trim() || !grants.length}
            onClick={() =>
              void run(async () => {
                if (current.current.dirty) await flush();
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
                setLeft(true);
                setRight(true);
                setFocusedCanvas(false);
                setLeftTab(createFromBrief ? "pages" : "templates");
                setInspector(createFromBrief ? "assist" : "properties");
                setAssistOpened(createFromBrief);
                setMobile(chosen || createFromBrief ? "edit" : "add");
                setAssistSeed(createFromBrief ? brief.trim() : "");
                if (createFromBrief) setBrief("");
                setCreateFromBrief(false);
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
