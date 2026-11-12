export const BATCH_COLUMNS = [
  { field: 'qQuote', label: '报价' },
  { field: 'qProp', label: '物业费' },
  { field: 'qFace', label: '表面租金' },
  { field: 'qFree', label: '免租期' },
  { field: 'qVacArea', label: '空置面积' },
  { field: 'qRemark', label: '备注' },
] as const;

export const cellNoteKey = (field: string) => `cellNote:${field}`;
const NOTE_MARKER = '\n\n【单元格备注】\n';

export function composeQuarterlyNotes(row: Record<string, unknown>): string | null {
  const remark = String(row.qRemark ?? '');
  const annotations = BATCH_COLUMNS.slice(0, -1).flatMap(({ field, label }) => {
    const note = String(row[cellNoteKey(field)] ?? '').trim();
    return note ? [`${label}：${JSON.stringify(note)}`] : [];
  });
  return annotations.length ? remark + NOTE_MARKER + annotations.join('\n') : remark || null;
}

export function restoreQuarterlyNotes(notes: string): Record<string, string> {
  const index = notes.lastIndexOf(NOTE_MARKER);
  if (index < 0) return { qRemark: notes };
  const result: Record<string, string> = { qRemark: notes.slice(0, index) };
  for (const line of notes.slice(index + NOTE_MARKER.length).split('\n')) {
    const sep = line.indexOf('：');
    const column = BATCH_COLUMNS.slice(0, -1).find(({ label }) => label === line.slice(0, sep));
    if (!column) return { qRemark: notes };
    try {
      const value: unknown = JSON.parse(line.slice(sep + 1));
      if (typeof value !== 'string') return { qRemark: notes };
      result[cellNoteKey(column.field)] = value;
    } catch { return { qRemark: notes }; }
  }
  return result;
}

export function parseQuarterlyTsv(input: string) {
  if (input.length > 150_000) throw new Error('粘贴内容过多，请分批处理。');
  const text = input.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!text.trim()) throw new Error('请粘贴至少一个有效单元格。');
  const rows: string[][] = [[]];
  let field = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else if (char === undefined) throw new Error('粘贴内容包含未闭合的引号。');
      else field += char;
    } else if (char === undefined || char === '\t' || char === '\n') {
      rows.at(-1)!.push(field);
      field = '';
      closed = false;
      if (char === '\n') rows.push([]);
    } else if (!closed && char === '"' && !field) quoted = true;
    else if (closed) throw new Error('粘贴内容的引号格式有误。');
    else field += char;
  }
  return rows;
}

export function serializeQuarterlyTsv(rows: string[][]) {
  return rows.map(row => row.map(cell => {
    // Spreadsheet apps may interpret pasted notes as a formula. Keep them as text.
    const value = /^[\s]*[=+\-@]/.test(cell) ? `'${cell}` : cell;
    return /["\t\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join('\t')).join('\n');
}

export function planQuarterlyBatch(input: string, startRow: number, startColumn: number, count: number, fillCount: number) {
  const source = parseQuarterlyTsv(input);
  if (fillCount > 1 && source.length !== 1) throw new Error('批量重复仅支持一行数据。');
  if (!Number.isInteger(fillCount) || fillCount < 1 || fillCount > count ||
      !Number.isInteger(startRow) || startRow < 0 || !Number.isInteger(startColumn) || startColumn < 0) throw new Error('请选择有效的填写范围。');
  const rows = fillCount > 1 ? Array.from({ length: fillCount }, () => source[0]) : source;
  if (startRow + rows.length > count || rows.some(row => startColumn + row.length > BATCH_COLUMNS.length)) {
    throw new Error('数据超出当前分类或可编辑列，未改动草稿。');
  }
  return rows.flatMap((row, offset) => row.map((raw, column) => {
    const { field, label } = BATCH_COLUMNS[startColumn + column];
    const value = field === 'qRemark' ? raw : raw.trim();
    if (field !== 'qRemark' && value && !/^\d+(?:\.\d+)?$/.test(value)) {
      throw new Error(`第 ${offset + 1} 行的${label}不是有效的非负数。`);
    }
    return { row: startRow + offset, field, label, value };
  }));
}
