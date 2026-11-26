import JSZip from "jszip";
import { expect, it } from "vitest";
import { comparisonQuarters, quarterComparisons, type QuarterComparisonEvidence } from "../business/quarter-comparison";
import { layoutFixture } from "../fixtures/layouts";
import { layoutSlides } from "../layout/engine";
import { STUDIO_THEME } from "../design/theme";
import { renderPitchPptx } from "../render/pptx";
import type { DisplayCell } from "@/src/lib/intelligence/query/presentation";

const first = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const period = { year: 2026, quarter: 1 };
const number = (numerator: number, denominator = 1): DisplayCell => ({
  kind: "number", sourceIds: [], value: { exact: { numerator: String(numerator), denominator: String(denominator) },
    numeric: numerator / denominator },
});
const result = (rent: DisplayCell, vacancy: DisplayCell): QuarterComparisonEvidence => ({
  table: { rows: [{ entityId: first, cells: { name: { kind: "text", value: "国贸测试楼", sourceIds: [] },
    netEffectiveRent: rent, vacancy } }, { entityId: other, cells: { name: { kind: "text", value: "测试广场", sourceIds: [] },
    netEffectiveRent: { kind: "unknown", state: "invalid", reason: "test", sourceIds: [] }, vacancy: number(1, 100) } }] },
});
const results = [result(number(100), number(12, 100)), result(number(80), number(10, 100)),
  result(number(0), { kind: "unknown", state: "missing", reason: "missing", sourceIds: [] })];

it("takes Q1 QoQ from previous Q4 and never changes the prior-year baseline", () => {
  expect(comparisonQuarters(period)).toEqual({ previous: { year: 2025, quarter: 4 }, priorYear: { year: 2025, quarter: 1 } });
  const [rent, vacancy] = quarterComparisons(results, period, [first, other], "zh");
  expect(rent.columns.slice(2)).toEqual(["环比 · 2025-Q4", "同比 · 2025-Q1"]);
  expect(rent.rows[0]).toEqual(["国贸测试楼", "100", "+25%", "基期为零"]);
  expect(vacancy.rows[0]).toEqual(["国贸测试楼", "12", "+2 个百分点", "基期无有效值"]);
  expect(rent.rows[1]).toEqual(["测试广场", "无有效值", "本期无有效值", "本期无有效值"]);
  const down = quarterComparisons([result(number(72), number(0)), ...results.slice(1)], period, [first], "en");
  expect(down[0].rows[0][2]).toBe("-10%");
  expect(down[1].rows[0][2]).toBe("-10 pp");
});

it("keeps the comparison table and formula visible as native PowerPoint elements", async () => {
  const content = layoutFixture("table-insight"), sourceIds = content.sources.map(source => source.id);
  const rent = quarterComparisons(results, period, [first, other], "zh")[0];
  content.title = "季度对比";
  content.subtitle = "租金 · 环比 / 同比";
  content.blocks = [{ kind: "table", columns: rent.columns, rows: rent.rows, sourceIds },
    { kind: "paragraph", text: rent.note, sourceIds }];
  const pages = await layoutSlides(content, STUDIO_THEME, "table-insight");
  const bytes = await renderPitchPptx("季度对比", pages.map(scene => ({ scene, theme: STUDIO_THEME })), []);
  const xml = await (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml")!.async("string");
  expect(xml).toContain("<a:tbl>");
  expect(xml).toContain("基期为零");
  expect(xml).toContain("+25%");
  expect(xml).toContain("租金变化率");
});
