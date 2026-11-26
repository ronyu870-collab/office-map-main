import { Decimal } from "@/src/lib/intelligence/query/decimal";
import { quarterSchema, type Quarter } from "@/src/lib/intelligence/query/contracts";
import { cellText, formatExact, type DisplayCell, type QueryResultView } from "@/src/lib/intelligence/query/presentation";

export function comparisonQuarters(current: Quarter) {
  return {
    previous: quarterSchema.parse(current.quarter === 1
      ? { year: current.year - 1, quarter: 4 }
      : { year: current.year, quarter: current.quarter - 1 }),
    priorYear: quarterSchema.parse({ year: current.year - 1, quarter: current.quarter }),
  };
}
export const quarterLabel = (period: Quarter) => `${period.year}-Q${period.quarter}`;
const exact = (cell: Extract<DisplayCell, { kind: "number" }>) =>
  Decimal.fraction(BigInt(cell.value.exact.numerator), BigInt(cell.value.exact.denominator));
function change(current: DisplayCell | undefined, base: DisplayCell | undefined,
  key: "netEffectiveRent" | "vacancy", en: boolean) {
  if (current?.kind !== "number") return en ? "Current unavailable" : "本期无有效值";
  if (base?.kind !== "number") return en ? "Baseline unavailable" : "基期无有效值";
  const baseline = exact(base), difference = exact(current).subtract(baseline);
  if (key === "netEffectiveRent" && baseline.compare(Decimal.zero()) === 0)
    return en ? "Zero baseline" : "基期为零";
  // Ratio deltas are percentage points. Rent change is a relative percentage.
  const value = key === "vacancy" ? difference : difference.divide(baseline);
  const formatted = formatExact({ exact: value.exact(), numeric: 0 }, "ratio");
  return (Number(formatted.replaceAll(",", "")) > 0 ? "+" : "") + formatted +
    (key === "vacancy" ? (en ? " pp" : " 个百分点") : "%");
}
export type QuarterComparisonEvidence = { table: Pick<QueryResultView["table"], "rows"> };
export function quarterComparisons(results: readonly QuarterComparisonEvidence[], current: Quarter, ids: string[], locale: "zh" | "en") {
  const [end, previous, priorYear] = results;
  if (results.length !== 3) throw new Error("PITCH_OUTLINE_DATA_CHANGED");
  const baselines = comparisonQuarters(current);
  const en = locale === "en";
  const [latestRows, qoqRows, yoyRows] = [end, previous, priorYear].map(
    result => new Map(result.table.rows.map(row => [row.entityId, row.cells])),
  );
  return (["netEffectiveRent", "vacancy"] as const).map(key => {
    const rent = key === "netEffectiveRent", unit = rent ? "CNY/m2/month" : "ratio";
    const metric = en ? (rent ? "Net effective rent" : "Vacancy rate") : (rent ? "净有效租金" : "楼宇空置率");
    return {
      metric,
      note: rent
        ? (en ? "Relative change = (current − baseline) / baseline. A zero baseline has no valid change rate." : "租金变化率＝（本期－基期）÷基期。基期为零时不计算。")
        : (en ? "Change is the difference between rates in percentage points. Missing values never become zero." : "空置率变化为两期之差，单位：百分点，不是相对百分比。缺失不按零处理。"),
      columns: [
        en ? "Building" : "楼宇",
        `${quarterLabel(current)} · ${rent ? (en ? "CNY/m²/mo" : "元/㎡/月") : "%"}`,
        `${en ? "QoQ" : "环比"} · ${quarterLabel(baselines.previous)}`,
        `${en ? "YoY" : "同比"} · ${quarterLabel(baselines.priorYear)}`,
      ],
      rows: ids.map(id => {
        const latest = latestRows.get(id), name = latest?.name;
        if (name?.kind !== "text") throw new Error("PITCH_OUTLINE_DATA_CHANGED");
        const currentCell = latest?.[key];
        return [name.value,
          currentCell?.kind === "number" ? cellText(currentCell, unit) : (en ? "Unavailable" : "无有效值"),
          change(currentCell, qoqRows.get(id)?.[key], key, en),
          change(currentCell, yoyRows.get(id)?.[key], key, en)];
      }),
    };
  });
}
