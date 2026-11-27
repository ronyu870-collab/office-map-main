import { z } from "zod";

export const workspaceChartTypeSchema = z.enum(["bar", "column", "line"]);
export const pageNoteTextSchema = z.string().trim().min(1).max(80);
export const pageNoteSchema = z.strictObject({
  text: pageNoteTextSchema,
  baseSubtitle: z.string().max(400).optional(),
});
export type PageNote = z.infer<typeof pageNoteSchema>;

export function noteSubtitle(base: string | undefined, note: string, locale: string) {
  const label = locale.startsWith("en") ? "Manual note: " : "人工说明：";
  return [base, label + note].filter(Boolean).join(" · ");
}
