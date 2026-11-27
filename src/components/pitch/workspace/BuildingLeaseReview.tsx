"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui";
import { outlineQuarter } from "@/src/lib/pitch/workspace/protocol";
import { pitchLeaseSearchSourceSchema, type PitchLeaseSearchSource } from "../PitchHandoffLink";
import styles from "./workspace.module.css";

const datasets = { combined: "合并来源", live: "日常填报", history: "历史导入" };

function initialRange(period: string) {
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter && outlineQuarter.safeParse(period).success) {
    const year = Number(quarter[1]);
    const endMonth = Number(quarter[2]) * 3;
    return {
      from: `${quarter[1]}-${String(endMonth - 2).padStart(2, "0")}-01`,
      to: new Date(Date.UTC(year, endMonth, 0)).toISOString().slice(0, 10),
    };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function BuildingLeaseReview({ buildingIds, period, transactions, industry, disabled, onReview }: {
  buildingIds: string[];
  period: string;
  transactions: boolean;
  industry: boolean;
  disabled: boolean;
  onReview: (source: PitchLeaseSearchSource) => void;
}) {
  const [range, setRange] = useState(() => initialRange(period));
  const [dataset, setDataset] = useState<PitchLeaseSearchSource["dataset"]>("combined");
  const [view, setView] = useState<PitchLeaseSearchSource["view"]>(transactions ? "transactions" : "industry-count");
  const source = pitchLeaseSearchSourceSchema.safeParse({ kind: "lease-search", ...range, dataset, view,
    buildingIds, submarkets: [], direction: "desc" });
  const allowed = view === "transactions" ? transactions : industry;
  const invalidRange = !source.success && buildingIds.length > 0;

  return <details>
    <summary>租赁成交</summary>
    <fieldset className={`${styles.choice} ${styles.form}`} disabled={disabled}>
      <label>成交开始日期<input type="date" value={range.from} max={range.to || undefined}
        onChange={event => setRange({ ...range, from: event.target.value })} /></label>
      <label>成交结束日期<input type="date" value={range.to} min={range.from || undefined}
        onChange={event => setRange({ ...range, to: event.target.value })} /></label>
      <label>成交来源<select value={dataset} onChange={event => setDataset(event.target.value as typeof dataset)}>
        {Object.entries(datasets).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>成交内容<select value={view} onChange={event => setView(event.target.value as typeof view)}>
        {transactions && <option value="transactions">成交明细</option>}
        {industry && <>
          <option value="industry-count">行业分布（笔数）</option>
          <option value="industry-area">行业分布（面积）</option>
        </>}
      </select></label>
      {invalidRange && <p role="status">请填写有效的起止日期，跨度不超过 20 年。</p>}
      <Button variant="secondary" disabled={!allowed || !source.success || !buildingIds.length}
        onClick={() => { if (source.success && allowed && buildingIds.length) onReview(source.data); }}>核对成交资料</Button>
    </fieldset>
  </details>;
}
