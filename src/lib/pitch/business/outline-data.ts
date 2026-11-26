import { DocumentError } from "@/src/lib/intelligence/knowledge/safeArchive";
import { cellText, units } from "@/src/lib/intelligence/query/presentation";
import type { PitchDataSnapshot } from "./adapter";
import { quarterComparisons } from "./quarter-comparison";
import { digest } from "../data/store";

/** Snapshot and result IDs are fresh on every query. Bind what was actually
 * reviewed instead: the exact rows, missing states, records, and authority. */
export function reviewedBuildingData(snapshot: PitchDataSnapshot, language?: 'zh' | 'en') {
  const { parameters, binding, results: [result] } = snapshot;
  const key = parameters.period;
  const records = result.sources.filter(source =>
    source.period?.year === key.year && source.period.quarter === key.quarter);
  const rows = new Map(result.table.rows.map(row => [row.entityId, row]));
  const columns = result.table.columns.filter(column => column.key !== "name");
  const buildings = parameters.buildingIds.map(id => {
    const name = rows.get(id)?.cells.name;
    if (name?.kind !== "text" || !records.some(record => record.entityId === id))
      throw new DocumentError("PITCH_OUTLINE_DATA_CHANGED", "至少一栋所选楼宇未获权或没有该季度的正式记录。请检查楼宇和季度；不会用其他楼宇或季度替代。");
    return { id, name: name.value, facts: columns.map(column => ({
      label: column.label + (column.unit ? `（${units[column.unit] ?? column.unit}）` : ""),
      value: cellText(rows.get(id)!.cells[column.key], column.unit),
    })) };
  });
  const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
  return {
    buildings,
    ...(snapshot.results.length > 1 && language
      ? { comparisons: quarterComparisons(snapshot.results, key, parameters.buildingIds, language) } : {}),
    fingerprint: digest(new TextEncoder().encode(JSON.stringify([
      parameters, binding, ...(snapshot.results.length === 1
        ? [result.registryVersion, result.table.columns, buildings.map(({ id }) => rows.get(id)), [...result.sources].sort(byId)]
        : [language, ...snapshot.results.map(r => [r.registryVersion, r.table.columns,
          [...r.table.rows].sort((a, b) => a.entityId.localeCompare(b.entityId)), [...r.sources].sort(byId)])]),
    ]))),
  };
}
