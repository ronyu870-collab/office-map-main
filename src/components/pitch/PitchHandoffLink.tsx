"use client";

import { createContext, useContext, type ReactNode } from "react";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { z } from "zod";

const PitchHandoffVisibility = createContext(false);
export function PitchHandoffProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <PitchHandoffVisibility.Provider value={enabled}>{children}</PitchHandoffVisibility.Provider>;
}
export function usePitchHandoffEnabled() {
  return useContext(PitchHandoffVisibility);
}

const prefix = "#add-to-pitch=";
const leaseSearchSourceSchema = z.strictObject({
  kind: z.literal("lease-search"),
  dataset: z.enum(["live", "history", "combined"]),
  from: z.iso.date(),
  to: z.iso.date(),
  buildingIds: z.array(z.uuid()).max(20),
  submarkets: z.array(z.string().trim().min(1).max(80)).max(30),
  view: z.enum(["transactions", "industry-count", "industry-area"]),
  direction: z.enum(["asc", "desc"]),
}).refine(
  ({ from, to }) => from <= to && Number(to.slice(0, 4)) - Number(from.slice(0, 4)) <= 20,
);
export type PitchLeaseSearchSource = z.infer<typeof leaseSearchSourceSchema>;

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buildings"), buildingIds: z.array(z.uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length) }),
  z.object({ kind: z.literal("submarket"), key: z.string().trim().min(1).max(80) }),
  z.object({ kind: z.literal("analysis-result"), id: z.uuid() }),
  leaseSearchSourceSchema,
]);
const navigationSchema = z.object({
  source: sourceSchema,
  period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
  language: z.enum(["zh", "en"]).optional(),
}).refine(input => input.source.kind !== "lease-search" || !input.period);

export type PitchHandoffNavigation = z.infer<typeof navigationSchema>;

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
  const enabled = usePitchHandoffEnabled();
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
