'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useAppSession } from '@/src/components/SessionProvider';
import { WorkspaceShell } from '@/src/components/layout';
import { AppHeader, Button } from '@/src/components/ui';
import { supabase } from '@/src/services/supabaseClient';
import { scopeSchema, slideContentSchema } from '@/src/lib/pitch/contracts/content';
import type { AuthSessionResult } from '@/src/services/Auth';
import styles from './pitch.module.css';
import { MaterialLibrary } from './library/MaterialLibrary';
import { BusinessStudio, BusinessHistory } from './business/BusinessStudio';
import { ScenePreview } from './ScenePreview';
import { LAYOUTS } from '@/src/lib/pitch/layout/definitions';
import { slideSceneSchema, type LayoutId } from '@/src/lib/pitch/contracts/scene';

const scopeGrantSchema = scopeSchema.extend({ region: z.string().nullable(), city: z.string().nullable(), businessLine: z.string().nullable(), canGenerate: z.boolean(), canMaintain: z.boolean(), canAdmin: z.boolean(), canClientExport: z.boolean(), canExternalAi: z.boolean() });
const catalogSchema = z.object({ scopes: z.array(scopeGrantSchema), categories: z.array(z.object({ id: z.uuid(), system_code: z.string(), names: z.record(z.string(), z.string()), enabled: z.boolean(), revision: z.number() })), templates: z.array(z.object({ id: z.string(), names: z.record(z.string(), z.string()), current_version: z.number() })), themes: z.array(z.object({ id: z.string(), current_version: z.number() })) });
const assetSchema = z.object({ id: z.uuid(), names: z.record(z.string(), z.string()), state: z.string(), current_version: z.number(), is_test_data: z.boolean() });
const projectSchema = z.object({ id: z.uuid(), title: z.string(), is_test_data: z.boolean() });
const detailSchema = z.object({ project: projectSchema.extend({ theme_id: z.string(), theme_version: z.number(), version: z.number() }), slides: z.array(z.object({ id: z.uuid(), asset_id: z.uuid(), scene: slideSceneSchema, content: slideContentSchema, template_id: z.string(), template_version: z.number() })), exports: z.array(z.object({ id: z.uuid(), state: z.string(), format: z.string(), filename: z.string().nullable().optional(), audience: z.enum(['internal', 'client']) })) });
type Catalog = z.infer<typeof catalogSchema>;
type Detail = z.infer<typeof detailSchema>;
type Panel = 'quick' | 'assets' | 'templates' | 'projects' | 'admin';
const panels: { id: Panel; label: string }[] = [{ id: 'quick', label: '快速生成' }, { id: 'assets', label: '企业素材库' }, { id: 'templates', label: '模板中心' }, { id: 'projects', label: '我的 Pitch' }, { id: 'admin', label: '管理中心' }];
export function PitchWorkspace() {
  const { session, status } = useAppSession();
  const router = useRouter();
  React.useEffect(() => { if (status === 'unauthenticated') router.replace('/login'); }, [router, status]);
  return <WorkspaceShell header={<AppHeader title="Pitch Studio" homeHref="/" />}>
    {status !== 'authenticated' || !session ? <div className={styles.workspace}>正在读取登录状态…</div>
      : <ScopedPitch key={JSON.stringify([session.session.user.id, session.user.id, session.role, session.session.access_token])} session={session} />}
  </WorkspaceShell>;
}
function ScopedPitch({ session }: { session: AuthSessionResult }) {
  const [panel, setPanel] = React.useState<Panel>('quick');
  const [catalog, setCatalog] = React.useState<Catalog | null>(null);
  const [assets, setAssets] = React.useState<z.infer<typeof assetSchema>[]>([]);
  const [projects, setProjects] = React.useState<z.infer<typeof projectSchema>[]>([]);
  const [, setAssetNext] = React.useState<string | null>(null), [projectNext, setProjectNext] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(''), [title, setTitle] = React.useState('测试 Pitch');
  const [layoutId, setLayoutId] = React.useState<LayoutId>('image-text');
  const [fixtureLanguage, setFixtureLanguage] = React.useState<'zh' | 'en'>('zh');
  const [deckParts, setDeckParts] = React.useState<{ assetId: string; layoutId: LayoutId; variant: 'standard' }[]>([]);
  const [upgradeRequest, setUpgradeRequest] = React.useState<string | null>(null);
  const [upgradeTheme, setUpgradeTheme] = React.useState('');
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
  const [categoryName, setCategoryName] = React.useState(''), [categoryCode, setCategoryCode] = React.useState('');
  const [sampleRequest, setSampleRequest] = React.useState<string | null>(null);
  const [projectRequest, setProjectRequest] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  const simulated = session.session.user.id !== session.user.id;
  const token = session.session.access_token;
  const call = React.useCallback(async (input: Record<string, unknown>, write = false) => {
    if (simulated) throw new Error('模拟身份暂不支持 Pitch Studio，请退出模拟。');
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== session.session.user.id) throw new Error('登录身份已变化，请重新打开。');
    const query = new URLSearchParams(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    const response = await fetch('/api/intelligence/pitch' + (write ? '' : '?' + query), {
      method: write ? 'POST' : 'GET', cache: 'no-store', signal: controller.current?.signal,
      headers: { Authorization: 'Bearer ' + (data.session?.access_token ?? token), ...(write ? { 'Content-Type': 'application/json' } : {}) }, ...(write ? { body: JSON.stringify(input) } : {}),
    });
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || '操作失败，请重试。'); }
    return input.action === 'download' ? response.blob() : response.json();
  }, [session.session.user.id, simulated, token]);
  const load = React.useCallback(async () => {
    const [c, a, p] = await Promise.all([call({ action: 'catalog' }), call({ action: 'list_assets' }), call({ action: 'list_projects' })]);
    setCatalog(catalogSchema.parse(c)); setAssets(z.array(assetSchema).parse(a.items)); setProjects(z.array(projectSchema).parse(p.items)); setAssetNext(a.next); setProjectNext(p.next);
  }, [call]);
  React.useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    void Promise.resolve().then(load).catch(e => { if (!abort.signal.aborted) setMessage(e.message); });
    return () => { abort.abort(); controller.current = null; };
  }, [load]);
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await fn(); } catch (e) { if (!controller.current?.signal.aborted) setMessage(e instanceof Error ? e.message : '操作未完成。'); } finally { setBusy(false); } };
  const canGenerate = catalog?.scopes.some(s => s.canGenerate) ?? false;
  const canAdmin = catalog?.scopes.some(s => s.canAdmin) ?? false;
  const openProject = async (id: string) => { setDetail(detailSchema.parse(await call({ action: 'get_project', projectId: id }))); setPanel('projects'); };
  const download = async (id: string, audience: 'internal' | 'client') => {
    if (!detail) return;
    const blob: Blob = await call({ action: 'download', projectId: detail.project.id, exportId: id, audience });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = detail.exports.find(e => e.id === id)?.filename ?? 'pitch.pptx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className={styles.workspace} aria-busy={busy}>
    <div className={styles.intro}><h1>Pitch Studio</h1><p>内部试点 · 临时主题未经品牌确认</p></div>
    <nav className={styles.nav} aria-label="Pitch Studio 板块">{panels.map(p => <button type="button" key={p.id} aria-current={panel === p.id ? 'page' : undefined} onClick={() => setPanel(p.id)}>{p.label}</button>)}</nav>
    {message && <p role="status" className={styles.message}>{message}</p>}
    {!catalog ? <p>{message ? '当前无法进入试点。' : '正在读取试点权限…'}</p> : <>
      {panel === 'quick' && <section className={styles.section}><h2>从素材生成提案</h2><p>测试素材与真实业务素材分别标识。生成结果保存为你的私人项目。</p>
        <div className={styles.form}>
          <label>内容素材<select value={selected} onChange={e => { setSelected(e.target.value); setProjectRequest(null); }}><option value="">请选择</option>{assets.map(a => <option key={a.id} value={a.id}>{a.names.zh ?? a.names.en}{a.is_test_data ? ' · 测试数据' : ''}</option>)}</select></label>
          <label>页面布局<select value={layoutId} onChange={e => { setLayoutId(e.target.value as LayoutId); setProjectRequest(null); setSampleRequest(null); }}>{LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.zh}</option>)}</select></label>
          <p>{LAYOUTS.find(l => l.id === layoutId)?.pagination}</p>
          <label>测试素材语言<select value={fixtureLanguage} onChange={e => { setFixtureLanguage(e.target.value as typeof fixtureLanguage); setSampleRequest(null); }}><option value="zh">中文</option><option value="en">English</option></select></label>
          <label>项目名称<input value={title} maxLength={160} onChange={e => { setTitle(e.target.value); setProjectRequest(null); }} /></label>
          <div className={styles.actions}><Button disabled={busy || !canGenerate || (!selected && !deckParts.length) || !title.trim()} onClick={() => void run(async () => {
            const projectId = projectRequest ?? crypto.randomUUID(); setProjectRequest(projectId);
            await call({ action: 'project_compose', projectId, title: title.trim(), parts: deckParts.length ? deckParts : [{ assetId: selected, layoutId, variant: 'standard' }], themeId: 'colliers-default-v1', themeVersion: 2 }, true);
            await openProject(projectId); await load(); setProjectRequest(null); setDeckParts([]); setMessage('项目和全部页面已保存。');
          })}>生成并保存</Button><Button variant="secondary" disabled={busy || !canGenerate || !selected || deckParts.length >= 12} onClick={() => { setDeckParts(v => [...v, { assetId: selected, layoutId, variant: 'standard' }]); setProjectRequest(null); }}>添加此内容到提案</Button><Button variant="secondary" disabled={busy || !canGenerate} onClick={() => void run(async () => {
            const grant = catalog.scopes.find(s => s.canGenerate && s.region && s.city && s.businessLine);
            if (!grant) throw new Error('请联系管理员分配明确的试点城市、区域和业务线。');
            const requestId = sampleRequest ?? crypto.randomUUID(); setSampleRequest(requestId);
            const out = await call({ action: 'sample_create', requestId, fixture: layoutId, language: fixtureLanguage, scope: { organizationId: grant.organizationId, region: grant.region, city: grant.city, businessLine: grant.businessLine } }, true);
            setSelected(out.assetId); await load(); setSampleRequest(null); setMessage('测试素材已归档，不代表真实案例。');
          })}>创建测试素材</Button></div>
        </div>{deckParts.length > 0 && <ol className={styles.list}>{deckParts.map((part, i) => <li key={i}><span>{i + 1}. {assets.find(a => a.id === part.assetId)?.names.zh ?? '素材'} · {LAYOUTS.find(l => l.id === part.layoutId)?.zh}</span><Button variant="secondary" disabled={busy} onClick={() => { setDeckParts(v => v.filter((_, n) => n !== i)); setProjectRequest(null); }}>移除此内容</Button></li>)}</ol>}{!canGenerate && <p>当前身份只读，可以查看已授权素材和已有项目。</p>}
      </section>}
      {panel === 'assets' && <MaterialLibrary userId={session.session.user.id} simulated={simulated} scopes={catalog.scopes} categories={catalog.categories} themes={catalog.themes} onProject={async id => { await openProject(id); await load(); }} />}
      {panel === 'templates' && <BusinessStudio userId={session.session.user.id} simulated={simulated} scopes={catalog.scopes} themes={catalog.themes} categories={catalog.categories} onProject={async id => { await openProject(id); await load(); }} />}
      {panel === 'projects' && <section className={styles.section}><h2>我的 Pitch</h2><ul className={styles.list}>{projects.map(p => <li key={p.id}><div><strong>{p.title}</strong>{p.is_test_data && <p>测试数据 · 非真实案例</p>}</div><Button variant="secondary" disabled={busy} onClick={() => void run(() => openProject(p.id))}>打开项目</Button></li>)}</ul>{projects.length === 0 && <p>还没有私人项目，请从素材生成单页。</p>}{projectNext && <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const out = await call({ action: 'list_projects', before: projectNext }); setProjects(v => [...v, ...z.array(projectSchema).parse(out.items)]); setProjectNext(out.next); })}>加载更多项目</Button>}
        {detail && <article className={styles.detail}><h2>{detail.project.title}</h2>{detail.slides.map(s => <div key={s.id} className={styles.slide}><h3>{s.content.title}</h3>{s.content.blocks.map((b, i) => b.kind === 'paragraph' ? <p key={i}>{b.text}</p> : b.kind === 'image' ? <p key={i}>配图：{b.alt}</p> : null)}<p>数据时间：{s.content.dataAsOf} · {s.content.sources.map(r => r.label).join('；')}</p></div>)}
          <ScenePreview key={detail.project.id} project={detail.project} slides={detail.slides} themes={catalog.themes} call={call} canGenerate={canGenerate} onSaved={async () => { await openProject(detail.project.id); await load(); }} />
          {detail.slides.some(s => s.template_id === 'business-content') && <BusinessHistory key={detail.project.id} projectId={detail.project.id} userId={session.session.user.id} simulated={simulated} onProject={async id => { await openProject(id); await load(); }} />}
          <ul className={styles.list}>{detail.exports.map(e => <li key={e.id}><span>{e.filename ?? e.format.toUpperCase()} · {e.audience === 'internal' ? '内部文件' : '对客文件'} · {e.state === 'ready' ? '已归档' : e.state === 'pending' ? '等待完成' : '生成失败'}</span>{e.state === 'ready' && <Button variant="secondary" disabled={busy || !canGenerate} onClick={() => void run(() => download(e.id, e.audience))}>下载已归档文件</Button>}</li>)}</ul>
          {canGenerate && <div className={styles.form}><label>另存为新主题版本<select value={upgradeTheme} onChange={e => { setUpgradeTheme(e.target.value); setUpgradeRequest(null); }}><option value="">请选择主题</option>{catalog.themes.filter(t => t.id !== detail.project.theme_id || t.current_version !== detail.project.theme_version).map(t => <option key={t.id} value={JSON.stringify([t.id, t.current_version])}>{t.id} · 版本 {t.current_version}</option>)}</select></label><Button variant="secondary" disabled={busy || !upgradeTheme} onClick={() => void run(async () => {
            const [themeId, themeVersion] = JSON.parse(upgradeTheme), projectId = upgradeRequest ?? crypto.randomUUID(); setUpgradeRequest(projectId);
            await call({ action: 'project_theme_upgrade', sourceProjectId: detail.project.id, projectId, expectedVersion: detail.project.version, themeId, themeVersion }, true);
            await openProject(projectId); await load(); setUpgradeRequest(null); setUpgradeTheme(''); setMessage('已另存新主题版本，原项目及导出文件保留。');
          })}>另存新版本</Button></div>}
          <details><summary>版本与来源</summary><p>主题：{detail.project.theme_id} · 版本 {detail.project.theme_version}</p>{detail.slides.map(s => <p key={s.id}>{s.template_id} · 版本 {s.template_version}；{s.content.sources.map(r => `${r.label} / ${r.locator} / ${r.version}`).join('；')}</p>)}</details>
        </article>}
      </section>}
      {panel === 'admin' && <section className={styles.section}><h2>管理中心</h2><p>{canAdmin ? '维护内容分类。系统能力标识创建后保持稳定。' : '分类管理需要管理员权限；素材维护权限独立分配。'}</p><ul className={styles.list}>{catalog.categories.map(c => <li key={c.id}><span>{c.names.zh ?? c.names.en} · {c.enabled ? '可用' : '停用'}</span>{canAdmin && <Button variant="secondary" disabled={busy || c.system_code === 'general'} onClick={() => void run(async () => { await call({ action: 'category_save', id: c.id, expectedRevision: c.revision, systemCode: c.system_code, names: c.names, enabled: !c.enabled }, true); await load(); })}>{c.enabled ? '停用' : '启用'}</Button>}</li>)}</ul>
        {canAdmin && <form className={styles.form} onSubmit={e => { e.preventDefault(); void run(async () => { await call({ action: 'category_save', id: crypto.randomUUID(), expectedRevision: 0, systemCode: categoryCode, names: { zh: categoryName }, enabled: true }, true); await load(); setCategoryName(''); setCategoryCode(''); }); }}><label>分类名称<input required maxLength={100} value={categoryName} onChange={e => setCategoryName(e.target.value)} /></label><label>稳定标识<input required pattern="[a-z0-9-]+" maxLength={100} value={categoryCode} onChange={e => setCategoryCode(e.target.value)} /></label><Button type="submit" disabled={busy}>新增分类</Button></form>}
      </section>}
    </>}
    <div className={styles.return}><Link href="/">返回工作台</Link></div>
  </main>;
}
