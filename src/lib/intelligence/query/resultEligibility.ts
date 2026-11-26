import type { ChartRequest } from './chartSpec';
import { resultBuildingRows } from './buildingCards';
import { resultMetricColumns, resultMetrics, type ResultMetric } from './multiMetricView';
import type { QueryResultView } from './presentation';

/** Presentation eligibility only; authorization and source validation remain server-owned. */
export function resultNumericColumns(result: QueryResultView) {
  return result.table.columns.filter(column => column.unit !== null
    && result.table.rows.some(row => row.cells[column.key]?.kind === 'number')
    && result.table.rows.every(row => row.cells[column.key]?.kind !== 'text'));
}

export function resultMapEligible(result: QueryResultView): boolean {
  if (!['list', 'rank'].includes(result.operation)) return false;
  if (result.parameters.dataDomain === 'lease-research/1'
    && (result.parameters.scope as { mode?: string } | undefined)?.mode !== 'details') return false;
  const buildings = resultBuildingRows(result);
  // A scoped building used to compute an aggregate is not itself a result row.
  // Stacking plans explicitly bind their building cell and have a map contract.
  return buildings.some(building => Object.keys(building.cells).length > 0)
    || result.parameters.dataDomain === 'business-research/1'
      && result.parameters.businessTool === 'query_stacking_plan' && buildings.length > 0;
}

type Eligibility = { eligible: boolean; reason?: 'no_valid_values' | 'no_joint_sample' | 'insufficient_periods' | 'unsupported_shape' };
const yes: Eligibility = { eligible: true };
const no = (reason: NonNullable<Eligibility['reason']>): Eligibility => ({ eligible: false, reason });
const quarter = (value: unknown) => typeof value === 'string' && /^\d{4}-?Q[1-4]$/.test(value) ? value.replace('-', '') : null;

/** Both chart paths and HTTP generation use these same actual-cell conditions. */
export function resultChartEligibility(result: QueryResultView, request: ChartRequest): Eligibility {
  const numeric = new Set(resultNumericColumns(result).map(column => column.key));
  const keys = (key: string) => {
    const metric = 'metric' in request ? request.metric : undefined;
    return resultMetrics(result).length > 1 ? resultMetricColumns(result, metric ?? resultMetrics(result)[0])[key] ?? key : key;
  };
  const valid = (key: string) => numeric.has(keys(key));
  const rows = result.table.rows;
  if (request.kind === 'scatter' || request.kind === 'plot' && request.type === 'scatter') {
    const x = request.x, y = request.kind === 'scatter' ? request.y : request.y[0];
    if (x === y || !numeric.has(x) || !numeric.has(y)) return no('no_valid_values');
    return rows.some(row => row.cells[x]?.kind === 'number' && row.cells[y]?.kind === 'number') ? yes : no('no_joint_sample');
  }
  if (request.kind === 'time_series' || request.kind === 'grouped_time_series' || request.kind === 'plot' && request.type === 'line') {
    const x = request.kind === 'plot' ? request.x : 'period';
    const ys = request.kind === 'plot' ? request.y : [keys('value')];
    // Only real, distinct calendar periods qualify as a trend. No invented zero points.
    const series = new Map<string, Set<string>>();
    for (const row of rows) {
      const cell = row.cells[x];
      const period = cell?.kind === 'text' ? quarter(cell.value) : null;
      if (!period || request.kind === 'plot' && request.periods && !request.periods.some(item => quarter(item) === period)) continue;
      const groupKeys = request.kind === 'plot' ? request.groupBy ? [request.groupBy] : []
        : request.kind === 'grouped_time_series' ? ['name', ...(result.operation === 'cross_trend' ? ['grade'] : [])] : [];
      const group = groupKeys.map(key => { const cell = row.cells[key]; return cell?.kind === 'text' ? cell.value : ''; }).join('\u0000');
      for (const y of ys) if (row.cells[y]?.kind === 'number') {
        const key = `${group}\u0000${y}`, periods = series.get(key) ?? new Set<string>();
        periods.add(period); series.set(key, periods);
      }
    }
    return [...series.values()].some(periods => periods.size >= 2) && ys.some(y => numeric.has(y)) ? yes : no('insufficient_periods');
  }
  if (request.kind === 'period_comparison') return valid('base') || valid('current') ? yes : no('no_valid_values');
  if (request.kind === 'histogram' || request.kind === 'box_plot') return result.operation === 'distribution' && valid('value') ? yes : no('no_valid_values');
  if (request.kind === 'heatmap') return result.operation === 'cross_aggregate' && valid('value') ? yes : no('no_valid_values');
  if (request.kind === 'bar') return valid(request.field) ? yes : no('no_valid_values');
  if (request.kind === 'plot') {
    const x = result.table.columns.find(column => column.key === request.x);
    if (!x || x.unit !== null) return no('unsupported_shape');
    return request.y.some(y => numeric.has(y) && rows.some(row => row.cells[x.key]?.kind === 'text' && row.cells[y]?.kind === 'number')) ? yes : no('no_valid_values');
  }
  return no('unsupported_shape');
}

/** The default chart expresses the task; descriptive lists do not become scatter analyses. */
export function defaultResultChartRequest(result: QueryResultView, metric?: ResultMetric): ChartRequest | null {
  const multiple = resultMetrics(result).length > 1;
  const selection = multiple ? { metric: metric ?? resultMetrics(result)[0] } : {};
  const numeric = resultNumericColumns(result);
  const rankField = typeof result.parameters.field === 'string' ? result.parameters.field : null;
  const request: ChartRequest | null = result.operation === 'distribution' ? { kind: 'histogram' }
    : result.operation === 'relationship' ? { kind: 'scatter', x: 'rent', y: 'vacancy' }
      : result.operation === 'cross_aggregate' ? { kind: 'heatmap', ...selection }
        : ['group_trend', 'cross_trend'].includes(result.operation) ? { kind: 'grouped_time_series', ...selection }
          : result.operation === 'trend' ? { kind: 'time_series', ...selection }
            : result.operation === 'compare' ? { kind: 'period_comparison', ...selection }
              : result.operation === 'rank' && rankField ? { kind: 'bar', field: rankField, ...selection }
                : result.operation === 'group_aggregate' ? { kind: 'bar', field: multiple ? 'value' : numeric.find(column => column.key === 'value')?.key ?? '', ...selection } : null;
  if (result.operation === 'rank' && rankField && result.table.rows.filter(row => row.cells[rankField]?.kind === 'number').length < 2) return null;
  return request && resultChartEligibility(result, request).eligible ? request : null;
}

/** Conversation controls stay proportional; the same mounted table expands into the full workspace. */
export function resultTablePolicy(result: QueryResultView, expanded = false) {
  const explicitList = result.operation === 'list' && !result.parameters.dataDomain && !result.parameters.domain;
  const full = expanded || result.table.rows.length > 10 || explicitList;
  return { search: full, controls: full, selection: full && ['list', 'rank'].includes(result.operation),
    nestedScroll: expanded || result.table.rows.length > 10 };
}
