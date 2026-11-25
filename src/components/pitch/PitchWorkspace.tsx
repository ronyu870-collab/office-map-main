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

const scopeGrantSchema = scopeSchema.extend({ region: z.string().nullable(), city: z.string().nullable(), businessLine: z.string().nullable(), canGenerate: z.boolean(), canMaintain: z.boolean(), canAdmin: z.boolean(), canClientExport: z.boolean(), canExternalAi: z.boolean() });
const catalogSchema = z.object({ scopes: z.array(scopeGrantSchema), categories: z.array(z.object({ id: z.uuid(), system_code: z.string(), names: z.record(z.string(), z.string()), enabled: z.boolean(), revision: z.number() })), templates: z.array(z.object({ id: z.string(), names: z.record(z.string(), z.string()), current_version: z.number() })), themes: z.array(z.object({ id: z.string(), current_version: z.number() })) });
const assetSchema = z.object({ id: z.uuid(), names: z.record(z.string(), z.string()), state: z.string(), current_version: z.number(), is_test_data: z.boolean() });
const projectSchema = z.object({ id: z.uuid(), title: z.string(), is_test_data: z.boolean() });
const detailSchema = z.object({ project: projectSchema.extend({ theme_id: z.string(), theme_version: z.number(), version: z.number() }), slides: z.array(z.object({ id: z.uuid(), content: slideContentSchema, template_id: z.string(), template_version: z.number() })), exports: z.array(z.object({ id: z.uuid(), state: z.string(), audience: z.enum(['internal', 'client']) })) });
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
  const [assetNext, setAssetNext] = React.useState<string | null>(null), [projectNext, setProjectNext] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(''), [title, setTitle] = React.useState('测试 Pitch');
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
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'pitch.pptx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className={styles.workspace} aria-busy={busy}>
    <div className={styles.intro}><h1>Pitch Studio</h1><p>内部试点 · 临时主题未经品牌确认</p></div>
    <nav className={styles.nav} aria-label="Pitch Studio 板块">{panels.map(p => <button type="button" key={p.id} aria-current={panel === p.id ? 'page' : undefined} onClick={() => setPanel(p.id)}>{p.label}</button>)}</nav>
    {message && <p role="status" className={styles.message}>{message}</p>}
    {!catalog ? <p>{message ? '当前无法进入试点。' : '正在读取试点权限…'}</p> : <>
      {panel === 'quick' && <section className={styles.section}><h2>从素材生成单页</h2><p>测试素材与真实业务素材分别标识。生成结果保存为你的私人项目。</p>
        <div className={styles.form}>
          <label>内容素材<select value={selected} onChange={e => { setSelected(e.target.value); setProjectRequest(null); }}><option value="">请选择</option>{assets.map(a => <option key={a.id} value={a.id}>{a.names.zh ?? a.names.en}{a.is_test_data ? ' · 测试数据' : ''}</option>)}</select></label>
          <label>项目名称<input value={title} maxLength={160} onChange={e => { setTitle(e.target.value); setProjectRequest(null); }} /></label>
          <div className={styles.actions}><Button disabled={busy || !canGenerate || !selected || !title.trim()} onClick={() => void run(async () => {
            const projectId = projectRequest ?? crypto.randomUUID(); setProjectRequest(projectId);
            await call({ action: 'project_create', projectId, assetId: selected, title: title.trim(), templateId: 'basic-text-image', templateVersion: 1, themeId: 'colliers-default-v1', themeVersion: 1, parameters: { language: 'zh' } }, true);
            await openProject(projectId); await load(); setProjectRequest(null); setMessage('项目和页面已保存。');
          })}>生成并保存</Button><Button variant="secondary" disabled={busy || !canGenerate} onClick={() => void run(async () => {
            const grant = catalog.scopes.find(s => s.canGenerate && s.region && s.city && s.businessLine);
            if (!grant) throw new Error('请联系管理员分配明确的试点城市、区域和业务线。');
            const requestId = sampleRequest ?? crypto.randomUUID(); setSampleRequest(requestId);
            const out = await call({ action: 'sample_create', requestId, scope: { organizationId: grant.organizationId, region: grant.region, city: grant.city, businessLine: grant.businessLine } }, true);
            setSelected(out.assetId); await load(); setSampleRequest(null); setMessage('测试素材已归档，不代表真实案例。');
          })}>创建测试素材</Button></div>
        </div>{!canGenerate && <p>当前身份只读，可以查看已授权素材和已有项目。</p>}
      </section>}
      {panel === 'assets' && <section className={styles.section}><h2>企业素材库</h2><p>只展示你有权读取的已发布素材及自己的私人素材。</p><ul className={styles.list}>{assets.map(a => <li key={a.id}><div><strong>{a.names.zh ?? a.names.en}</strong><p>{a.is_test_data ? '测试数据 · 非真实案例' : '业务素材'} · {({ draft: '草稿', published: '已发布', pending_review: '待确认', archived: '已归档' } as Record<string, string>)[a.state]} · 版本 {a.current_version}</p></div><Button variant="secondary" disabled={!canGenerate} onClick={() => { setSelected(a.id); setPanel('quick'); }}>使用素材</Button></li>)}</ul>{assets.length === 0 && <p>当前没有可用素材，可在快速生成中创建测试素材。</p>}{assetNext && <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const out = await call({ action: 'list_assets', before: assetNext }); setAssets(v => [...v, ...z.array(assetSchema).parse(out.items)]); setAssetNext(out.next); })}>加载更多素材</Button>}</section>}
      {panel === 'templates' && <section className={styles.section}><h2>模板中心</h2><ul className={styles.list}>{catalog.templates.map(t => <li key={t.id}><div><strong>{t.names.zh ?? t.names.en}</strong><p>已发布 · 版本 {t.current_version} · 可编辑 PPTX</p></div><Button variant="secondary" onClick={() => setPanel('quick')}>选择素材</Button></li>)}</ul><p>基础图文接受一张图片与简短正文；内容过长或缺少数据时会提示修正。</p></section>}
      {panel === 'projects' && <section className={styles.section}><h2>我的 Pitch</h2><ul className={styles.list}>{projects.map(p => <li key={p.id}><div><strong>{p.title}</strong>{p.is_test_data && <p>测试数据 · 非真实案例</p>}</div><Button variant="secondary" disabled={busy} onClick={() => void run(() => openProject(p.id))}>打开项目</Button></li>)}</ul>{projects.length === 0 && <p>还没有私人项目，请从素材生成单页。</p>}{projectNext && <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { const out = await call({ action: 'list_projects', before: projectNext }); setProjects(v => [...v, ...z.array(projectSchema).parse(out.items)]); setProjectNext(out.next); })}>加载更多项目</Button>}
        {detail && <article className={styles.detail}><h2>{detail.project.title}</h2>{detail.slides.map(s => <div key={s.id} className={styles.slide}><h3>{s.content.title}</h3>{s.content.blocks.map((b, i) => b.kind === 'paragraph' ? <p key={i}>{b.text}</p> : b.kind === 'image' ? <p key={i}>配图：{b.alt}</p> : null)}<p>数据时间：{s.content.dataAsOf} · {s.content.sources.map(r => r.label).join('；')}</p></div>)}
          <div className={styles.actions}><Button disabled={busy || !canGenerate} onClick={() => void run(async () => { const out = await call({ action: 'export', projectId: detail.project.id, audience: 'internal' }, true); await openProject(detail.project.id); setMessage('PPTX 已生成并归档。'); await download(out.exportId, 'internal'); })}>导出内部 PPTX</Button></div>
          <ul className={styles.list}>{detail.exports.map(e => <li key={e.id}><span>{e.audience === 'internal' ? '内部文件' : '对客文件'} · {e.state === 'ready' ? '已归档' : e.state === 'pending' ? '等待完成' : '生成失败'}</span>{e.state === 'ready' && <Button variant="secondary" disabled={busy || !canGenerate} onClick={() => void run(() => download(e.id, e.audience))}>下载已归档文件</Button>}</li>)}</ul>
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
