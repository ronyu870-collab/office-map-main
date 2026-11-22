import { expect, it } from 'vitest';
import { composeResponse, responseNarrative } from '../responsePresentation';
import { buildListResult } from '../result';
import { resultViewSchema } from '../presentation';
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
  expect(document.blocks.filter(block => block.type === 'summary')).toHaveLength(1);
  expect(document.blocks.some(block => block.type === 'table')).toBe(true);
  expect(responseNarrative('服务器已生成4行文件', value)).toBe('');
  value.parameters.responsePresentation = { version: 'response-presentation/1', narrativeRole: 'analysis' };
  expect(responseNarrative('部分文件失败，请重试。', value)).toContain('失败');
});
it('retains partial execution warnings alongside an otherwise valid legacy attachment', () => {
  const value = result(); value.parameters.agentExport = { version: 'agent-export/1', format: 'xlsx', singleSheet: false, matchedRows: 4, exportedRows: 4 };
  expect(responseNarrative('Excel已生成，但PDF未生成。', value, 'partial')).toContain('PDF未生成');
});
