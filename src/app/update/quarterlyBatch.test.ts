import { expect, it } from 'vitest';
import { BATCH_COLUMNS, cellNoteKey, planQuarterlyBatch, restoreQuarterlyNotes, serializeQuarterlyTsv } from './quarterlyBatch';
import { buildQuarterlySubmissionPayload } from './quarterlyDataEntry';

it('round-trips Excel tabs, newlines and quotes, while excluding computed columns', () => {
  const input = serializeQuarterlyTsv([['0', '1.23', '2', '3', '4', '业主说："可谈"\n见附件\t页 1']]);
  const cells = planQuarterlyBatch(input, 1, 0, 3, 2);
  expect(cells).toHaveLength(BATCH_COLUMNS.length * 2);
  expect(cells[0]).toMatchObject({ row: 1, field: 'qQuote', value: '0' });
  expect(cells.at(-1)).toMatchObject({ row: 2, field: 'qRemark', value: '业主说："可谈"\n见附件\t页 1' });
  expect(serializeQuarterlyTsv([['0', '=1+1', ' @备注']])).toBe("0\t'=1+1\t' @备注");
  expect(() => planQuarterlyBatch('1\t2', 0, 5, 3, 1)).toThrow('超出');
  expect(() => planQuarterlyBatch('1\n2', 2, 0, 3, 1)).toThrow('超出');
  expect(() => planQuarterlyBatch('100\t无效', 0, 0, 3, 1)).toThrow('非负数');
});

it('sends existing notes plus cell notes through the formal submission contract and restores both', () => {
  const notes = { qRemark: '普通备注', [cellNoteKey('qFace')]: '待对照\n来源："合成材料"' };
  const payload = buildQuarterlySubmissionPayload(notes, { userId: 'test', userName: 'test', year: 2026, quarter: 4, totalArea: 100 });
  expect(payload.notes).toContain('表面租金');
  expect(restoreQuarterlyNotes(payload.notes!)).toEqual(notes);
  expect(restoreQuarterlyNotes('旧备注\n\n【单元格备注】\n人工录入的旧文本')).toEqual({ qRemark: '旧备注\n\n【单元格备注】\n人工录入的旧文本' });
});
