import { z } from "zod";
import { contentBlockSchema } from "@/src/lib/pitch/contracts/content";
import styles from "./workspace.module.css";

const [paragraph, metric, , table, chart] = contentBlockSchema.options;
const numericEvidence = [
  metric.omit({ sourceIds: true }),
  z.object({ kind: table.shape.kind, columns: table.shape.columns, rows: table.shape.rows }),
  z.object({ kind: chart.shape.kind, categories: chart.shape.categories, series: chart.shape.series,
    xAxis: z.object({ label: z.string().min(1).max(100), unit: z.string().max(60),
      values: z.array(z.number().finite().nullable()).min(1).max(200) }).optional() }),
] as const;
export const formalEvidenceValueSchema = z.discriminatedUnion("kind", numericEvidence);
export const evidenceValueSchema = z.discriminatedUnion("kind", [paragraph.omit({ sourceIds: true }), ...numericEvidence]);

function ValueTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="数据预览">
    <table>
      <thead><tr>{columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value ?? "—"}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export function BusinessEvidence({ block }: { block: z.infer<typeof evidenceValueSchema> }) {
  switch (block.kind) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "table":
      return <ValueTable columns={block.columns} rows={block.rows} />;
    case "metric":
      return <dl className={styles.refreshMetric}>
        <div><dt>{block.label}</dt><dd>{block.value === null ? "—" : [block.value, block.unit].filter(value => value !== "").join(" ")}</dd></div>
        {block.qoq !== undefined && <div><dt>环比</dt><dd>{block.qoq ?? "—"}</dd></div>}
        {block.yoy !== undefined && <div><dt>同比</dt><dd>{block.yoy ?? "—"}</dd></div>}
      </dl>;
    case "chart":
      return <ValueTable columns={["类别", ...(block.xAxis ? [block.xAxis.unit ? `${block.xAxis.label}（${block.xAxis.unit}）` : block.xAxis.label] : []),
        ...block.series.map(series => series.unit ? `${series.name}（${series.unit}）` : series.name)]}
        rows={block.categories.map((item, index) => [item, ...(block.xAxis ? [block.xAxis.values[index] ?? null] : []),
          ...block.series.map(series => series.values[index] ?? null)])} />;
  }
}

export function EvidencePages({ pages }: { pages: readonly {
  title: string; blocks?: z.infer<typeof contentBlockSchema>[]; sources: readonly { label: string }[];
}[] }) {
  return <ol className={styles.handoffPages}>
    {pages.map((page, index) => {
      const evidence = page.blocks?.filter(block =>
        block.kind === "table" || block.kind === "chart" || block.kind === "metric" || block.kind === "paragraph") ?? [];
      return <li key={index}>
        {evidence.length ? <details open={pages.length === 1 ? true : undefined}>
          <summary>{page.title}</summary>
          {evidence.map((block, position) => <BusinessEvidence key={position} block={block} />)}
        </details> : <strong>{page.title}</strong>}
        {page.sources.length > 0 && <p>{[...new Set(page.sources.map(item => item.label))].join("、")}</p>}
      </li>;
    })}
  </ol>;
}
