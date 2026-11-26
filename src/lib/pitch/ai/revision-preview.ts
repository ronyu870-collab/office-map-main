import { slideContentSchema, type PitchScope, type SlideContent } from "../contracts/content";
import type { Understanding } from "./protocol";

export type RevisionChange = { id: string; label: string; before: string | null; after: string };
export type RevisionPreview = {
  fingerprint: string;
  sourceVersion: number;
  scope: PitchScope;
  dataAsOf: string;
  beforeLanguage: string | null;
  afterLanguage: string;
  redacted: boolean;
  preservedBlocks: number;
  changes: RevisionChange[];
};

export function prepareRevision(original: SlideContent, revisions: Understanding["revisions"], language: "zh" | "en") {
  const changes: RevisionChange[] = [];
  if (!revisions.length) throw new Error("PITCH_AI_REVISION");
  const redacted = revisions.some(r => r.ref === "approved:0");
  const sourceIds = original.sources.map(s => s.id);
  if (redacted) {
    if (revisions.length !== 1) throw new Error("PITCH_AI_REVISION");
    const after = revisions[0].text;
    changes.push({ id: "approved:0", label: "获批脱敏片段", before: null, after });
    const content = slideContentSchema.parse({
      ...original, locale: language, disclosure: "internal",
      title: language === "en" ? "Reviewed material" : "已核对素材",
      subtitle: language === "en"
        ? "Revision of approved text; full material retained at source"
        : "仅修订获批脱敏文字；完整内容保留在来源",
      blocks: [{ kind: "paragraph", text: after, sourceIds }],
    });
    return { content, changes, redacted, preservedBlocks: 0 };
  }
  const byRef = new Map(revisions.map(r => [r.ref, r.text]));
  if (byRef.size !== revisions.length || [...byRef.keys()].some(ref => {
    if (ref === "title") return false;
    return !/^block:(0|[1-9]\d*)$/.test(ref) || original.blocks[Number(ref.slice(6))]?.kind !== "paragraph";
  })) throw new Error("PITCH_AI_REVISION");
  const title = byRef.get("title") ?? original.title;
  if (title !== original.title) changes.push({ id: "title", label: "标题", before: original.title, after: title });
  let changedBlocks = 0, paragraph = 0;
  const blocks = original.blocks.map((block, i) => {
    if (block.kind !== "paragraph") return block;
    paragraph++;
    const ref = `block:${i}`, after = byRef.get(ref);
    if (after === undefined || after === block.text) return block;
    changes.push({ id: ref, label: `正文段落 ${paragraph}`, before: block.text, after });
    changedBlocks++;
    return { ...block, text: after };
  });
  const content = slideContentSchema.parse({ ...original, locale: language, disclosure: "internal", title, blocks });
  return { content, changes, redacted, preservedBlocks: blocks.length - changedBlocks };
}
