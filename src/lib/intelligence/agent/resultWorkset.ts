import { resultViewSchema, cellText, resultSummary, type QueryResultView } from '../query/presentation';
import type { QueryResult } from '../query/result';

export type WorksetOwner = Readonly<{
  requestId: string; actorId: string; effectiveUserId: string;
  sessionId: string; permissionRevision: string; policyVersion: string;
}>;
type Entry = { result: QueryResult; view: QueryResultView; owner: WorksetOwner };
type Sort = { field: string; direction: 'asc' | 'desc' };
type Filter = { field: string; operator: 'eq' | 'contains' | 'gte' | 'lte'; value: string | number };
type Page = { resultId: string; offset: number; limit: number; sort?: Sort; filter?: Filter };
export const WORKSET_LIMITS = { results: 8, totalRows: 50000, pageSize: 100, modelBytes: 9500 } as const;

/** Per-request only: no global cache, cross-session lookup or unsealed resume.
 * Permission/actor are independently checked on every workset access. */
export class AuthorizedResultWorkset {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly owner: WorksetOwner) {}

  private assertOwner(identity: WorksetOwner) {
    if (this.owner.requestId !== identity.requestId || this.owner.actorId !== identity.actorId
      || this.owner.effectiveUserId !== identity.effectiveUserId || this.owner.sessionId !== identity.sessionId
      || this.owner.permissionRevision !== identity.permissionRevision || this.owner.policyVersion !== identity.policyVersion)
      throw new Error('QUERY_DENIED');
  }

  register(result: QueryResult, identity: WorksetOwner) {
    this.assertOwner(identity);
    const view = resultViewSchema.parse(result);
    if (this.entries.has(view.resultId)) {
      if (this.entries.get(view.resultId)?.result !== result) throw new Error('AGENT_RESULT_ID_COLLISION');
      return this.describe(view);
    }
    const rows = [...this.entries.values()].reduce((sum, entry) => sum + entry.view.table.rows.length, 0);
    if (this.entries.size >= WORKSET_LIMITS.results || rows + view.table.rows.length > WORKSET_LIMITS.totalRows)
      throw new Error('AGENT_WORKSET_LIMIT');
    this.entries.set(view.resultId, { owner: identity, result, view });
    return this.describe(view);
  }

  private getEntry(resultId: string, identity: WorksetOwner): Entry {
    this.assertOwner(identity);
    const entry = this.entries.get(resultId);
    if (!entry || entry.owner.requestId !== identity.requestId
      || entry.owner.permissionRevision !== identity.permissionRevision) throw new Error('AGENT_RESULT_NOT_FOUND');
    return entry;
  }

  read(resultId: string, identity: WorksetOwner): QueryResult {
    return this.getEntry(resultId, identity).result;
  }

  latestId() { return [...this.entries.keys()].at(-1); }
  manifest(identity: WorksetOwner) {
    this.assertOwner(identity);
    return [...this.entries.values()].map(entry => this.describe(entry.view));
  }

  private describe(view: QueryResultView) {
    return { requestId: this.owner.requestId, resultId: view.resultId,
      operation: view.operation, rowCount: view.table.rows.length, columnCount: view.table.columns.length,
      sourceCount: view.sources.length, snapshotId: view.snapshotId,
      dataVersion: view.dataVersion, scopeFingerprint: view.scopeFingerprint,
      createdAt: view.createdAt };
  }

  summary(resultId: string, identity: WorksetOwner) {
    const view = this.getEntry(resultId, identity).view;
    return { status: 'ready', ...this.describe(view), summary: resultSummary(view).slice(0, 10),
      columns: this.countColumns(view), limitations: view.limitations.slice(0, 6),
      note: '覆盖整张已授权正式结果表；缺失值不当成零、不同分组百分比不相加。' };
  }

  coverage(resultId: string, identity: WorksetOwner) {
    const view = this.getEntry(resultId, identity).view;
    return { status: 'ready', ...this.describe(view), columns: this.countColumns(view),
      note: '每列均按完整获权结果统计有效、缺失、无效、冲突、未核验记录数；不是季度发布状态认定。' };
  }

  private countColumns(view: QueryResultView) {
    return view.table.columns.map(column => {
      const counts = { valid: 0, text: 0, missing: 0, invalid: 0, conflict: 0, unverified: 0 };
      for (const row of view.table.rows) {
        const cell = row.cells[column.key];
        if (cell.kind === 'number') counts.valid++;
        else if (cell.kind === 'text') counts.text++;
        else counts[cell.state]++;
      }
      return { field: column.key, label: column.label, unit: column.unit, ...counts };
    });
  }

  page(input: Page, identity: WorksetOwner) {
    const view = this.getEntry(input.resultId, identity).view;
    const column = (key: string) => {
      const found = view.table.columns.find(item => item.key === key);
      if (!found) throw new Error('AGENT_FIELD_NOT_AVAILABLE');
      return found;
    };
    const sort = input.sort ? column(input.sort.field) : undefined;
    const filter = input.filter ? column(input.filter.field) : undefined;
    // Ordinary paging must not allocate/scan the entire 50k-row result on every
    // page. Only filtering or sorting needs the indexed full-table projection.
    let rows = sort || filter ? view.table.rows.map((row, index) => ({ row, index })) : undefined;
    if (filter && input.filter) {
      const f = input.filter;
      rows = rows!.filter(({ row }) => {
        const cell = row.cells[filter.key];
        if (cell.kind === 'unknown') return false;
        if (f.operator === 'contains') return cell.kind === 'text'
          && cell.value.toLocaleLowerCase().includes(String(f.value).toLocaleLowerCase());
        if (cell.kind === 'text') return f.operator === 'eq' && cell.value === String(f.value);
        const n = Number(f.value);
        if (!Number.isFinite(n)) throw new Error('AGENT_INVALID_TOOL_ARGUMENTS');
        const value = cell.value.numeric;
        return f.operator === 'eq' ? value === n : f.operator === 'gte' ? value >= n : value <= n;
      });
    }
    if (sort && input.sort) {
      const direction = input.sort.direction === 'asc' ? 1 : -1;
      rows!.sort((a, b) => {
        const ca = a.row.cells[sort.key], cb = b.row.cells[sort.key];
        if (ca.kind === 'unknown' || cb.kind === 'unknown')
          return ca.kind === cb.kind ? a.index - b.index : ca.kind === 'unknown' ? 1 : -1;
        if (ca.kind !== cb.kind) return ca.kind === 'text' ? -1 : 1;
        if (ca.kind === 'text' && cb.kind === 'text') return direction * ca.value.localeCompare(cb.value, 'zh-CN') || a.index - b.index;
        if (ca.kind === 'number' && cb.kind === 'number') {
          const left = BigInt(ca.value.exact.numerator) * BigInt(cb.value.exact.denominator);
          const right = BigInt(cb.value.exact.numerator) * BigInt(ca.value.exact.denominator);
          return direction * (left < right ? -1 : left > right ? 1 : 0) || a.index - b.index;
        }
        return a.index - b.index;
      });
    }
    const offset = input.offset, limit = Math.min(input.limit, WORKSET_LIMITS.pageSize);
    const totalMatched = rows?.length ?? view.table.rows.length;
    const rowsForPage = rows ? rows.slice(offset, offset + limit).map(({ row }) => row) : view.table.rows.slice(offset, offset + limit);
    const mapped = rowsForPage.map(row => ({
      entityId: row.entityId,
      values: Object.fromEntries(view.table.columns.map(col => [col.key, {
        value: cellText(row.cells[col.key], col.unit),
        kind: row.cells[col.key].kind,
      }])),
    }));
    const makeResponse = (count: number) => ({
      status: 'ready', ...this.describe(view), totalMatched,
      offset, returnedRows: count, hasMore: offset + count < totalMatched,
      nextOffset: offset + count < totalMatched ? offset + count : null,
      columns: view.table.columns.map(col => ({ key: col.key, label: col.label, unit: col.unit })),
      rows: mapped.slice(0, count),
      note: '返回的是完整工作集的一页。totalMatched 是完整结果或筛选后总数，绝非仅本页行数。',
    });
    const fits = (count: number) => new TextEncoder().encode(JSON.stringify(makeResponse(count))).byteLength <= WORKSET_LIMITS.modelBytes;
    if (fits(mapped.length)) return makeResponse(mapped.length);
    if (!mapped.length || !fits(1)) throw new Error('AGENT_TOOL_RESULT_TOO_LARGE');
    // Monotone prefix sizes: retain the largest fitting page in O(log(pageSize))
    // serializations, with exact UTF-8 accounting for Chinese text.
    let low = 1, high = mapped.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(middle)) low = middle;
      else high = middle - 1;
    }
    return makeResponse(low);
  }

  compare(ids: readonly string[], identity: WorksetOwner) {
    if (new Set(ids).size !== ids.length) throw new Error('AGENT_DUPLICATE_RESULT_ID');
    const comparisons = ids.map(id => {
      const view = this.getEntry(id, identity).view;
      const firstRows = view.table.rows.slice(0, 4).map(row => ({
        entityId: row.entityId,
        cells: Object.fromEntries(view.table.columns.map(column =>
          [column.key, cellText(row.cells[column.key], column.unit)])),
      }));
      return { ...this.describe(view), scope: view.parameters.scope,
        period: view.parameters.period ?? null, metric: view.parameters.metric ?? null,
        summary: resultSummary(view).slice(0, 4), firstRows,
        displayedRows: firstRows.length, totalRows: view.table.rows.length };
    });
    return { status: 'ready', results: comparisons, comparedCount: comparisons.length,
      note: '多结果并列保留每项原始口径及来源。未跨结果重新求和、平均或制造新 QueryResult；完整行请按 resultId 分页查阅。' };
  }
}
