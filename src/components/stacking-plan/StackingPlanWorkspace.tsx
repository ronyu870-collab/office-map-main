'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, Building2, Check, ChevronRight,
  Download, Edit3, FileImage, FileSpreadsheet, FileUp, Link2,
  RefreshCw, Search, X,
} from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import { isUserAdmin } from '@/src/utils/accessControl';
import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import {
  areaNumber, matchingTenant, OCCUPANCY_LABELS,
  selectFloorRows, unitLayout,
  type OccupancyStatus, type PlanFloor, type PlanSpace, type SpaceFilter,
} from './stackingPlanModel';
import { createStackingPresentationSvg } from './stackingPlanPresentation';
import { buildStackingWorkbook, createStackingDiagramLayout } from './stackingPlanExcel';
import { styleStackingWorkbook } from './stackingPlanExcelStyles';
import { StackingPlanOverview } from './StackingPlanOverview';
import styles from './StackingPlanWorkspace.module.css';

type Tower = { id: string; code: string; display_name: string };
type Floor = PlanFloor;
type Step = {
  start: string | null; end: string | null; face_rent_monthly?: number | null;
  monthly_total_rent?: number | null; area_sqm?: number | null; unit?: string;
};
type Space = PlanSpace & {
  lease_steps: Step[]; notes: string; revision: number; source_id: string;
};
type Source = {
  id: string; title: string; source_as_of: string | null; as_of_kind: string;
  review_state: string; source_note: string | null;
  evidence_storage_path?: string | null; evidence_filename?: string | null;
  evidence_mime?: string | null; evidence_sha256?: string | null;
  evidence_size_bytes?: number | null; evidence_uploaded_at?: string | null;
};
type Payload = {
  building: { id: string; name: string }; towers: Tower[];
  floors: Floor[]; spaces: Space[]; sources: Source[]; basis: string;
  evidence_storage_ready?: boolean;
};
type ExportScope = 'visible' | 'all';

const FILTERS: { value: SpaceFilter; label: string }[] = [
  { value: 'all', label: '全部状态' }, { value: 'occupied', label: '已租' },
  { value: 'vacant', label: '空置' }, { value: 'other', label: '其他用途' },
  { value: 'unknown', label: '待确认' },
];
const fmt = (value: number | string | null | undefined) => {
  const n = areaNumber(value);
  return n !== null ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
};
const asUnitName = (unit: Space) => unit.tenant_name
  || (unit.occupancy_status === 'vacant' ? '空置' : unit.occupancy_status === 'unknown' ? unit.unit_code + ' · 待确认' : unit.unit_code);
