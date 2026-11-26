import * as React from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useUnsavedNavigation } from '@/src/lib/broker/useUnsavedNavigation';
import { SubmarketEditorField as Field } from './SubmarketEditorField';
import { SubmarketIntelligenceEditor } from './SubmarketIntelligenceEditor';
import type { MarketBuilding } from '../model/marketStatistics';
import type { SubmarketProfileDraft } from '../model/submarketProfile';

const quietButton = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[6px] border border-[#d9e0e8] bg-white px-3 text-[14px] text-[#334155] hover:bg-[#f8fafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#003e7e]';
const outlineButton = 'workspace-icon';

export function SubmarketProfileEditor({ name, value, saving, error, onCancel, onSave, buildings }: {
  name: string;
  buildings: readonly MarketBuilding[];
  value: SubmarketProfileDraft;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (value: SubmarketProfileDraft, publish: boolean) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  useUnsavedNavigation(dirty);
  const setText = (field: 'headline' | 'overview' | 'industries' | 'transport', text: string) =>
    setDraft(previous => ({ ...previous, [field]: text }));
  const change = (kind: 'demographics' | 'policies' | 'insights', index: number, key: string, next: string) => {
    setDraft(previous => ({
      ...previous,
      [kind]: previous[kind].map((entry, position) => position === index ? { ...entry, [key]: next } : entry),
    }));
  };
  const remove = (kind: 'demographics' | 'policies' | 'insights', index: number) =>
    setDraft(previous => ({ ...previous, [kind]: previous[kind].filter((_, position) => position !== index) }));
  const add = (kind: 'demographics' | 'policies' | 'insights') =>
    setDraft(previous => {
      if (kind === 'demographics') return { ...previous, demographics: [...previous.demographics,
        { label: '', value: '', unit: '', scope: '', asOf: '', sourceUrl: '' }] };
      if (kind === 'policies') return { ...previous, policies: [...previous.policies,
        { title: '', issuer: '', summary: '', applicability: '', asOf: '', sourceUrl: '' }] };
      return { ...previous, insights: [...previous.insights,
        { title: '', body: '', author: '', asOf: '' }] };
    });
  const addButton = (kind: 'demographics' | 'policies' | 'insights', title: string, disabled: boolean) => (
    <button type="button" disabled={disabled} className={quietButton + ' disabled:opacity-40'} onClick={() => add(kind)}>
      <Plus size={14} /> 添加{title}
    </button>
  );

  return (
    <form className="submarket-editor-form space-y-5" onSubmit={event => { event.preventDefault(); onSave(draft, true); }}>
      <p className="m-0 text-[14px] leading-6 text-[#667085]">
        正在维护{name}的区域展示资料。保存后自动同步到客户展示页，无需额外审核；请勿填写草稿、内部说明或未经确认的数字。
      </p>
      <SubmarketIntelligenceEditor name={name} research={draft.research ?? null} buildings={buildings}
        disabled={saving} onChange={research => setDraft(previous => ({ ...previous, research }))} />
      <details open={!value.research} className="submarket-legacy-fields space-y-4">
      <summary>旧版资料</summary>
      <div className="space-y-3">
        <Field label="一句话定位" value={draft.headline} onChange={text => setText('headline', text)} />
        <Field label="区域概况" value={draft.overview} multi onChange={text => setText('overview', text)} />
        <Field label="产业与需求" value={draft.industries} multi onChange={text => setText('industries', text)} />
        <Field label="交通与通勤" value={draft.transport} multi onChange={text => setText('transport', text)} />
      </div>

      <div className="space-y-3 border-t border-[#e7ebf0] pt-4">
        <h4 className="m-0 text-sm font-semibold">人口与就业事实</h4>
        {draft.demographics.map((row, index) => (
          <div key={index} className="space-y-2 rounded-[6px] border border-[#d9e0e8] bg-[#f8fafc] p-3">
            <div className="flex justify-between"><span className="text-xs text-[#667085]">事实 {index + 1}</span>
              <button type="button" aria-label="删除人口事实" onClick={() => remove('demographics', index)} className={outlineButton}><Trash2 size={14}/></button></div>
            <div className="submarket-editor-fields grid gap-2">
              <Field label="名称" value={row.label} onChange={v => change('demographics', index, 'label', v)} />
              <Field label="数值" value={row.value} onChange={v => change('demographics', index, 'value', v)} />
              <Field label="单位" value={row.unit} onChange={v => change('demographics', index, 'unit', v)} />
              <Field label="数据截至" value={row.asOf} onChange={v => change('demographics', index, 'asOf', v)} />
            </div>
            <Field label="统计地域范围" value={row.scope} onChange={v => change('demographics', index, 'scope', v)} />
            <Field label="https 来源链接" value={row.sourceUrl} onChange={v => change('demographics', index, 'sourceUrl', v)} />
          </div>
        ))}
        {addButton('demographics', '事实', draft.demographics.length >= 12)}
      </div>

      <div className="space-y-3 border-t border-[#e7ebf0] pt-4">
        <h4 className="m-0 text-sm font-semibold">政策与规划</h4>
        {draft.policies.map((row, index) => (
          <div key={index} className="space-y-2 rounded-[6px] border border-[#d9e0e8] bg-[#f8fafc] p-3">
            <div className="flex justify-between"><span className="text-xs text-[#667085]">政策 {index + 1}</span>
              <button type="button" aria-label="删除政策" onClick={() => remove('policies', index)} className={outlineButton}><Trash2 size={14}/></button></div>
            <Field label="政策名称" value={row.title} onChange={v => change('policies', index, 'title', v)} />
            <div className="submarket-editor-fields grid gap-2">
              <Field label="发布机构" value={row.issuer} onChange={v => change('policies', index, 'issuer', v)} />
              <Field label="发布时间／有效期" value={row.asOf} onChange={v => change('policies', index, 'asOf', v)} />
            </div>
            <Field label="核心内容" multi value={row.summary} onChange={v => change('policies', index, 'summary', v)} />
            <Field label="适用地区及条件" multi value={row.applicability} onChange={v => change('policies', index, 'applicability', v)} />
            <Field label="https 原文链接" value={row.sourceUrl} onChange={v => change('policies', index, 'sourceUrl', v)} />
          </div>
        ))}
        {addButton('policies', '政策', draft.policies.length >= 20)}
      </div>

      <div className="space-y-3 border-t border-[#e7ebf0] pt-4">
        <h4 className="m-0 text-sm font-semibold">团队观点</h4>
        {draft.insights.map((row, index) => (
          <div key={index} className="space-y-2 rounded-[6px] border border-[#d9e0e8] bg-[#f8fafc] p-3">
            <div className="flex justify-between"><span className="text-xs text-[#667085]">观点 {index + 1}</span>
              <button type="button" aria-label="删除观点" onClick={() => remove('insights', index)} className={outlineButton}><Trash2 size={14}/></button></div>
            <Field label="标题" value={row.title} onChange={v => change('insights', index, 'title', v)} />
            <Field label="观点内容与依据" multi value={row.body} onChange={v => change('insights', index, 'body', v)} />
            <div className="submarket-editor-fields grid gap-2">
              <Field label="负责人" value={row.author} onChange={v => change('insights', index, 'author', v)} />
              <Field label="观点截至" value={row.asOf} onChange={v => change('insights', index, 'asOf', v)} />
            </div>
          </div>
        ))}
        {addButton('insights', '观点', draft.insights.length >= 12)}
      </div>

      </details>
      {error ? <p role="alert" className="text-[14px] text-[#c9362b]">{error}</p> : null}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[#e7ebf0] bg-white py-3">
        <button type="button" className={quietButton} disabled={saving} onClick={() => {
          if (!dirty || window.confirm('有未保存的修改，确定放弃吗？')) onCancel();
        }}>取消</button>
        <button type="submit" disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-[#003e7e] px-4 text-[14px] font-normal text-white disabled:opacity-50">
          <Save size={15}/>{saving ? '保存中…' : '保存并展示'}
        </button>
      </div>
    </form>
  );
}
