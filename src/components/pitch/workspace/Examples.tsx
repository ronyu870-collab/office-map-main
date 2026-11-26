"use client";
import * as React from 'react';
import { TemplateParameters } from './Parameters';
import type { Generation } from '@/src/lib/pitch/business/protocol';
import type { WorkspacePart } from '@/src/lib/pitch/workspace/protocol';
import { Button } from '@/src/components/ui';
import { DECK_KITS } from '@/src/lib/pitch/templates/deckKits';
import { TemplatePicker, type Template } from './TemplatePicker';
import type { Call } from './client';
import styles from './workspace.module.css';
export function Examples({ call, templates, busy, onExample, onBundle, buildingIds, period }: {
    call: Call;
    templates: Template[];
    busy: boolean;
    onExample: (ids: string[], kit?: {
        id: string;
        version: number;
    }, newDemo?: boolean) => Promise<void>;
    onBundle: (part: WorkspacePart) => Promise<void>;
    buildingIds: string[];
    period: string;
}) {
    const [tab, setTab] = React.useState('examples'), [kitId, setKitId] = React.useState(DECK_KITS[0].id), [sections, setSections] = React.useState<string[]>(DECK_KITS[0].sections.map(s => s.templateId)), [error, setError] = React.useState('');
    const [active, setActive] = React.useState<string | null>(null), [configured, setConfigured] = React.useState<Record<string, Generation['parts'][number]>>({});
    const kit = DECK_KITS.find(k => k.id === kitId)!;
    const unavailable = sections.some(id => !templates.some(t => t.id === id));
    async function run(ids: string[], newDemo = false) { try {
        setError('');
        await onExample(ids, tab === 'kits' ? { id: kit.id, version: kit.version } : undefined, newDemo);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '示例暂未生成。');
    } }
    return <section className={styles.content} aria-label="示例素材与提案套装">
    <div className={styles.modeTabs} role="tablist" aria-label="示例浏览方式">{[['examples', '内容示例'], ['kits', '提案套装']].map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <p>示例均为合成资料。复制后保存在你的私人 Pitch 中；正式对客内容请选用已发布企业素材。</p>
    {error && <p role="alert">{error}</p>}
    {tab === 'examples' ? <TemplatePicker call={call} templates={templates} onChoose={t => void run([t.id])} favorites={[]} recent={[]} onFavorite={() => { }} exampleMode disabled={busy}/> : <>
      <label>提案套装<select aria-label="提案套装" value={kitId} onChange={e => { const next = DECK_KITS.find(k => k.id === e.target.value)!; setKitId(next.id); setActive(null); setConfigured({}); setSections(next.sections.map(s => s.templateId)); }}>{DECK_KITS.map(k => <option key={k.id} value={k.id}>{k.names.zh}</option>)}</select></label>
      <p>{kit.description}</p>
      <ol className={styles.kitSections}>{kit.sections.map((s, i) => { const template = templates.find(t => t.id === s.templateId); return <li key={s.templateId}><label><input type="checkbox" checked={sections.includes(s.templateId)} disabled={busy} onChange={e => setSections(v => e.target.checked ? [...v, s.templateId] : v.filter(id => id !== s.templateId))}/><span>{i + 1}. {template?.name ?? '当前不可用'}</span></label>{template && <Button variant="ghost" disabled={busy} onClick={() => setActive(template.id)}>{configured[template.id] ? '已配置 · 修改' : '选择正式素材'}</Button>}</li>; })}</ol>
      {active && templates.find(t => t.id === active) && <TemplateParameters key={active} call={call} template={templates.find(t => t.id === active)!} buildingIds={buildingIds} period={period} busy={busy} actionLabel="保存此页配置" initial={configured[active]} onGenerate={async (part) => { setConfigured(v => ({ ...v, [active]: part })); setActive(null); }}/>}
      <div className={styles.actions}><Button disabled={busy || unavailable || !sections.length || sections.some(id => !configured[id])} onClick={() => void onBundle({ mode: 'bundle', kit: { id: kit.id, version: kit.version }, parts: kit.sections.filter(s => sections.includes(s.templateId)).map(s => configured[s.templateId]) }).catch(e => setError(e instanceof Error ? e.message : '生成未完成'))}>使用已配置正式素材生成</Button><Button disabled={busy || unavailable || !sections.length} onClick={() => void run(kit.sections.filter(s => sections.includes(s.templateId)).map(s => s.templateId))}>加入选中示例页面</Button><Button variant="secondary" disabled={busy || unavailable || !sections.length} onClick={() => void run(kit.sections.filter(s => sections.includes(s.templateId)).map(s => s.templateId), true)}>创建演示 Pitch</Button></div>
    </>}
  </section>;
}
