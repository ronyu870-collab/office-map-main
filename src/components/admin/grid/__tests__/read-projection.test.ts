import { describe, expect, it } from 'vitest';
import { CORE_TABLE_CONFIGS } from '../../tableConfigs';
import { getGridReadPlan } from '../gridReadPlan';

const TABLES = ['building_metrics', 'building_current_data', 'lease_transactions'];

describe('admin grid projected field contract', () => {
  it.each(TABLES)('%s retains all displayed, editable, reference, and concurrency fields', tableName => {
    const config = CORE_TABLE_CONFIGS.find(item => item.table === tableName)!;
    expect(config).toBeDefined();
    const plan = getGridReadPlan(tableName)!;
    expect(plan).not.toBeNull();
    const columns = new Set(plan.columns.split(','));
    const required = [
      ...config.cols.map(column => column.sourceKey ?? column.key),
      ...(config.uploadMatchKeys ?? []),
      plan.tieBreaker,
      ...(Array.isArray(config.orderBy) ? config.orderBy.map(column => column.col) : config.orderBy ? [config.orderBy] : []),
    ].filter((column): column is string => typeof column === 'string');
    for (const column of required) expect(columns.has(column)).toBe(true);
    expect(columns.has('updated_at')).toBe(true);
  });
});
