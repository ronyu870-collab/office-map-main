import { readWorkbookBundle } from './workbookBundle';
import { projectResultTable } from './tableView';
import { presentWorkbook } from './workbookPresentation';
import { distributionAnalysisSchema, distributionStatLabels } from './distribution';
import { buildResultChart } from './charts';
import { resultViewSchema, resultSummary, units } from './presentation';
import type { QueryResult, ResultCell } from './result';
import { resultDigest } from './result';
import { metricLabels, resultMetricColumns, resultMetrics } from './multiMetricView';

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
  const singleSheet = (result.parameters.agentExport as { singleSheet?: boolean } | undefined)?.singleSheet === true;
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
    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    sheet['!cols'] = Array.from({ length: columnCount }, (_, index) => ({
      wch: rows.reduce((width, row) => Math.max(width, Math.min(60,
        Array.from(String(row[index] ?? '')).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 2 : 1), 0))), 14),
    }));
    if (singleSheet && workbook.SheetNames.length) {
      const target = workbook.Sheets[workbook.SheetNames[0]];
      if (XLSX.utils.decode_range(target['!ref']!).e.r + rows.length + 3 > 1048576) throw new Error('XLSX_DIMENSION_LIMIT');
      XLSX.utils.sheet_add_aoa(target, [[], [name], ...rows], { origin: -1 });
      return target;
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    return sheet;
  };
  const metadataRows = (key: string, value: string): string[][] => {
    if (value.length <= 30000) return [[key, value]];
    const count = Math.ceil(value.length / 30000);
    return [[`${key}:parts`, String(count)], ...Array.from({ length: count }, (_, index) => [`${key}:part:${String(index + 1).padStart(6, '0')}`, value.slice(index * 30000, (index + 1) * 30000)])];
  };
  const bundle = readWorkbookBundle(result.parameters);
  if (bundle) {
    const provenance: (string | number | null)[][] = [
      ['工作表', '结果编号', '数据版本', '来源编号', '来源表', '记录编号', '字段', '期别', '核验状态'],
    ];
    const methods: (string | number | null)[][] = [['工作表', '元数据', '值']];
    for (const { name, snapshot } of bundle.sheets) {
      const { table } = projectResultTable(snapshot);
      const sheet = append(name, [
        ['实体编号', ...table.columns.map(column => column.label + (column.unit ? ` (${units[column.unit] ?? column.unit})` : ''))],
        ...table.rows.map(row => [row.entityId, ...table.columns.map(column => {
          const cell = row.cells[column.key];
          return cell.kind === 'unknown' ? null : cellValue(cell);
        })]),
      ]);
      sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: table.rows.length, c: table.columns.length }) };
      for (const [index, column] of table.columns.entries()) if (column.unit === 'ratio') {
        for (let row = 1; row <= table.rows.length; row++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: index + 1 })];
          if (cell?.t === 'n') cell.z = '0.00%';
        }
      }
      for (const source of snapshot.sources) provenance.push([
        name, snapshot.resultId, snapshot.dataVersion, source.id, source.table, source.recordId, source.field,
        source.period ? `${source.period.year}Q${source.period.quarter}` : '', source.verification,
      ]);
      for (const [key, value] of [
        ['结果编号', snapshot.resultId], ['数据行数', String(table.rows.length)],
        ['范围及读取口径', JSON.stringify(snapshot.parameters)], ['限制', snapshot.limitations.join('\n')],
      ]) methods.push(...metadataRows(key, value).map(row => [name, ...row]));
    }
    append('来源', provenance);
    append('口径与快照', methods);
    return presentWorkbook(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
  }
  const dataSheet = append('数据', [
    [...(result.parameters.agentExport ? [] : ['entity_id']), ...result.table.columns.map(column => `${column.label}${column.unit ? ` (${column.unit})` : ''}`)],
    ...result.table.rows.map(row => [...(result.parameters.agentExport ? [] : [row.entityId]), ...result.table.columns.map(column => cellValue(row.cells[column.key]))]),
  ]);
  dataSheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 },
    { r: result.table.rows.length, c: result.table.columns.length - (result.parameters.agentExport ? 1 : 0) }) };
  result.table.columns.forEach((column, index) => {
    if (column.unit === 'ratio') result.table.rows.forEach((_, row) => {
      const cell = dataSheet[XLSX.utils.encode_cell({ r: row + 1, c: index + (result.parameters.agentExport ? 0 : 1) })];
      if (cell?.t === 'n') cell.z = '0.00%';
    });
  });
  if (result.operation === 'cross_aggregate') {
    // Reuse the exact axis/cell validator, then copy original typed cells. No
    // regrouping, pivot aggregate, fresh data read or rounded recomputation.
    const view = resultViewSchema.parse(result), metrics = resultMetrics(view);
    for (const [index, metric] of metrics.entries()) {
    const chart = buildResultChart(view, { kind: 'heatmap', ...(metrics.length > 1 ? { metric } : {}) }), grid = chart.grid!;
    const mapped = resultMetricColumns(view, metric);
    for (const [field, name] of [['value', '交叉指标'], ['usedCount', '交叉样本'], ['denominator', '交叉分母']] as const) {
      const column = result.table.columns.find(c => c.key === mapped[field])!;
      const sheet = append(index === 0 ? name : `${metricLabels[metric]}${name}`, [
        ['result_id', result.resultId], ['指标', `${column.label} (${units[column.unit ?? ''] ?? column.unit ?? ''})`],
        ['子市场 / 等级', ...grid.columns.map(c => c.label)],
        ...grid.rows.map((row, i) => [row.label, ...grid.columns.map((_, j) => {
          const cell = result.table.rows[i * grid.columns.length + j].cells[mapped[field]];
          return cell.kind === 'unknown' ? '未知（无有效样本）' : cellValue(cell);
        })]),
      ]);
      if (column.unit === 'ratio') grid.rows.forEach((_, i) => grid.columns.forEach((_, j) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: i + 3, c: j + 1 })];
        if (cell?.t === 'n') cell.z = '0.00%';
      }));
    }
    }
  }
  if (result.operation === 'distribution') {
    const d=distributionAnalysisSchema.parse(result.analysis);
    buildResultChart(resultViewSchema.parse(result),{kind:'histogram'});
    append('分位统计',[['result_id',result.resultId],['统计量',`数值 (${d.unit})`,'精确分子','精确分母'],
      ...(Object.keys(distributionStatLabels) as (keyof typeof distributionStatLabels)[]).map(key=>[distributionStatLabels[key],d.stats?.[key].numeric??'未知',d.stats?.[key].exact.numerator??'',d.stats?.[key].exact.denominator??'']),
      ['有效样本',d.coverage.valid],['排除样本',d.coverage.total-d.coverage.valid],['算法','Type 7；逐楼等权；1.5×IQR仅标记，不删除异常值'],
    ]);
    append('分箱统计',[['result_id',result.resultId],['区间','下界','上界','包含上界','栋数'],
      ...d.bins.map((b,i)=>[`区间 ${i+1}`,b.lower.numeric,b.upper.numeric,b.upperInclusive?'是':'否',b.count]),
      ['区间定义','左闭右开，最后一箱含上界；精确边界见口径与快照analysis'],
    ]);
    append('分箱成员',[['result_id',result.resultId],['区间','楼宇ID','来源ID'],...d.observations.filter(o=>o.bin!==null).map(o=>[`区间 ${o.bin!+1}`,o.entityId,o.sourceIds.join(';')])]);
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
  return presentWorkbook(new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
}
