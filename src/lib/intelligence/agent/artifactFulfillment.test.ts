import { describe, expect, it } from 'vitest';
import { artifactFulfillment, requestedArtifactFormats } from './artifactFulfillment';
import { buildListResult } from '../query/result';
import { fixture } from '../query/__tests__/fixtures';

describe('AI5 requested format completion evidence', () => {
  it.each(['Excel 是什么？', '是否支持 PNG 导出？', '如何实现 Word 生成？', '你好。'])('does not treat a capability discussion as a file task: %s', question => {
    expect(requestedArtifactFormats(question)).toEqual([]);
  });
  it('requires each requested format, not merely a successful export tool', () => {
    const result = { ...buildListResult(fixture(), ['height']), parameters: { agentExport: { format: 'xlsx' } } };
    expect(artifactFulfillment('把结果生成 Excel 和 CSV。', result)).toMatchObject({ available: ['xlsx'], missing: ['csv_zip'] });
    const chart = { ...result, parameters: { ...result.parameters, agentChart: { request: { kind: 'bar', field: 'height' } } } };
    expect(artifactFulfillment('生成 PNG 柱状图。', chart).missing).toEqual(['png_zip']);
  });
  it('honors explicit exclusions and does not let a trailing explanation hide an output request', () => {
    expect(requestedArtifactFormats('不要 Excel，把结果导出 CSV。')).toEqual(['csv_zip']);
    expect(requestedArtifactFormats('生成 PDF，不需要生成 Word。')).toEqual(['pdf']);
    expect(requestedArtifactFormats('生成 Excel，并说明建筑面积是什么。')).toEqual(['xlsx']);
  });
  it('accepts only generated research formats on the final archive', () => {
    const result = { ...buildListResult(fixture(), ['height']), parameters: { dataDomain: 'deep-research/1', agentReport: { format: 'docx' }, researchDeliverables: ['docx', 'pdf'] } };
    expect(artifactFulfillment('生成 Word/PPT/PDF/Excel。', result)).toMatchObject({ available: ['docx', 'pdf'], missing: ['xlsx', 'pptx'] });
    expect(artifactFulfillment('生成 PNG。', undefined).missing).toEqual(['png_zip']);
  });
});
