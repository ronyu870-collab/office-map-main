import { useEffect, useState } from "react";
import { z } from "zod";
import type { WorkspaceDetail } from "@/src/lib/pitch/workspace/protocol";
import { WorkspaceError, type Call } from "./client";
import { dataRefreshPeriodSchema } from "./DataRefreshReview";

const queryReceiptSchema = z.object({
  sourceId: z.uuid(), receiptId: z.string(), resultId: z.uuid(),
  binding: z.object({ dataAsOf: z.iso.date().nullable() }),
  query: z.object({ fields: z.array(z.string()) }),
});
const bindingObjectSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.string(),
  sourceIds: z.array(z.uuid()),
  valueOrigin: z.enum(["manual", "asset", "business"]),
  binding: z.object({ domain: z.enum(["quarter", "lease", "business"]) }).optional(),
  query: z.object({ period: dataRefreshPeriodSchema.optional() }).optional(),
  receipts: z.array(queryReceiptSchema).optional(),
});
const bindingsSchema = z.object({
  projectVersion: z.number().int(),
  pages: z.array(z.object({ id: z.uuid(), objects: z.array(bindingObjectSchema) })),
});
type Bindings = z.infer<typeof bindingsSchema>;
type BindingResult = { status: "ready"; data: Bindings } | { status: "unsupported" } | { status: "error"; message: string };
export type DocumentBindings = (BindingResult | { status: "loading" }) & { retry: () => void };

export function useDocumentBindings(call: Call, project: WorkspaceDetail["project"] | undefined, enabled: boolean): DocumentBindings {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value: BindingResult }>();
  const projectId = project?.id;
  const version = project?.version;
  const key = `${projectId}:${version}:${attempt}`;
  const current = result?.key === key ? result.value : undefined;

  useEffect(() => {
    if (!enabled || !projectId || current) return;
    const request = new AbortController();
    void call({ action: "document_bindings", projectId }, false, "workspace", request.signal)
      .then(bindingsSchema.parse)
      .then(data => {
        if (request.signal.aborted) return;
        setResult({ key, value: data.projectVersion === version ? { status: "ready", data }
          : { status: "error", message: "项目版本已变化，请重新打开项目检查数据绑定。" } });
      })
      .catch((cause: unknown) => {
        if (request.signal.aborted) return;
        const value: BindingResult = cause instanceof WorkspaceError && [400, 404].includes(cause.status)
          ? { status: "unsupported" }
          : { status: "error", message: cause instanceof Error && !(cause instanceof z.ZodError)
            ? cause.message : "数据绑定暂时无法读取。" };
        setResult({ key, value });
      });
    return () => request.abort();
  }, [call, current, enabled, key, projectId, version]);

  const retry = () => setAttempt(value => value + 1);
  return current ? { ...current, retry } : { status: "loading", retry };
}

export function paragraphBindingAccess(bindings: DocumentBindings, slide: WorkspaceDetail["slides"][number] | undefined,
  legacyDataPage: boolean) {
  const locked = new Set<number>();
  const objects = slide && bindings.status === "ready"
    ? bindings.data.pages.find(page => page.id === slide.id)?.objects : undefined;
  const legacy = bindings.status === "unsupported";
  const matched = !!objects && !!slide && objects.length === slide.content.blocks.length && objects.every((object, index) => {
    const block = slide.content.blocks[index];
    return object.index === index && object.kind === block.kind && object.sourceIds.join() === block.sourceIds.join();
  });
  for (const [index, block] of (slide?.content.blocks ?? []).entries()) {
    if (block.kind !== "paragraph") continue;
    if (slide?.content.disclosure === "restricted" || (!matched && (!legacy || legacyDataPage)) ||
      objects?.[index]?.valueOrigin === "business" || objects?.[index]?.receipts?.length) locked.add(index);
  }
  return {
    locked,
    // Saved data pages expose paragraph anchors only through a captured quarter or lease group.
    allowCanvasParagraphs: !legacyDataPage || !!objects?.some(object => object.binding?.domain === "quarter" || object.binding?.domain === "lease"),
    current: matched || legacy,
  };
}
