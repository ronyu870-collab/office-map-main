import type { SlideContent } from "../contracts/content";
import type { SlideScene } from "../contracts/scene";
import { objectId } from "../workspace/object-layout";
import type { ProposalEditIntent, ProposalEditTarget } from "./proposal-edit-intent";

type ChartType = "bar" | "column" | "line";
type NativeChart = Extract<SlideContent["blocks"][number], { kind: "chart" }>;
type ChartPage = { id: string; scene: SlideScene; content: SlideContent };
export type ProposalChartChange = { blockIndex: number; from: ChartType; type: ChartType };

function isWorkspaceChart(type: string): type is ChartType {
  return type === "bar" || type === "column" || type === "line";
}

function chartSignature(chart: Pick<NativeChart, "chartType" | "categories" | "series">) {
  return JSON.stringify([chart.chartType, chart.categories, chart.series.map(series => [series.name, series.unit, series.values])]);
}

export function compileProposalChartEdits(
  target: ProposalEditTarget, operation: Extract<ProposalEditIntent, { kind: "set-chart" }>, slides: readonly ChartPage[],
) {
  const type = operation.chart;
  if (!isWorkspaceChart(type)) return null;
  const result: { slide: ChartPage; changes: ProposalChartChange[] }[] = [];
  for (const slide of slides) {
    if (slide.content.disclosure === "restricted") return null;
    const blocks = slide.content.blocks.flatMap((block, blockIndex) => block.kind === "chart" ? [{ block, blockIndex }] : []);
    let selected = blocks.filter(({ block }) => !operation.from || block.chartType === operation.from);
    if (target.kind === "objects") {
      const objects = slide.scene.elements.map((element, index) => ({ element, id: objectId(element, index) }));
      const used = new Set<number>();
      for (const id of target.objectIds) {
        const chart = objects.find(object => object.id === id)?.element;
        if (!chart || chart.kind !== "chart") return null;
        const signature = chartSignature(chart);
        const matches = selected.filter(({ block }) => chartSignature(block) === signature);
        if (matches.length !== 1 || used.has(matches[0].blockIndex)) return null;
        used.add(matches[0].blockIndex);
      }
      selected = selected.filter(({ blockIndex }) => used.has(blockIndex));
    } else if (target.kind === "pages" && (!selected.length || (selected.length > 1 && !operation.all && !operation.from))) {
      return null;
    }
    const changes: ProposalChartChange[] = [];
    for (const { block, blockIndex } of selected) {
      if (block.chartType === type) continue;
      if (!isWorkspaceChart(block.chartType)) return null;
      changes.push({ blockIndex, type, from: block.chartType });
    }
    if (!changes.length) continue;
    if ((slide.scene.pagination?.count ?? 1) !== 1 || slide.scene.elements.some(element => !!element.editorId)
      || changes.length > 10) return null;
    result.push({ slide, changes });
  }
  return result.length ? result : null;
}
