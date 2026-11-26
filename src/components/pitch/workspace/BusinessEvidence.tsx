import { z } from "zod";
import { contentBlockSchema } from "@/src/lib/pitch/contracts/content";
import styles from "./workspace.module.css";

const [paragraph, metric, , table, chart] = contentBlockSchema.options;
export const evidenceValueSchema = z.discriminatedUnion("kind", [
  paragraph.omit({ sourceIds: true }),
  metric.omit({ sourceIds: true }),
  table.omit({ sourceIds: true }),
  chart.omit({ sourceIds: true }),
]);

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
      return <ValueTable columns={["类别", ...block.series.map(series => series.unit ? `${series.name}（${series.unit}）` : series.name)]}
        rows={block.categories.map((item, index) => [item, ...block.series.map(series => series.values[index] ?? null)])} />;
  }
}
