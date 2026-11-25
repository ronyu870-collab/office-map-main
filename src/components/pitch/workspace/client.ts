import type {
  ProjectContext,
  WorkspaceDetail,
  WorkspaceSave,
} from "@/src/lib/pitch/workspace/protocol";
export type Grant = {
  organizationId: string;
  region: string | null;
  city: string | null;
  businessLine: string | null;
  canGenerate: boolean;
  canMaintain: boolean;
  canAdmin: boolean;
  canClientExport: boolean;
};
export type Catalog = {
  scopes: Grant[];
  categories: {
    id: string;
    system_code: string;
    names: Record<string, string>;
    enabled: boolean;
    revision: number;
  }[];
  themes: { id: string; current_version: number }[];
};
export type Call = <T = Record<string, unknown>>(
  input: Record<string, unknown>,
  write?: boolean,
  path?: "workspace" | "business" | "library" | "",
  signal?: AbortSignal,
) => Promise<T>;
export type Draft = {
  title: string;
  themeId: string;
  themeVersion: number;
  context: ProjectContext;
  pages: WorkspaceSave["pages"];
  activeSlide: string | null;
};
export function draftOf(d: WorkspaceDetail): Draft {
  return {
    title: d.project.title,
    themeId: d.project.theme_id,
    themeVersion: d.project.theme_version,
    context: d.workspace.context,
    pages: d.slides.map((p) => ({ id: p.id })),
    activeSlide: d.workspace.active_slide ?? d.slides[0]?.id ?? null,
  };
}
export const themeLabel = (id: string) =>
  id === "colliers-default-v1"
    ? "标准主题"
    : id === "colliers-render-verification"
      ? "替换验证主题"
      : id;
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
