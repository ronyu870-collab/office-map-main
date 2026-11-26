'use client';
import * as React from 'react';
import Image from 'next/image';
import { Button } from '@/src/components/ui';
import { candidateThemeLabel } from '@/src/lib/pitch/design/theme';
import { LAYOUTS } from '@/src/lib/pitch/layout/definitions';
import type { LayoutId, SlideScene } from '@/src/lib/pitch/contracts/scene';
import type { ExportFormat } from '@/src/lib/pitch/render/format';
import styles from './pitch.module.css';
type Call = (input: Record<string, unknown>, write?: boolean) => Promise<unknown>;
type Preview = { svg: string; pageCount: number; font: string; quality: { message: string; severity: string }[] };
type Status = { id: string; state: 'ready' | 'failed' | 'pending'; progress: number; format: ExportFormat; filename: string; error_code?: string };
export function ScenePreview({ project, slides, themes, call, canGenerate, onSaved }: {
  project: { id: string; title: string }; slides: { id: string; scene: SlideScene; asset_id: string }[]; themes: { id: string; current_version: number }[];
  call: Call; canGenerate: boolean; onSaved: () => Promise<void>;
}) {
  const [page, setPage] = React.useState(0), [zoom, setZoom] = React.useState(100);
  const [images, setImages] = React.useState<Record<number, string>>({}), [preview, setPreview] = React.useState<Preview | null>(null);
  const [layout, setLayout] = React.useState(slides[0]?.scene.layoutId ?? 'image-text'), [variant, setVariant] = React.useState(slides[0]?.scene.variant ?? 'standard');
  const [theme, setTheme] = React.useState(JSON.stringify([slides[0]?.scene.themeId, slides[0]?.scene.themeVersion]));
  const [format, setFormat] = React.useState<ExportFormat>('pptx'), [selection, setSelection] = React.useState<'all' | 'page'>('all');
  const [status, setStatus] = React.useState<Status | null>(null), [working, setWorking] = React.useState(false), [loading, setLoading] = React.useState(true), [imageReady, setImageReady] = React.useState(false), [error, setError] = React.useState('');
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  React.useEffect(() => {
    let cancelled = false, index = 0;
    const next = async () => { while (index < slides.length && !cancelled) { const i = index++; try { const out = await call({ action: 'preview', projectId: project.id, page: i }, true) as Preview; if (!cancelled) setImages(v => ({ ...v, [i]: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg) })); } catch { /* The selected page exposes the detailed error. */ } } };
    void Promise.all([next(), next()]); return () => { cancelled = true; };
  }, [project.id, slides, call]);
  React.useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => { setLoading(true); setImageReady(false); setError(''); const [themeId, themeVersion] = JSON.parse(theme);
      void call({ action: 'preview', projectId: project.id, page, ...(slides[page]?.scene.rendererVersion ? { layoutId: layout, variant, themeId, themeVersion } : {}) }, true).then(out => { if (!cancelled) setPreview(out as Preview); }).catch(e => { if (!cancelled) { setPreview(null); setError(e.message); } }).finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [call, project.id, page, layout, variant, theme, slides]);
  const selectPage = (i: number) => { setLoading(true); setPreview(null); setPage(i); setLayout(slides[i].scene.layoutId); setVariant(slides[i].scene.variant ?? 'standard'); setTheme(JSON.stringify([slides[i].scene.themeId, slides[i].scene.themeVersion])); };
  const download = async (s: Status) => {
    const blob = await call({ action: 'download', projectId: project.id, exportId: s.id, audience: 'internal' }) as Blob;
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = s.filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const start = async () => {
    setWorking(true); setError(''); setStatus(null);
    try {
      const exportId = crypto.randomUUID();
      await call({ action: 'export_start', projectId: project.id, exportId, audience: 'internal', format, ...(['png', 'svg'].includes(format) || selection === 'page' ? { page } : {}) }, true);
      const until = Date.now() + 125000;
      while (alive.current && Date.now() < until) {
        const current = await call({ action: 'export_status', projectId: project.id, exportId }) as Status;
        if (!alive.current) return; setStatus(current);
        if (current.state === 'failed') throw new Error(`导出未完成（${current.error_code ?? 'PITCH_EXPORT_FAILED'}），可重试。`);
        if (current.state === 'ready') { await onSaved(); await download(current); return; }
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      if (alive.current) throw new Error('后台任务仍未完成，请刷新导出记录后重试。');
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '导出失败，可重试。'); }
    finally { if (alive.current) setWorking(false); }
  };
  const savePreview = async () => {
    setWorking(true); setError(''); try {
      const [themeId, themeVersion] = JSON.parse(theme);
      await call({ action: 'project_compose', projectId: crypto.randomUUID(), title: project.title + ' · 版式调整', themeId, themeVersion, parts: [{ assetId: slides[page].asset_id, layoutId: layout as LayoutId, variant }] }, true);
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setWorking(false); }
  };
  const src = preview ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(preview.svg) : undefined;
  return <section className={styles.preview} aria-label="页面预览与导出">
    <div className={styles.previewToolbar}>
      <label>缩放<select value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[50, 75, 100, 125, 150].map(n => <option key={n} value={n}>{n}%</option>)}</select></label>
      {slides[page]?.scene.rendererVersion && <>
        <label>布局<select value={layout} onChange={e => setLayout(e.target.value)}>{LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.zh}</option>)}</select></label>
        <label>变体<select value={variant} onChange={e => setVariant(e.target.value as typeof variant)}><option value="standard">标准</option><option value="alternate">替换结构</option></select></label>
        <label>主题<select value={theme} onChange={e => setTheme(e.target.value)}>{Array.from(new Map([[theme, { id: slides[page].scene.themeId, current_version: slides[page].scene.themeVersion }], ...themes.map(t => [JSON.stringify([t.id, t.current_version]), t] as const)]).entries()).map(([key, t]) => <option key={key} value={key}>{t.id === 'colliers-default-v1' ? '临时主题' : candidateThemeLabel(t.id) ?? '验证主题'} · v{t.current_version}</option>)}</select></label>
        <Button variant="secondary" disabled={working || loading || !preview || !canGenerate} onClick={() => void savePreview()}>将此内容另存为新提案</Button>
      </>}
    </div>
    <div className={styles.thumbnails} aria-label="页面缩略图">{slides.map((s, i) => <button type="button" key={s.id} aria-label={`第 ${i + 1} 页`} aria-current={page === i ? 'page' : undefined} onClick={() => selectPage(i)}>{images[i] && <Image unoptimized src={images[i]} alt="" width={160} height={90} />}<span>{i + 1}</span></button>)}</div>
    <div className={styles.canvasViewport} aria-busy={loading || !!preview && !imageReady}><div className={styles.canvas} style={{ width: `${zoom}%` }}>{src && !loading ? <Image unoptimized src={src} key={src} onLoad={() => setImageReady(true)} onError={() => { setImageReady(false); setError('预览图片解码失败，请重试或切换页面。'); }} width={1280} height={720} alt={`第 ${page + 1} 页实际内容预览`} /> : <p>{loading ? '正在加载字体轮廓与获权图片…' : '预览未完成'}</p>}</div></div>
    {preview && <p>第 {page + 1} / {slides.length} 页 · {imageReady ? '字体与图片已加载' : '正在解码页面图片…'}{preview.pageCount > 1 ? `；当前内容按此参数共 ${preview.pageCount} 页，另存时保留全部页面。` : ''}</p>}
    {preview?.quality.map((q, i) => <p key={i}>{q.message}</p>)}
    <details><summary>预览与 Office 字体</summary><p>预览使用捆绑 Noto Sans SC 字形，PPTX 保留可编辑文字。PowerPoint 未安装主题字体时可能替代字体；请安装相同字体以接近预览。参数预览不会覆盖已保存项目，导出使用已保存页面。</p></details>
    <div className={styles.previewToolbar}>
      <label>文件格式<select value={format} onChange={e => setFormat(e.target.value as ExportFormat)}><option value="pptx">PowerPoint</option><option value="png">单页 PNG</option><option value="svg">单页 SVG</option><option value="xlsx">可用数据 Excel</option></select></label>
      {['pptx', 'xlsx'].includes(format) && <label>页面范围<select value={selection} onChange={e => setSelection(e.target.value as typeof selection)}><option value="all">全部页面</option><option value="page">当前页</option></select></label>}
      <Button disabled={working || !canGenerate} onClick={() => void start()}>{working ? '后台导出中…' : error ? '重试导出' : '导出已保存页面'}</Button>
      {status && <span role="status">{status.state === 'ready' ? '已归档' : status.state === 'failed' ? '导出失败' : `导出进度 ${status.progress}%`}</span>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
