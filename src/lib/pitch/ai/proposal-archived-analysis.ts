import { queryHttpDependencies } from "@/src/lib/intelligence/query/http";
import { cellText, resultViewSchema, units } from "@/src/lib/intelligence/query/presentation";
import { readOwnResult, recoverOwnResult } from "@/src/lib/intelligence/query/recovery";
import { loadDataAuthority } from "@/src/lib/intelligence/query/serverAuthority";
import { FIELD_REGISTRY_VERSION } from "@/src/lib/intelligence/query/registry";
import type { PitchContext } from "../data/store";
import { stableId } from "../library/extract";
import type { ProposalDirectorPorts } from "./proposal-director";

export async function composeArchivedAnalysis(
  ctx: PitchContext, requestId: string, language: "zh" | "en",
): Promise<Awaited<ReturnType<ProposalDirectorPorts["compose"]>>> {
  const { client, identity, signal } = ctx;
  const authority = await loadDataAuthority(client, identity, signal);
  if (!authority.grants.includes("export:internal")) throw new Error("QUERY_DENIED");
  const { keys } = queryHttpDependencies();
  const archived = await readOwnResult(client, identity, requestId, "archive", signal);
  const result = await recoverOwnResult(client, identity, keys, requestId, archived, signal, { exporting: true, reauthorizedHistory: true });
  const snapshot = resultViewSchema.parse(result.result);
  const english = language === "en";
  const empty = (reason: string) => ({ pages: [], gaps: [{ pageKind: "verified-analysis", reason }], recipeVersion: "archived-analysis/1" });
  // Only the numeric, authorized query-domain result is carried forward. Other
  // archived tools have separate export and disclosure contracts.
  if (!snapshot.sources.length || snapshot.registryVersion !== FIELD_REGISTRY_VERSION || !snapshot.table.rows.length) {
    return empty(english ? "The selected result has no compatible verified evidence." : "所选结果缺少可复用的可信数据。");
  }
  if (snapshot.table.columns.length > 12 || snapshot.table.rows.length > 200) {
    return empty(english ? "The selected result exceeds the presentation table capacity." : "所选结果超出单份提案表格容量，请先缩小分析范围。");
  }
  const dates = snapshot.sources.flatMap(source => source.businessAsOf ? [source.businessAsOf]
    : source.period ? [new Date(Date.UTC(source.period.year, source.period.quarter * 3, 0)).toISOString().slice(0, 10)] : []).sort();
  const asOf = dates.at(-1) ?? snapshot.createdAt.slice(0, 10);
  const reference = stableId(`pitch-archived-analysis/1:${requestId}:${snapshot.resultId}:${snapshot.dataVersion}`);
  await result.recheck();
  signal.throwIfAborted();
  return {
    pages: [{
      pageKind: "verified-analysis", businessIntent: "analysis", layoutId: "data-table", visuals: [],
      data: [{ domain: "quarter", permissionRevision: authority.permissionRevision, policyVersion: authority.policyVersion,
        dataVersion: snapshot.dataVersion, dataAsOf: asOf }],
      content: {
        protocol: "colliers-pitch/1", locale: language, title: english ? "Verified analysis result" : "已核验分析结果", disclosure: "internal", isTestData: false,
        dataAsOf: asOf, sources: [{ id: reference, kind: "record", label: english ? "Authorized archived analysis" : "获权分析归档",
          recordId: snapshot.resultId, locator: `query/${requestId}`, version: snapshot.dataVersion, dataAsOf: asOf }],
        blocks: [{ kind: "table", sourceIds: [reference], columns: snapshot.table.columns.map(column =>
          column.unit ? `${column.label} (${units[column.unit] ?? column.unit})` : column.label),
        rows: snapshot.table.rows.map(row => snapshot.table.columns.map(column => row.cells[column.key]
          ? cellText(row.cells[column.key], column.unit) : null)) }],
      },
      uncertainties: !dates.length ? [english ? "The displayed date marks the original analysis capture." : "日期为分析快照生成日，实际业务截至日未确认。"] : [],
    }],
    gaps: [], recipeVersion: "archived-analysis/1",
  };
}
