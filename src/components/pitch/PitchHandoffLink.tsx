"use client";

import { createContext, useContext, type ReactNode } from "react";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { z } from "zod";
import type { AddToPitch } from "@/src/lib/pitch/integration-contracts";

const PitchHandoffVisibility = createContext(false);
export function PitchHandoffProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <PitchHandoffVisibility.Provider value={enabled}>{children}</PitchHandoffVisibility.Provider>;
}
const prefix = "#add-to-pitch=";
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buildings"), buildingIds: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length) }),
  z.object({ kind: z.literal("submarket"), key: z.string().trim().min(1).max(80) }),
  z.object({ kind: z.literal("analysis-result"), id: z.uuid() }),
]);
const navigationSchema = z.object({
  source: sourceSchema,
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
  language: z.enum(["zh", "en"]).optional(),
});

export type PitchHandoffNavigation = Pick<AddToPitch, "source" | "period" | "language">;

export function readPitchHandoff(hash: string): PitchHandoffNavigation | null {
  if (!hash.startsWith(prefix) || hash.length > 3000) return null;
  try {
    const result = navigationSchema.safeParse(JSON.parse(decodeURIComponent(hash.slice(prefix.length))));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function PitchHandoffLink({ source, period, language, className, label = "加入 Pitch", iconOnly = false }: PitchHandoffNavigation & {
  className?: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const enabled = useContext(PitchHandoffVisibility);
  if (!enabled) return null;
  const handoff = navigationSchema.safeParse({ source, period, language });
  if (!handoff.success) return null;
  return <Link href={`/intelligence/pitch${prefix}${encodeURIComponent(JSON.stringify(handoff.data))}`}
    target="_blank" rel="noopener noreferrer" prefetch={false} className={className}
    aria-label={label} title={iconOnly ? label : undefined}>
    <FilePlus2 size={16} aria-hidden="true" />
    {!iconOnly && <span>加入 Pitch</span>}
  </Link>;
}
