import { expect, it } from 'vitest';
import { snapshotCopyBusinessText } from './ai-query-p2-output-scenarios.mjs';

const snapshot = {
  dataVersion: '8f5af80f92a926aa4242abd0f3ad21645654c1ea86392cc15626f999957eaca8',
  resultId: '99999999-1111-4111-8111-111111111111',
};
const metadata = `结果编号：${snapshot.resultId}\n数据版本：${snapshot.dataVersion}`;

it('accepts the unchanged 170 snapshot when exact opaque identifiers contain 9999', () => {
  const text = `净有效租金为 170 元/㎡/月。有效 3 栋。\n${metadata}`;
  expect(text).toMatch(/9999|9,999/); // Reproduces the previous false positive.
  expect(snapshotCopyBusinessText(text, snapshot)).not.toMatch(/9999|9,999/);
  expect(snapshotCopyBusinessText(text, snapshot)).toContain('170 元/㎡/月');
});

it.each(['9999', '9,999'])('still rejects a changed business value %s beside legitimate metadata', value => {
  const text = `净有效租金为 ${value} 元/㎡/月。\n${metadata}`;
  expect(snapshotCopyBusinessText(text, snapshot)).toMatch(/9999|9,999/);
});
