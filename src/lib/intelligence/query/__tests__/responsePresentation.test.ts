import { expect, it } from 'vitest';
import { composeResponse, responseNarrative, responseDecision, responseFactCells } from '../responsePresentation';
import { buildListResult, buildTrendResult } from '../result';
import { resultViewSchema, type QueryResultView } from '../presentation';
import { fixture } from './fixtures';
const result = () => resultViewSchema.parse(buildListResult(fixture(), ['height']));
it('preserves prose about servers and arbitrary user content without keyword removal', () => {
  expect(responseNarrative('服务器如何生成 Excel？')).toBe('服务器如何生成 Excel？');
  expect(responseNarrative('服务器正在生成市场报告。', result())).toBe('服务器正在生成市场报告。');
});
it('separates typed delivery status and result summaries; unknown versions safely retain narrative', () => {
  const value = result();
  value.parameters.responsePresentation = { version: 'response-presentation/1', narrativeRole: 'delivery_status' };
  expect(responseNarrative('执行状态', value)).toBe('');
  value.parameters.responsePresentation = { version: 'response-presentation/2', narrativeRole: 'unknown' };
  expect(responseNarrative('保留说明', value)).toBe('保留说明');
  expect(composeResponse('保留说明', value).blocks.some(block => block.type === 'table')).toBe(true);
});
it('adapts legacy file history to one attachment without losing the saved table', () => {
  const value = result();
  value.parameters.agentExport = { version: 'agent-export/1', format: 'xlsx', singleSheet: false, matchedRows: 4, exportedRows: 4 };
  const document = composeResponse('服务器已生成4行文件', value);
  expect(document.blocks.filter(block => block.type === 'file')).toHaveLength(1);
  expect(document.blocks.filter(block => block.type === 'summary')).toHaveLength(0);
  expect(responseDecision(value).details).toBe('on_demand');
  expect(document.blocks.some(block => block.type === 'table')).toBe(true);
  expect(responseNarrative('服务器已生成4行文件', value)).toBe('');
  value.parameters.responsePresentation = { version: 'response-presentation/1', narrativeRole: 'analysis' };
  expect(responseNarrative('部分文件失败，请重试。', value)).toContain('失败');
});
it('retains partial execution warnings alongside an otherwise valid legacy attachment', () => {
  const value = result(); value.parameters.agentExport = { version: 'agent-export/1', format: 'xlsx', singleSheet: false, matchedRows: 4, exportedRows: 4 };
  expect(responseNarrative('Excel已生成，但PDF未生成。', value, 'partial')).toContain('PDF未生成');
});

it('uses trusted operation and validated delivery shape for dynamic composition without mutating snapshots', () => {
  const value = result(), original = JSON.stringify(value);
  const types = (operation: QueryResultView['operation']) => composeResponse(undefined, { ...value, operation }).blocks.map(block => block.type);
  expect(types('rank').indexOf('analysis')).toBeLessThan(types('rank').indexOf('table'));
  expect(types('trend').indexOf('analysis')).toBeLessThan(types('trend').indexOf('table'));
  expect(composeResponse('你好').layout).toBe('conversation');
  value.parameters.agentExport = { version: 'agent-export/1', format: 'xlsx', singleSheet: false, matchedRows: 4, exportedRows: 4 };
  const document = composeResponse(undefined, value);
  expect(document.layout).toBe('delivery');
  expect(document.blocks.map(block => block.type).indexOf('file')).toBeLessThan(document.blocks.map(block => block.type).indexOf('table'));
  delete value.parameters.agentExport;
  expect(JSON.stringify(value)).toBe(original);
});

it('keeps an unknown lease check out of the default data expression without inventing zero', () => {
  const value = result();
  value.parameters = { dataDomain: 'lease-research/1', scope: { mode: 'aggregate' } };
  value.table = { id: 'lease', columns: [{ key: 'count', label: '成交记录数', unit: 'transaction_count' }, { key: 'area', label: '成交面积', unit: 'm2' }],
    rows: [{ entityId: 'period', cells: { count: { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: [] }, area: { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: [] } } }] };
  expect(composeResponse(undefined, value).blocks.map(block => block.type)).not.toContain('analysis');
  expect(composeResponse(undefined, value).blocks.map(block => block.type)).not.toContain('summary');
  expect(responseDecision(value)).toMatchObject({ status: 'unavailable', primaryExpression: 'status', details: 'on_demand' });
  expect(responseFactCells(value)).toHaveLength(0);
});
it('uses an original metric cell for a fact and leaves secondary sample columns in detail', () => {
  const value = result(); value.operation = 'aggregate';
  value.parameters.metric = 'rent';
  const sourceCell = value.table.rows[0].cells.height;
  value.table = { id: 'fact', columns: [{ key: 'value', label: '净有效租金', unit: 'CNY/m2/month' }, { key: 'usedCount', label: '有效样本', unit: 'building_count' }],
    rows: [{ entityId: 'total', cells: { value: sourceCell, usedCount: sourceCell } }] };
  expect(composeResponse(undefined, value).blocks.some(block => block.type === 'summary')).toBe(false);
  expect(responseFactCells(value).map(item => item.column.key)).toEqual(['value']);
  expect(responseDecision(value).primaryExpression).toBe('fact');
});
it('degrades a trend with its only valid point after missing periods to that exact dated fact', () => {
  const value = resultViewSchema.parse(buildTrendResult([1, 2, 3, 4].map(quarter => fixture({ year: 2026, quarter: quarter as 1 | 2 | 3 | 4 })), 'rent', 'per_period'));
  for (const row of value.table.rows.slice(0, 3)) row.cells.value = { kind: 'unknown', state: 'missing', reason: 'no_valid_sample', sourceIds: row.cells.value.sourceIds };
  const original = JSON.stringify(value), point = value.table.rows[3];
  expect(responseDecision(value).primaryExpression).toBe('fact');
  const facts = responseFactCells(value);
  expect(facts).toHaveLength(1);
  expect(facts[0].cell).toBe(point.cells.value);
  expect(facts[0].label).toContain('2026-Q4');
  expect(JSON.stringify(value)).toBe(original);
});
