'use client';

import * as React from 'react';
import { Button, Dialog, Input } from '@/src/components/ui';
import { BATCH_COLUMNS, planQuarterlyBatch, serializeQuarterlyTsv } from '../quarterlyBatch';

type Change = ReturnType<typeof planQuarterlyBatch>[number];

export function QuarterlyBatchEditor({ rows, initial, onClose, onApply }: {
  rows: { name: string; values: string[] }[];
  initial: { row: number; column: number; text: string };
  onClose: () => void;
  onApply: (changes: Change[]) => string | void;
}) {
  const [text, setText] = React.useState(initial.text);
  const [row, setRow] = React.useState(initial.row);
  const [column, setColumn] = React.useState(initial.column);
  const [repeat, setRepeat] = React.useState('1');
  const [preview, setPreview] = React.useState<Change[]>();
  const [error, setError] = React.useState('');
  const [showCopy, setShowCopy] = React.useState(false);
  const clear = () => { setPreview(undefined); setError(''); };
  const run = () => {
    try {
      const changes = planQuarterlyBatch(text, row, column, rows.length, Number(repeat));
      setError('');
      setPreview(changes);
    } catch (cause) {
      setPreview(undefined);
      setError(cause instanceof Error ? cause.message : '无法读取粘贴数据。');
    }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }} title="批量填写" size="lg"
    description={`当前分类共 ${rows.length} 个项目，按表格顺序填写。空白格会清空对应字段。`}
    footer={<><Button variant="secondary" onClick={onClose}>取消</Button><Button onClick={preview ? () => {
      const problem = onApply(preview);
      if (problem) setError(problem);
      else onClose();
    } : run}>{preview ? '写入草稿' : '预览填写'}</Button></>}>
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label>从项目开始<select className="mt-1 block min-h-11 w-full rounded-md border px-2" value={row} onChange={event => { setRow(Number(event.target.value)); clear(); }}>
        {rows.map((item, index) => <option key={index} value={index}>{index + 1}. {item.name}</option>)}
      </select></label>
      <label>起始字段<select className="mt-1 block min-h-11 w-full rounded-md border px-2" value={column} onChange={event => { setColumn(Number(event.target.value)); clear(); }}>
        {BATCH_COLUMNS.map(({ field, label }, index) => <option key={field} value={index}>{label}</option>)}
      </select></label>
      <label>单行重复填入几项<Input type="number" min={1} max={rows.length - row} value={repeat} onChange={event => { setRepeat(event.target.value); clear(); }} /></label>
      <label className="sm:col-span-2">粘贴表格内容<textarea rows={4} className="mt-1 block w-full rounded-md border p-2" value={text} onChange={event => { setText(event.target.value); clear(); }} /></label>
      <p className="sm:col-span-2">列顺序：{BATCH_COLUMNS.map(({ label }) => label).join('、')}。</p>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--cd-color-danger)]">{error}</p>}
    {preview && <div className="mt-3 text-sm">
      <p className="font-medium">{new Set(preview.map(item => item.row)).size} 个项目、{preview.length} 个单元格，清空 {preview.filter(item => !item.value).length} 格</p>
      <ul className="mt-2 max-h-48 overflow-auto divide-y divide-[var(--cd-color-border)]">
        {preview.map(item => <li key={`${item.row}:${item.field}`} className="break-words py-1.5">{rows[item.row]?.name ?? '项目已移出'} · {item.label}：{rows[item.row]?.values[BATCH_COLUMNS.findIndex(col => col.field === item.field)] || '空'} → {item.value || '空'}</li>)}
      </ul>
    </div>}
    <div className="mt-2 text-sm">
      <Button type="button" variant="ghost" onClick={() => setShowCopy(value => !value)}>{showCopy ? '收起复制区' : '复制当前分类'}</Button>
      {showCopy && <textarea aria-label="可复制的当前分类数据" className="block w-full rounded-md border p-2" rows={4} readOnly
        onFocus={event => event.currentTarget.select()} value={serializeQuarterlyTsv(rows.map(item => item.values))} />}
    </div>
  </Dialog>;
}
