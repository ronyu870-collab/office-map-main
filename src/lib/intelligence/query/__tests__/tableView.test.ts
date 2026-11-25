import { describe, expect, it } from 'vitest';
import { buildListResult } from '../result';
import { resultViewSchema } from '../presentation';
import { tableRowIndexes, validatedResultTableView } from '../tableView';
import { Decimal } from '../decimal';
import { fixture } from './fixtures';

describe('authorized table numeric predicates', () => {
  it('compares exact source decimals rather than their rounded numeric projection', () => {
    const result = resultViewSchema.parse(buildListResult(fixture(), ['height']));
    for (const [index, value] of ['199.99999999999999999', '200', '200.00000000000000001'].entries()) {
      const exact = Decimal.parse(value)!;
      result.table.rows[index].cells.height = { kind: 'number', value: { numeric: exact.toNumber(), exact: exact.exact() }, sourceIds: [] };
    }
    expect(tableRowIndexes(result, '', { key: 'height', value: '200', operator: 'gte' }, null)).toEqual([1, 2]);
    expect(tableRowIndexes(result, '', { key: 'height', value: '200', operator: 'lte' }, null)).toEqual([0, 1]);
    expect(tableRowIndexes(result, '', { key: 'height', value: '200.0', operator: 'eq' }, null)).toEqual([1]);
  });

  it.each(['', ' ', '0xC8', 'Infinity'])('rejects non-decimal numeric predicates before archiving: %j', value => {
    const result = resultViewSchema.parse(buildListResult(fixture(), ['height']));
    expect(() => validatedResultTableView(result, { version: 'result-table-view/1', filters: [{ key: 'height', value, operator: 'gte' }] })).toThrow('AGENT_INVALID_TOOL_ARGUMENTS');
  });
});