const isFiltered = (filter: SpaceFilter, search: string) => filter !== 'all' || search.trim().length > 0;

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StackingPlanWorkspace({ buildingId }: { buildingId: string }) {
  const { session, status } = useAppSession();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const exportMenu = useRef<HTMLDetailsElement | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [towerCode, setTowerCode] = useState('A');
  const [view, setView] = useState<'overview' | 'detail'>('overview');
  const [filter, setFilter] = useState<SpaceFilter>('all');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<ExportScope>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [edit, setEdit] = useState({
    tenant_name: '', occupancy_status: 'unknown' as OccupancyStatus, area_sqm: '', notes: '',
  });
  const allowed = status === 'authenticated' && isUserAdmin(session?.role);
  const unauthorized = status === 'unauthenticated' || (status === 'authenticated' && !allowed);

  useEffect(() => {
    if (!allowed) { setPayload(null); return; }
    let cancelled = false;
    setError(null);
    setPayload(null);
    (async () => {
      const current = await getSessionFast();
      const accessToken = current?.session.access_token;
      if (!accessToken) throw new Error('未取得有效登录凭据');
      const headers = withImpersonationHeaders({ Authorization: 'Bearer ' + accessToken });
      const response = await fetch('/api/stacking-plan/' + buildingId, { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败');
      if (!cancelled) setPayload(data as Payload);
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败'); });
    return () => { cancelled = true; };
  }, [allowed, buildingId, refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isEditing) setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, isEditing]);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (exportMenu.current?.open &&
          !exportMenu.current.contains(event.target as Node)) {
        exportMenu.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !exportMenu.current?.open) return;
      exportMenu.current.open = false;
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const tower = payload?.towers.find(t => t.code === towerCode) ?? payload?.towers[0] ?? null;
  const floors = useMemo(() => (payload?.floors ?? []).filter(f => f.tower_id === tower?.id)
    .sort((a,b) => b.level_order - a.level_order), [payload, tower?.id]);
  const unitList = useMemo(() => {
    const floorIds = new Set(floors.map(f => f.id));
    return (payload?.spaces ?? []).filter(s => floorIds.has(s.floor_id));
  }, [payload, floors]);
  const source = payload?.sources[0] ?? null;
  const rows = useMemo(() => selectFloorRows(floors, unitList, filter, search),
    [floors, unitList, filter, search]);
  const selected = unitList.find(s => s.id === selectedId) ?? null;
  const selectedFloor = floors.find(f => f.id === selected?.floor_id);
  const linked = selected ? unitList.filter(s => matchingTenant(selected, s)) : [];
  const filtered = isFiltered(filter, search);

  function selectUnit(space: Space) {
    if (selectedId !== space.id && isEditing) {
      if (!window.confirm('当前编辑尚未保存，确定切换单元吗？')) return;
    }
    setSelectedId(space.id);
    setIsEditing(false);
    setEdit({
      tenant_name: space.tenant_name ?? '', occupancy_status: space.occupancy_status,
      area_sqm: space.area_sqm === null ? '' : String(space.area_sqm), notes: space.notes ?? '',
    });
    setError(null);
  }

  function switchView(next: 'overview' | 'detail') {
    if (view === next) return;
    if (isEditing && !window.confirm('编辑内容尚未保存，确定切换视图吗？')) return;
    setIsEditing(false);
    setSelectedId(null);
    setView(next);
  }

  function openOverviewUnit(space: Space, code: string) {
    if (isEditing) return;
    // Dimmed overview units remain navigable. Clear incompatible filters before
    // opening detail so the selected floor cannot disappear from its facade.
    const floor = payload?.floors.find(item => item.id === space.floor_id);
    const matches = floor && selectFloorRows([floor], [space], filter, search)
      .some(row => row.spaces.some(unit => unit.id === space.id));
    if (!matches) {
      setFilter('all');
      setSearch('');
    }
    setTowerCode(code);
    setView('detail');
    selectUnit(space);
  }

  function refreshData() {
    if (isEditing && !window.confirm('当前编辑尚未保存，确定刷新数据吗？')) return;
    setSelectedId(null);
    setIsEditing(false);
    setRefreshKey(n => n + 1);
  }

  function selectTower(code: string) {
    if (isEditing && !window.confirm('当前编辑尚未保存，确定切换楼座吗？')) return;
    setTowerCode(code); setSelectedId(null); setFilter('all'); setIsEditing(false); setSearch('');
  }

  async function accessHeaders(withJson = true) {
    const current = await getSessionFast();
    if (!current?.session.access_token) throw new Error('请重新登录');
    return withImpersonationHeaders({
      Authorization: 'Bearer ' + current.session.access_token,
      ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    });
  }

  async function authenticatedFetch(method: 'PATCH' | 'POST', body: unknown) {
    const headers = await accessHeaders();
    const response = await fetch('/api/stacking-plan/' + buildingId, {
      method, headers, body: JSON.stringify(body), cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '操作未完成');
    return data;
  }

  async function save() {
    if (!selected || saving) return;
    const parsedArea = edit.area_sqm.trim() ? Number(edit.area_sqm) : null;
    if (parsedArea !== null && (!Number.isFinite(parsedArea) || parsedArea <= 0 || parsedArea > 1000000)) {
      setError('请输入有效的单元面积'); return;
    }
    setSaving(true); setError(null); setFeedback(null);
    try {
      const next = await authenticatedFetch('PATCH', {
        space_id: selected.id, expected_revision: selected.revision,
        patch: {
          tenant_name: edit.tenant_name.trim() || null, occupancy_status: edit.occupancy_status,
          area_sqm: parsedArea, notes: edit.notes,
        },
      });
      setPayload(previous => previous && ({
        ...previous, spaces: previous.spaces.map(s => s.id === selected.id ? next.space as Space : s),
      }));
      setIsEditing(false);
      setFeedback('草稿修改已保存，空间事实仍属待核验来源。');
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setSaving(false); }
  }

  async function exportPlan(format: 'png' | 'svg' | 'xlsx' | 'report-png') {
    if (!payload || !tower || busy) return;
    setBusy(format);
    setError(null);
    setFeedback(null);
    try {
      const matching = (targetTowerId: string) => {
        const localFloors = payload.floors.filter(f => f.tower_id === targetTowerId);
        const floorIds = new Set(localFloors.map(f => f.id));
        const localSpaces = payload.spaces.filter(s => floorIds.has(s.floor_id));
        return selectFloorRows(localFloors, localSpaces,
          scope === 'all' ? 'all' : filter,
          scope === 'all' ? '' : search);
      };
      const towersToExport = format === 'report-png' || format === 'xlsx' ? payload.towers : [tower];
      if (scope === 'visible' && towersToExport.every(t => matching(t.id).every(r => !r.spaces.length))) {
        throw new Error('当前筛选没有可导出的单元，请调整筛选或选择“全部单元”。');
      }
      const name = payload.building.name + '-' +
        (towersToExport.length > 1 ? 'AB双楼' : tower.display_name) +
        '-StackingPlan-' + (source?.source_as_of ?? 'date-unknown') +
        '-' + (scope === 'all' ? '全部' : '筛选');
      if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const excelInput = {
          projectName: payload.building.name,
          towers: towersToExport, floors: payload.floors, spaces: payload.spaces,
          sourceDate: source?.source_as_of ?? null,
          sourceTitle: source?.title ?? '未提供',
          originalArchived: Boolean(source?.evidence_storage_path),
          scope, filter, search,
        };
        const workbook = buildStackingWorkbook(XLSX, excelInput);
        const raw = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer;
        const bytes = await styleStackingWorkbook(raw, createStackingDiagramLayout(excelInput).styles);
        const file = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        await authenticatedFetch('POST', { action: 'export', format: 'xlsx' });
        saveBlob(file, name + '.xlsx');
      } else {
        const svg = createStackingPresentationSvg({
          projectName: payload.building.name, sourceDate: source?.source_as_of ?? null,
          towers: towersToExport, floors: payload.floors, spaces: payload.spaces,
          filter, search, onlyMatching: scope === 'visible',
        });
        if (format === 'svg') {
          await authenticatedFetch('POST', { action: 'export', format: 'svg' });
          saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), name + '.svg');
        } else {
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
          try {
            const img = new window.Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('图片解码失败'));
              img.src = url;
            });
            const canvas = document.createElement('canvas');
            const scale = Math.min(3, 8192 / img.naturalWidth, 8192 / img.naturalHeight,
              Math.sqrt(32000000 / (img.naturalWidth * img.naturalHeight)));
            if (!Number.isFinite(scale) || scale < 1) throw new Error('图片尺寸超出浏览器支持范围');
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法初始化图片画布');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.scale(scale, scale);
            ctx.drawImage(img, 0, 0);
            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(item => item ? resolve(item) : reject(new Error('PNG 编码失败')), 'image/png'));
            await authenticatedFetch('POST', { action: 'export', format: 'png' });
            saveBlob(blob, name + '.png');
          } finally {
            URL.revokeObjectURL(url);
          }
        }
      }
      if (exportMenu.current) exportMenu.current.open = false;
      setFeedback(format === 'xlsx' ? 'Excel 堆叠图及明细已导出。' :
        format === 'report-png' ? '双楼汇报版 PNG 已生成。' : '文件已生成。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败，请重新尝试');
    } finally {
      setBusy(null);
    }
  }

  async function uploadOriginal(file: File) {
    if (!source || busy) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('原始文件超过 4 MB，当前安全上传通道无法接收。请先压缩文件。');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (source.evidence_storage_path &&
        !window.confirm('将保留旧版本审计记录，并把新的文件作为当前原始凭据。确认继续吗？')) return;
    setBusy('upload'); setError(null); setFeedback(null);
    try {
      const form = new FormData();
      form.set('source_id', source.id); form.set('file', file);
      const response = await fetch('/api/stacking-plan/' + buildingId, {
        method: 'POST', headers: await accessHeaders(false), body: form, cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '原件上传失败');
      setFeedback(result.duplicate ? '该原件已经归档，无需重复上传。' : '原件已归档到私有存储，已记录校验值与审计。');
      setRefreshKey(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : '原件上传失败'); }
    finally { setBusy(null); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function downloadOriginal() {
    if (!source?.evidence_storage_path || busy) return;
    setBusy('download'); setError(null);
    try {
      const response = await fetch('/api/stacking-plan/' + buildingId + '?original=' + encodeURIComponent(source.id), {
        headers: await accessHeaders(false), cache: 'no-store',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '原件下载失败');
      }
      saveBlob(await response.blob(), source.evidence_filename ?? 'stacking-plan-original');
    } catch (e) { setError(e instanceof Error ? e.message : '原件下载失败'); }
    finally { setBusy(null); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href={'/map?building=' + encodeURIComponent(buildingId)} className={styles.back}>
          <ArrowLeft size={16} /> 返回地图
        </a>
        <span className={styles.brand}>Stacking Plan</span>
      </header>

      <div className={styles.container}>
        <div className={styles.heading}>
          <div>
            <h1>{payload?.building.name ?? '楼宇租赁堆叠图'} <span>Stacking Plan</span></h1>
          </div>
          <button type="button" onClick={refreshData}
            className={styles.lightButton} aria-label="刷新数据"><RefreshCw size={15}/> 刷新</button>
        </div>

        {status === 'loading' ? <div className={styles.state}>正在校验管理员身份…</div>
          : unauthorized ? <div className={styles.state}>仅真实 Admin 账号可访问此功能。<a href="/map">返回地图</a></div>
          : !payload && !error ? <div className={styles.state}>正在读取楼层资料…</div>
          : !payload ? <div className={styles.state}>{error}<button type="button" onClick={() => setRefreshKey(n => n + 1)}>重试</button></div>
          : (
          <>

            <section className={styles.toolbar} aria-label="楼宇租赁查询与导出">
              <div className={styles.navigationControls}>
                <div className={styles.viewTabs} role="group" aria-label="视图模式">
                  <button type="button" aria-pressed={view === 'overview'}
                    className={view === 'overview' ? styles.activeTab : ''}
                    onClick={() => switchView('overview')}>双楼总览</button>
                  <button type="button" aria-pressed={view === 'detail'}
                    className={view === 'detail' ? styles.activeTab : ''}
                    onClick={() => switchView('detail')}>分层详情</button>
                </div>
                {view === 'detail' && <div className={styles.tabs} aria-label="楼座">
                  {payload.towers.map(t => <button key={t.id} type="button" aria-pressed={tower?.id === t.id}
                    className={tower?.id === t.id ? styles.activeTab : ''}
                    onClick={() => selectTower(t.code)}>{t.display_name}</button>)}
                </div>}
              </div>
              <div className={styles.controls}>
                <label className={styles.searchBox}>
                  <Search size={16} aria-hidden="true"/>
                  <input type="search" aria-label="搜索租户、楼层或单元" placeholder="搜索租户 / 楼层 / 单元"
                    value={search} onChange={event => setSearch(event.target.value)}/>
                </label>
                <select aria-label="空间状态筛选" value={filter}
                  onChange={event => setFilter(event.target.value as SpaceFilter)}>
                  {FILTERS.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
                <div className={styles.exportMenu}>
                  <details ref={exportMenu}>
                    <summary><Download size={16}/> 导出 <ChevronRight size={14}/></summary>
                    <div className={styles.exportOptions}>
                      {view === 'overview' && (
                        <div className={styles.exportScope}>
                          <label htmlFor="sp-export-tower">单楼长图楼座</label>
                          <select id="sp-export-tower" aria-label="长图导出楼座"
                            value={tower?.code ?? ''}
                            onChange={event => setTowerCode(event.target.value)}>
                            {payload.towers.map(item => (
                              <option key={item.id} value={item.code}>{item.display_name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className={styles.exportScope}>
                        <label htmlFor="sp-export-scope">导出范围</label>
                        <select id="sp-export-scope" value={scope}
                          onChange={event => setScope(event.target.value as ExportScope)}>
                          <option value="all">全部单元</option>
                          <option value="visible">当前筛选</option>
                        </select>
                      </div>
                      <button type="button" onClick={() => void exportPlan('report-png')} disabled={!!busy}>
                        <FileImage size={16}/> 双楼高清 PNG</button>
                      <button type="button" onClick={() => void exportPlan('png')} disabled={!!busy}>
                        <FileImage size={16}/> {tower?.display_name}高清 PNG</button>
                      <button type="button" onClick={() => void exportPlan('xlsx')} disabled={!!busy}>
                        <FileSpreadsheet size={16}/> Excel · 堆叠图与明细</button>
                      <button type="button" onClick={() => void exportPlan('svg')} disabled={!!busy}>
                        <Download size={16}/> 单楼矢量 SVG</button>
                      {busy && <span role="status" className={styles.exportProgress}>正在生成{busy === 'xlsx' ? ' Excel' : '图片'}…</span>}
                    </div>
                  </details>
                </div>
              </div>
            </section>

            {view === 'overview'
              ? <StackingPlanOverview towers={payload.towers} floors={payload.floors} spaces={payload.spaces}
                  filter={filter} search={search} onOpen={openOverviewUnit}
                  onOpenTower={code => { setTowerCode(code); switchView('detail'); }}
                  onClear={() => { setFilter('all'); setSearch(''); }}/>
              : <div className={[styles.layout, selected ? '' : styles.layoutSingle].join(' ')}>
              <section className={styles.plan} aria-label="楼宇租赁立面">
                <div className={styles.sectionTitle}>
                  <div>
                    <h2>{tower?.display_name ?? '楼座'} · 楼层租赁分布</h2>
                  </div>
                  <span className={styles.floorCount}>{rows.length} 层可见</span>
                </div>

                <div className={styles.facade}>
                  <div className={styles.roof}><Building2 size={16}/><span>{tower?.display_name ?? '楼座'}</span></div>
                  <div className={styles.tower}>
                    {rows.length ? rows.map(({ floor, spaces }) => {
                      const display = unitLayout(floor, spaces, filtered);
                      return <div key={floor.id} className={styles.floor}>
                        <div className={styles.level}>
                          <strong>{floor.floor_code.startsWith('B') ? floor.floor_code : floor.floor_code + 'F'}</strong>
                          <small>{floor.zone ?? '—'}</small>
                        </div>
                        <div className={styles.units} role="group" aria-label={floor.floor_code + ' 层单元'}>
                          {spaces.map(space => {
                            const weight = display.items.find(item => item.id === space.id)?.weight ?? 1;
                            const related = matchingTenant(selected, space);
                            return <button key={space.id} type="button"
                              className={[
                                styles.unit, styles[space.occupancy_status],
                                selected?.id === space.id ? styles.chosen : '',
                                related && selected?.id !== space.id ? styles.linked : '',
                              ].filter(Boolean).join(' ')}
                              onClick={() => selectUnit(space)}
                              style={{ flexGrow: weight, flexBasis: 0 }}
                              title={asUnitName(space) + ' · ' + fmt(space.area_sqm) + (areaNumber(space.area_sqm) === null ? '' : '㎡')}
                              aria-pressed={selected?.id === space.id}>
                              <span>{asUnitName(space)}</span>
                              <small>{fmt(space.area_sqm)} {areaNumber(space.area_sqm) === null ? '' : '㎡'}</small>
                            </button>;
                          })}
                          {display.residual > 0.1 && <div className={styles.unallocated} style={{
                            flexGrow: display.residual, flexBasis: 0,
                          }} title={display.residualLabel ?? undefined}>
                            <span>{display.residualLabel}</span>
                          </div>}
                          {!spaces.length && <div className={styles.emptyUnit}>本层未录入空间单元</div>}
                        </div>
                        <div className={styles.floorArea}>
                          <span>{fmt(floor.floor_area_sqm)} <small>㎡</small></span>

                        </div>
                      </div>;
                    }) : <p className={styles.emptyFloor}>没有符合条件的单元。可清空搜索或切换状态筛选。</p>}
                  </div>
                  <div className={styles.plinth} aria-hidden="true"/>
                </div>

                <div className={styles.legend}>
                  <span><i className={styles.occupied}/> 已租</span>
                  <span><i className={styles.vacant}/> 空置</span>
                  <span><i className={styles.other}/> 其他用途</span>
                  <span><i className={styles.unknown}/> 待确认</span>
                </div>
              </section>

              {selected && <button type="button" aria-label="关闭租赁详情" className={styles.drawerBackdrop}
                onClick={() => { if (!isEditing || window.confirm('编辑内容尚未保存，确定关闭吗？')) { setSelectedId(null); setIsEditing(false); } }}/>}
              <aside className={[styles.details, selected ? styles.drawerActive : styles.detailsHidden].join(' ')}
                aria-label="租赁单元详情">
                {selected ? <>
                  <div className={styles.detailHeader}>
                    <span className={styles.sectionKicker}>单元详情</span>
                    <button type="button" aria-label="关闭详情" onClick={() => {
                      if (isEditing && !window.confirm('编辑内容尚未保存，确定关闭吗？')) return;
                      setSelectedId(null); setIsEditing(false);
                    }}><X size={18}/></button>
                  </div>
                  <h2>{selected.tenant_name || asUnitName(selected)}</h2>
                  <p className={styles.detailHint}>{tower?.display_name} · {selectedFloor?.floor_code?.startsWith('B') ? selectedFloor.floor_code : selectedFloor?.floor_code + 'F'} · {selected.unit_code}</p>
                  <div className={styles.detailFacts}>
                    <div><small>租赁状态</small><strong>{OCCUPANCY_LABELS[selected.occupancy_status].replace(/（来源标注）|状态/g, '')}</strong></div>
                    <div><small>单元面积</small><strong>{fmt(selected.area_sqm)} ㎡</strong></div>
                  </div>
                  {linked.length > 1 && <div className={styles.linkedTenants}>
                    <div className={styles.linkedTitle}><Link2 size={15}/> 同名来源标注 · {linked.length} 个单元</div>
                    <div className={styles.linkedList}>
                      {linked.map(space => {
                        const floor = floors.find(f => f.id === space.floor_id);
                        return <button key={space.id} type="button" aria-current={selected.id === space.id}
                          onClick={() => selectUnit(space)}>
                          {floor?.floor_code?.startsWith('B') ? floor.floor_code : floor?.floor_code + 'F'} <span>{fmt(space.area_sqm)}㎡</span>
                        </button>;
                      })}
                    </div>
                  </div>}
                  <h3>租金阶段</h3>
                  {selected.lease_steps.length ? selected.lease_steps.map((step, index) =>
                    <div className={styles.step} key={index}>
                      <strong>{step.face_rent_monthly != null ? fmt(step.face_rent_monthly) + ' 元/㎡/月'
                        : step.monthly_total_rent != null ? fmt(step.monthly_total_rent) + ' 元/月（总租金）'
                          : '租金未注明'}</strong>
                      <span>{step.start || '日期未知'} — {step.end || '日期未知'}</span>
                      {step.area_sqm != null && <span>阶段面积 {fmt(step.area_sqm)} ㎡</span>}
                    </div>) : <p className={styles.none}>原图未提供租金阶段</p>}

                  {!isEditing ? <>
                    <button type="button" className={styles.editButton} onClick={() => setIsEditing(true)}>
                      <Edit3 size={16}/> 编辑信息 <ChevronRight size={15}/>
                    </button>
                  </> : <div className={styles.editPanel}>
                    <div className={styles.editPanelHeader}><h3>编辑信息</h3><button type="button"
                      onClick={() => setIsEditing(false)}>取消编辑</button></div>
                    <div className={styles.field}><label htmlFor="sp-tenant">租户 / 用途</label>
                      <input id="sp-tenant" value={edit.tenant_name}
                        onChange={e => setEdit(v => ({ ...v, tenant_name: e.target.value }))}/></div>
                    <div className={styles.field}><label htmlFor="sp-status">来源标注状态</label>
                      <select id="sp-status" value={edit.occupancy_status}
                        onChange={e => setEdit(v => ({ ...v, occupancy_status: e.target.value as OccupancyStatus }))}>
                        {Object.entries(OCCUPANCY_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
                      </select></div>
                    <div className={styles.field}><label htmlFor="sp-area">单元面积（㎡）</label>
                      <input id="sp-area" inputMode="decimal" value={edit.area_sqm}
                        onChange={e => setEdit(v => ({ ...v, area_sqm: e.target.value }))}/></div>
                    <div className={styles.field}><label htmlFor="sp-notes">备注 / 待核验事项</label>
                      <textarea id="sp-notes" rows={4} value={edit.notes}
                        onChange={e => setEdit(v => ({ ...v, notes: e.target.value }))}/></div>
                    <button type="button" onClick={() => void save()} disabled={saving} className={styles.save}>
                      <Check size={16}/>{saving ? '正在保存…' : '保存修改'}
                    </button>
                  </div>}
                </>}
              </aside>
            </div>}

            <details className={styles.sourceDetails}>
              <summary>原始资料 <ChevronRight size={15}/></summary>
              <div className={styles.sourceDetailsBody}>
                <div className={styles.evidenceControls}>
                  <input ref={fileInput} type="file" className={styles.hiddenFile}
                    accept=".png,.jpg,.jpeg,.webp,.pdf,.xlsx"
                    disabled={payload.evidence_storage_ready === false}
                    aria-label="选择原始资料文件" onChange={event => {
                      const file = event.target.files?.[0]; if (file) void uploadOriginal(file);
                    }} />
                  <button type="button" disabled={!!busy || payload.evidence_storage_ready === false}
                    onClick={() => fileInput.current?.click()}>
                    <FileUp size={15}/> {source?.evidence_storage_path ? '替换文件' : '上传文件'}
                  </button>
                  {source?.evidence_storage_path && <button type="button" disabled={!!busy}
                    onClick={() => void downloadOriginal()}><ArrowDownToLine size={15}/> 下载文件</button>}
                </div>
                {source?.title && <p>{source.title}</p>}
              </div>
            </details>
          </>
        )}
        {error && payload && <div className={styles.notification} role="alert"><AlertTriangle size={16}/>{error}<button type="button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={15}/></button></div>}
        {feedback && <div className={styles.feedback} role="status"><Check size={16}/>{feedback}<button type="button" aria-label="关闭提示" onClick={() => setFeedback(null)}><X size={15}/></button></div>}
      </div>
    </main>
  );
}
