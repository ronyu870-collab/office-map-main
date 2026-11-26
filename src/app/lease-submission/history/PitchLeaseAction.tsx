"use client";

import { PitchHandoffLink, usePitchHandoffEnabled, type PitchLeaseSearchSource } from "@/src/components/pitch/PitchHandoffLink";
import { leaseFilterParams, type FilterState } from "./filters";

function readPitchLeaseSource(filters: FilterState, source: FilterState["source"]): PitchLeaseSearchSource | null {
  // The representative-transaction contract currently uses a date-and-source scope.
  // History's building filter also includes project-level matches.
  const params = leaseFilterParams(filters);
  if ([...params.keys()].some(key => !["year_from", "year_to", "record_source"].includes(key))) return null;
  const { yearFrom, yearTo } = filters;
  if (!/^\d{4}$/.test(yearFrom) || !/^\d{4}$/.test(yearTo) ||
      Number(yearFrom) < 1900 || Number(yearTo) > 2100 || yearFrom > yearTo ||
      Number(yearTo) - Number(yearFrom) > 20) return null;
  return {
    kind: "lease-search",
    dataset: source || "combined",
    from: `${yearFrom}-01-01`,
    to: `${yearTo}-12-31`,
    buildingIds: [],
    submarkets: [],
    view: "transactions",
    direction: "desc",
  };
}

export function PitchLeaseAction({ filters, source }: { filters: FilterState; source: FilterState["source"] }) {
  if (!usePitchHandoffEnabled()) return null;
  const handoff = readPitchLeaseSource(filters, source);
  if (!handoff) {
    return <details className="text-sm">
      <summary className="cursor-pointer px-2 py-2">Pitch 支持的筛选</summary>
      <p className="my-1 text-[var(--cd-color-text-secondary)]">
        可按成交来源及最长 20 年的明确期间加入代表成交。企业、楼宇和面积筛选需保持在当前成交库查询中。
      </p>
    </details>;
  }
  return <PitchHandoffLink source={handoff} label="将筛选范围的代表成交加入 Pitch"
    className="inline-flex min-h-11 items-center gap-2 px-2 text-sm text-[var(--cd-color-brand)] hover:underline" />;
}
