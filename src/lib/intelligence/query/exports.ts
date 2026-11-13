import { buildResultChart } from './charts';
import { resultViewSchema, resultSummary, units } from './presentation';
import type { QueryResult, ResultCell } from './result';
import { resultDigest } from './result';

const statusLabels = { missing: '未记录', invalid: '无效', conflict: '冲突', unverified: '未核验' };

/** Text only: business numbers (including negative numbers) retain numeric type. */
export function spreadsheetSafeText(value: string): string {
  return /^[\s\p{Cf}]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
}

function cellValue(cell: ResultCell): string | number {
  return cell.kind === 'unknown' ? statusLabels[cell.state] : cell.kind === 'number' ? cell.value.numeric : cell.value;
}

function csvCell(value: string | number): string {
  const safe = typeof value === 'number' ? String(value) : spreadsheetSafeText(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Return a package: the download layer must deliver both CSV and its manifest. */
export function buildCsvPackage(result: QueryResult) {
  const columns = result.table.columns;
  const rows: (string | number)[][] = [
    ['result_id', 'entity_id', ...columns.flatMap(column => [`${column.label}${column.unit ? ` (${column.unit})` : ''}`, `${column.key}:状态`, `${column.key}:精确值`, `${column.key}:来源`])],
    ...result.table.rows.map(row => [result.resultId, row.entityId, ...columns.flatMap(column => {
      const cell = row.cells[column.key];
      return [cellValue(cell), cell.kind === 'unknown' ? cell.state : 'valid', cell.kind === 'number' ? `${cell.value.exact.numerator}/${cell.value.exact.denominator}` : '', cell.sourceIds.join(';')];
    })]),
  ];
  return {
    resultId: result.resultId,
    csv: '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n',
    manifest: JSON.stringify({ resultId: result.resultId, digest: resultDigest(result), snapshotId: result.snapshotId, dataVersion: result.dataVersion, parameters: result.parameters, analysis: result.analysis, sources: result.sources, limitations: result.limitations, numericRepresentation: 'numeric为展示近似值；精确值为未舍入分子/分母' }, null, 2),
  };
}

/** Lazy import keeps the existing map/home bundle free from spreadsheet code. */
export async function buildXlsx(result: QueryResult): Promise<Uint8Array> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const append = (name: string, rows: (string | number | null)[][]) => {
    if (rows.length > 1048576 || rows.some(row => row.length > 16384)) throw new Error('XLSX_DIMENSION_LIMIT');
    if (rows.some(row => row.some(value => typeof value === 'string' && value.length > 32767))) throw new Error('XLSX_CELL_LIMIT');
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    // AOA strings must remain explicit text even when a source begins with '='.
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith('!') || !cell || typeof cell !== 'object') continue;
      const typed = cell as { t?: string; f?: string; v?: unknown };
      if (typeof typed.v === 'string') { typed.t = 's'; delete typed.f; }
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    return sheet;
  };
  const metadataRows = (key: string, value: string): string[][] => {
    if (value.length <= 30000) return [[key, value]];
    const count = Math.ceil(value.length / 30000);
    return [[`${key}:parts`, String(count)], ...Array.from({ length: count }, (_, index) => [`${key}:part:${String(index + 1).padStart(6, '0')}`, value.slice(index * 30000, (index + 1) * 30000)])];
  };
  append('数据', [
    ['entity_id', ...result.table.columns.map(column => `${column.label}${column.unit ? ` (${column.unit})` : ''}`)],
    ...result.table.rows.map(row => [row.entityId, ...result.table.columns.map(column => cellValue(row.cells[column.key]))]),
  ]);
  if (result.operation === 'cross_aggregate') {
    // Reuse the exact axis/cell validator, then copy original typed cells. No
    // regrouping, pivot aggregate, fresh data read or rounded recomputation.
    const chart = buildResultChart(resultViewSchema.parse(result), { kind: 'heatmap' }), grid = chart.grid!;
    for (const [field, name] of [['value', '交叉指标'], ['usedCount', '交叉样本'], ['denominator', '交叉分母']] as const) {
      const column = result.table.columns.find(c => c.key === field)!;
      const sheet = append(name, [
        ['result_id', result.resultId], ['指标', `${column.label} (${units[column.unit ?? ''] ?? column.unit ?? ''})`],
        ['子市场 / 等级', ...grid.columns.map(c => c.label)],
        ...grid.rows.map((row, i) => [row.label, ...grid.columns.map((_, j) => {
          const cell = result.table.rows[i * grid.columns.length + j].cells[field];
          return cell.kind === 'unknown' ? '未知（无有效样本）' : cellValue(cell);
        })]),
      ]);
      if (column.unit === 'ratio') grid.rows.forEach((_, i) => grid.columns.forEach((_, j) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: i + 3, c: j + 1 })];
        if (cell?.t === 'n') cell.z = '0.00%';
      }));
    }
  }
  if (result.operation === 'relationship') {
    const summary = resultSummary(resultViewSchema.parse(result));
    append('联合统计', [['result_id', result.resultId], ...summary.map(line => ['统计说明', line]),
      ['公式', 'r = (nΣxy−ΣxΣy) / sqrt((nΣx²−(Σx)²)(nΣy²−(Σy)²))；每栋等权'],
      ['精确计算', '未舍入矩与r²见口径与快照analysis；r为6位小数近似，不作显著性或因果推断。'],
    ]);
  }
  append('精确值与来源', [
    ['entity_id', 'field', 'state', 'numerator', 'denominator', 'source_ids'],
    ...result.table.rows.flatMap(row => result.table.columns.map(column => {
      const cell = row.cells[column.key];
      return [row.entityId, column.key, cell.kind === 'unknown' ? cell.state : 'valid', cell.kind === 'number' ? cell.value.exact.numerator : '', cell.kind === 'number' ? cell.value.exact.denominator : '', cell.sourceIds.join(';')];
    })),
  ]);
  append('来源', [
    ['source_id', 'table', 'record_id', 'field', 'entity_id', 'record_version', 'raw_value', 'unit', 'period', 'verification', 'original', 'recorded_at', 'business_as_of'],
    ...result.sources.map(source => [source.id, source.table, source.recordId, source.field, source.entityId, source.recordVersion, typeof source.rawValue === 'string' ? source.rawValue : JSON.stringify(source.rawValue) ?? '', source.unit, JSON.stringify(source.period), source.verification, JSON.stringify(source.original), source.recordedAt, source.businessAsOf]),
  ]);
  append('口径与快照', [
    ['key', 'value'], ['result_id', result.resultId], ['snapshot_id', result.snapshotId], ['data_version', result.dataVersion],
    ['registry_version', result.registryVersion], ['digest', resultDigest(result)], ...metadataRows('parameters', JSON.stringify(result.parameters)),
    ...metadataRows('analysis', JSON.stringify(result.analysis)), ...metadataRows('limitations', result.limitations.join('\n')),
    ['metadata_parts', '超过单元格限制的元数据按 part 序号拼接后解析，不截断。'],
    ['numeric_precision', '数据页为数值型展示近似值；精确值与来源页保留未舍入分子/分母。'],
    ['intended_use', '仅供内部分析；对客成品须另行核验与授权。'],
  ]);
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
