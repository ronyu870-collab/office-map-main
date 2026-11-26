import { reportPeriodRange } from '../query/reportProtocol';
import { parseQueryPlan } from '../query/plan';
import { STRUCTURED_DATA_SCHEMAS, type StructuredDataToolName } from './toolRegistry';

/** Single canonical translation for execution and request-local semantic deduplication. */
export function structuredQueryPlan(name: StructuredDataToolName, input: Record<string, unknown>) {
  const schema = STRUCTURED_DATA_SCHEMAS[name];
  schema.parse(input);
  let planInput: unknown;
  let nameContains: string | undefined;
  switch (name) {
    case 'execute_query_plan': { planInput = input.plan; break; }
    case 'query_report_market': {
      const args = STRUCTURED_DATA_SCHEMAS.query_report_market.parse(input);
      const range = reportPeriodRange(args.recentCompletedQuarters);
      planInput = args.recentCompletedQuarters === 1
        ? { operation: 'aggregate', scope: args.scope, metric: args.metric, period: range.end }
        : { operation: 'trend', scope: args.scope, metric: args.metric, mode: 'per_period', ...range };
      break;
    }
    case 'analyze_rent_vacancy': {
      const args = STRUCTURED_DATA_SCHEMAS.analyze_rent_vacancy.parse(input);
      planInput = { operation: 'relationship', ...args }; break;
    }
    case 'analyze_distribution': {
      const args = STRUCTURED_DATA_SCHEMAS.analyze_distribution.parse(input);
      planInput = { operation: 'distribution', ...args }; break;
    }
    case 'list_buildings': {
      const args = STRUCTURED_DATA_SCHEMAS.list_buildings.parse(input);
      planInput = { operation: 'list', scope: args.scope, fields: args.fields, period: args.period,
        ...(args.filter ? { filter: args.filter } : {}) };
      break;
    }
    case 'search_buildings': {
      const args = STRUCTURED_DATA_SCHEMAS.search_buildings.parse(input);
      planInput = { operation: 'list', scope: args.scope, period: null, fields: [] };
      nameContains = args.nameContains;
      break;
    }
    case 'get_building_profile': {
      const args = STRUCTURED_DATA_SCHEMAS.get_building_profile.parse(input);
      planInput = { operation: 'list', scope: { inventory: 'all_authorized', buildingIds: args.buildingIds },
        period: args.period ?? null, fields: args.fields ?? ['height', 'floors', 'parking'] };
      break;
    }
    case 'query_quarterly_metrics': {
      const args = STRUCTURED_DATA_SCHEMAS.query_quarterly_metrics.parse(input);
      planInput = { operation: 'aggregate', scope: args.scope, period: args.period,
        metric: args.metric, ...(args.metrics ? { metrics: args.metrics } : {}) };
      break;
    }
    case 'rank_buildings': {
      const args = STRUCTURED_DATA_SCHEMAS.rank_buildings.parse(input);
      planInput = { operation: 'rank', scope: args.scope, field: args.field,
        period: args.period ?? null, direction: args.direction, limit: args.limit,
        ...(args.filter ? { filter: args.filter } : {}) };
      break;
    }
    case 'compare_market_segments': {
      const args = STRUCTURED_DATA_SCHEMAS.compare_market_segments.parse(input);
      planInput = { operation: 'group_aggregate', scope: args.scope ?? { inventory: args.inventory, ...(args.submarkets ? { submarkets: args.submarkets } : {}) },
        period: args.period, metric: args.metric, ...(args.metrics ? { metrics: args.metrics } : {}), groupBy: args.groupBy };
      break;
    }
    case 'analyze_market_trends': {
      const args = STRUCTURED_DATA_SCHEMAS.analyze_market_trends.parse(input);
      // The tool schema and research DAG allow one quarter. Keep the formal
      // trend protocol's >=2 quarters boundary and use its existing aggregate
      // counterpart for one-period work, preserving the complete scope.
      const singleQuarter = args.start.year === args.end.year && args.start.quarter === args.end.quarter;
      planInput = { operation: singleQuarter ? args.groupBy ? 'group_aggregate' : 'aggregate' : args.groupBy ? 'group_trend' : 'trend',
        scope: args.scope, metric: args.metric,
        ...(singleQuarter ? { period: args.start } : { start: args.start, end: args.end, mode: args.mode }),
        ...(args.groupBy ? { groupBy: args.groupBy } : {}) };
      break;
    }
    default: throw new Error('AGENT_UNREGISTERED_TOOL');
  }
  return { plan: parseQueryPlan(planInput), nameContains };
}
