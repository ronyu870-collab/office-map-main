'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, Building2, Check, ChevronRight,
  Download, Edit3, FileImage, FileSpreadsheet, FileUp, Layers3, Link2,
  RefreshCw, Search, ShieldAlert, X,
} from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import { isUserAdmin } from '@/src/utils/accessControl';
import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import {
  areaCheck, areaNumber, matchingTenant, OCCUPANCY_LABELS,
  selectFloorRows, summarizePlan, uncoveredFloorLabels, unitLayout,
  type OccupancyStatus, type PlanFloor, type PlanSpace, type SpaceFilter,
} from './stackingPlanModel';
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
};
type ExportScope = 'visible' | 'all';

const FILTERS: { value: SpaceFilter; label: string }[] = [
  { value: 'all', label: '全部状态' }, { value: 'occupied', label: '已租' },
  { value: 'vacant', label: '空置' }, { value: 'other', label: '其他用途' },
  { value: 'unknown', label: '待确认' },
];
const COLORS: Record<OccupancyStatus, { fill: string; ink: string }> = {
  occupied: { fill: '#E8F1F8', ink: '#275B81' },
  vacant: { fill: '#F1F3F6', ink: '#596A78' },
  other: { fill: '#EAF0E9', ink: '#456B57' },
  unknown: { fill: '#FFF1D9', ink: '#805C24' },
};
const fmt = (value: number | string | null | undefined) => {
  const n = areaNumber(value);
  return n !== null ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
};
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[c] ?? c));
const brief = (value: string, max = 20) => value.length > max ? value.slice(0, max) + '…' : value;
const excelText = (value: string | null | undefined) => {
  const safe = value ?? '';
  return /^[\s]*[=+\-@]/.test(safe) ? "'" + safe : safe;
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

function makeSvg(
  tower: Tower,
  rows: ReturnType<typeof selectFloorRows<Floor, Space>>,
  projectName: string,
  source: Source | null,
  filtered: boolean,
  missing: string[],
) {
  const width = 1160, rowHeight = 52, top = 183, height = top + rowHeight * rows.length + 142;
  const header = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
    '<rect width="' + width + '" height="' + height + '" fill="#FFFFFF"/>',
    '<rect x="0" y="0" width="7" height="' + height + '" fill="#003E7E"/>',
    '<text x="42" y="51" font-size="14" fill="#003E7E" font-weight="700" font-family="Arial,Microsoft YaHei,sans-serif">COLLIERS INTELLIGENCE</text>',
    '<text x="42" y="94" font-size="28" fill="#172033" font-weight="700" font-family="Arial,Microsoft YaHei,sans-serif">' + esc(projectName + ' · ' + tower.display_name) + '</text>',
    '<text x="42" y="129" font-size="15" fill="#667085" font-family="Arial,Microsoft YaHei,sans-serif">STACKING PLAN  /  来源快照 · 业务状态未逐项核验</text>',
    '<rect x="112" y="158" width="900" height="' + (rowHeight * rows.length + 10) + '" fill="#F8FAFC" stroke="#CAD4DE" rx="5"/>',
  ];
  const labels = rows.map((row, index) => {
    const { floor, spaces } = row;
    const y = top + index * rowHeight;
    const layout = unitLayout(floor, spaces, filtered);
    const weights = layout.items.reduce((sum, x) => sum + x.weight, 0) + layout.residual;
    const total = weights || 1;
    let offset = 0;
    const tiles = spaces.map(unit => {
      const info = layout.items.find(item => item.id === unit.id);
      const w = (info?.weight ?? 1) / total * 890;
      const x = 119 + offset; offset += w;
      const color = COLORS[unit.occupancy_status];
      const text = w > 72 ? '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y + 27) + '" font-size="13" fill="' + color.ink + '" text-anchor="middle" font-weight="600" font-family="Arial,Microsoft YaHei,sans-serif">' + esc(brief(asUnitName(unit), Math.max(3, Math.floor(w / 17)))) + '</text>' : '';
      return '<rect x="' + x.toFixed(1) + '" y="' + (y + 2) + '" width="' + Math.max(w - 3, 0).toFixed(1) + '" height="43" rx="3" fill="' + color.fill + '" stroke="#D6DEE7"/>' + text;
    }).join('');
    const remainder = layout.residualLabel
      ? '<rect x="' + (119 + offset).toFixed(1) + '" y="' + (y + 2) + '" width="' + Math.max(layout.residual / total * 890 - 3, 0).toFixed(1) + '" height="43" fill="#F5F5F4" stroke="#CBD5E1" stroke-dasharray="3 3"/>'
      : '';
    const area = esc(fmt(floor.floor_area_sqm));
    const rowTitle = esc(floor.floor_code.startsWith('B') ? floor.floor_code : floor.floor_code + 'F');
    return '<text x="76" y="' + (y + 29) + '" font-size="15" font-weight="700" text-anchor="middle" fill="#34495E" font-family="Arial,Microsoft YaHei,sans-serif">' + rowTitle + '</text>'
      + tiles + remainder
      + '<text x="1120" y="' + (y + 29) + '" font-size="13" text-anchor="end" fill="#667085" font-family="Arial,Microsoft YaHei,sans-serif">' + area + ' ㎡</text>'
      + '<line x1="116" x2="1123" y1="' + (y + 49) + '" y2="' + (y + 49) + '" stroke="#E4E9F0"/>';
  }).join('');
  const scope = filtered ? '当前筛选范围（隐藏其余单元）' : '完整已建模范围';
  const foot = [
    '<text x="43" y="' + (height - 104) + '" font-size="14" fill="#405368" font-family="Arial,Microsoft YaHei,sans-serif">■ 已租　■ 空置　■ 其他用途　■ 状态待确认</text>',
    '<text x="43" y="' + (height - 75) + '" font-size="13" fill="#667085" font-family="Arial,Microsoft YaHei,sans-serif">' + esc(scope) + ' · 未标明面积不代表空置；色块只反映来源中可读面积比例</text>',
    '<text x="43" y="' + (height - 46) + '" font-size="13" fill="#667085" font-family="Arial,Microsoft YaHei,sans-serif">数据截至：' + esc(source?.source_as_of ?? '未知') + ' · 来源：' + esc(brief(source?.title ?? '未提供', 48)) + ' · 仅供内部核验</text>',
    '<text x="43" y="' + (height - 22) + '" font-size="12" fill="#87551F" font-family="Arial,Microsoft YaHei,sans-serif">' + esc(missing.length ? '楼层编号待核：' + missing.join('、') + '（不能认定存在或不存在）' : '全部空间事实仍须按来源逐项核验') + '</text>',
    '</svg>',
  ];
  return header.join('') + labels + foot.join('');
}

export function StackingPlanWorkspace({ buildingId }: { buildingId: string }) {
  const { session, status } = useAppSession();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [towerCode, setTowerCode] = useState('A');
  const [filter, setFilter] = useState<SpaceFilter>('all');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<ExportScope>('visible');
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
  const summary = useMemo(() => summarizePlan(floors, unitList), [floors, unitList]);
  const missingFloorLabels = useMemo(() => uncoveredFloorLabels(floors), [floors]);
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

  async function exportPlan(format: 'png' | 'svg' | 'xlsx') {
    if (!payload || !tower || busy) return;
    setBusy(format); setError(null); setFeedback(null);
    try {
      const target = scope === 'all' ? selectFloorRows(floors, unitList, 'all', '') : rows;
      await authenticatedFetch('POST', { action: 'export', format });
      const filename = payload.building.name + '-' + tower.display_name + '-StackingPlan-' +
        (source?.source_as_of ?? 'date-unknown') + '-' + (scope === 'all' ? 'full' : 'filtered') + '-UNVERIFIED';
      if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const records = target.flatMap(({ floor, spaces }) => {
          const check = areaCheck(floor, unitList.filter(s => s.floor_id === floor.id));
          const base = {
            '项目': excelText(payload.building.name), '楼座': excelText(tower.display_name),
            '楼层': floor.floor_code, '原图楼层面积(㎡)': areaNumber(floor.floor_area_sqm),
            '单元面积合计差额(㎡)': check.reference === null ? null : Number((check.reference - check.recorded).toFixed(2)),
          };
          const unitRecords = spaces.length ? spaces : [null];
          return unitRecords.map(space => ({
            ...base,
            '单元': space?.unit_code ?? '未录入单元',
            '租户 / 用途': excelText(space?.tenant_name),
            '来源标注状态': space ? OCCUPANCY_LABELS[space.occupancy_status] : '未知',
            '单元面积(㎡)': areaNumber(space?.area_sqm),
            '原图租金阶段与日期': excelText((space?.lease_steps ?? []).map(step =>
              (step.start || '日期未知') + ' 至 ' + (step.end || '日期未知') + '：' +
              (step.face_rent_monthly ?? step.monthly_total_rent ?? '—') + ' ' + (step.unit ?? ''),
            ).join('；')),
            '审核状态': space?.verification_status ?? '未录入',
            '来源数据截至': source?.source_as_of ?? '待确认',
            '原始文件归档': source?.evidence_storage_path ? '已归档' : '未归档',
            '来源': excelText(source?.title),
            '备注': excelText(space?.notes),
          }));
        });
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.json_to_sheet(records);
        sheet['!cols'] = [22,12,10,21,25,18,25,21,20,50,19,18,20,32,48].map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(workbook, sheet, '租赁分层明细');
        const notes = [
          ['Stacking Plan · 数据口径与使用限制'],
          ['项目', payload.building.name], ['楼座', tower.display_name],
          ['业务截至日期', source?.source_as_of ?? '待确认'],
          ['来源', source?.title ?? '未提供'],
          ['空间核验', '未核验来源仅供内部研究，不能视为当前正式租赁或销控事实'],
          ['空置与面积', '状态来自原图；面积差额不是空置；未知/未分配不得作为可租房源'],
          ['导出范围', scope === 'all' ? '全部已建模单元' : '当前筛选（包含搜索条件）'],
          ['楼层覆盖疑点', missingFloorLabels.join('、') || '无编号缺口'],
          ['生成时间', new Date().toISOString()],
        ];
        const notesSheet = XLSX.utils.aoa_to_sheet(notes);
        notesSheet['!cols'] = [{ wch: 25 }, { wch: 100 }];
        XLSX.utils.book_append_sheet(workbook, notesSheet, '口径与来源');
        XLSX.writeFile(workbook, filename + '.xlsx');
      } else {
        const svg = makeSvg(tower, target, payload.building.name, source,
          scope === 'visible' && filtered, missingFloorLabels);
        if (format === 'svg') {
          saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename + '.svg');
        } else {
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
          try {
            const img = new window.Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('图片渲染失败'));
              img.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth * 2; canvas.height = img.naturalHeight * 2;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法生成图片');
            ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
            const blob = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob(item => item ? resolve(item) : reject(new Error('PNG 编码失败')), 'image/png'));
            saveBlob(blob, filename + '.png');
          } finally { URL.revokeObjectURL(url); }
        }
      }
      setFeedback(format.toUpperCase() + ' 已生成（来源未逐项核验）。');
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setBusy(null); }
  }

  async function uploadOriginal(file: File) {
    if (!source || busy) return;
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
        <span className={styles.brand}>COLLIERS <span>INTELLIGENCE</span></span>
        <span className={styles.admin}>ADMIN · INTERNAL</span>
      </header>

      <div className={styles.container}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}><Building2 size={14}/> 资产数据 / 楼宇租赁</p>
            <h1>{payload?.building.name ?? '楼宇租赁堆叠图'} <span>Stacking Plan</span></h1>
            <p className={styles.headingNote}>楼层占用与租金阶段 · 基于来源快照，不代表实时出租及可租房源</p>
          </div>
          <button type="button" onClick={() => setRefreshKey(n => n + 1)}
            className={styles.lightButton}><RefreshCw size={15}/> 刷新数据</button>
        </div>

        {status === 'loading' ? <div className={styles.state}>正在校验管理员身份…</div>
          : unauthorized ? <div className={styles.state}>仅真实 Admin 账号可访问此功能。<a href="/map">返回地图</a></div>
          : !payload && !error ? <div className={styles.state}>正在读取楼层资料…</div>
          : !payload ? <div className={styles.state}>{error}<button type="button" onClick={() => setRefreshKey(n => n + 1)}>重试</button></div>
          : (
          <>
            <div className={styles.sourceStrip}>
              <div className={styles.sourceMain}>
                <ShieldAlert size={17} aria-hidden="true" />
                <span><strong>来源快照 · 未逐项核验</strong>　数据截至 {source?.source_as_of ?? '待确认'}；“已租”“空置”为原图标注，不能替代季度空置率或正式销控。</span>
              </div>
              <div className={styles.evidenceControls}>
                <span className={source?.evidence_storage_path ? styles.evidenceArchived : styles.evidenceMissing}>
                  {source?.evidence_storage_path ? <Check size={14}/> : <AlertTriangle size={14}/>}
                  原始文件{source?.evidence_storage_path ? '已归档' : '未归档'}
                </span>
                <input ref={fileInput} type="file" className={styles.hiddenFile} accept=".png,.jpg,.jpeg,.webp,.pdf,.xlsx"
                  aria-label="选择原始资料文件" onChange={event => {
                    const file = event.target.files?.[0]; if (file) void uploadOriginal(file);
                  }} />
                <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}>
                  <FileUp size={15}/> {source?.evidence_storage_path ? '替换原件' : '上传原件'}
                </button>
                {source?.evidence_storage_path && <button type="button" disabled={!!busy}
                  onClick={() => void downloadOriginal()}><ArrowDownToLine size={15}/> 查看原件</button>}
              </div>
            </div>

            <section className={styles.toolbar} aria-label="楼宇租赁查询与导出">
              <div className={styles.tabs} aria-label="楼座">
                {payload.towers.map(t => <button key={t.id} type="button" aria-pressed={tower?.id === t.id}
                  className={tower?.id === t.id ? styles.activeTab : ''}
                  onClick={() => selectTower(t.code)}>{t.display_name}</button>)}
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
                <span className={styles.controlDivider} aria-hidden="true"/>
                <select aria-label="导出数据范围" value={scope}
                  onChange={event => setScope(event.target.value as ExportScope)}>
                  <option value="visible">当前筛选</option><option value="all">全部单元</option>
                </select>
                <button type="button" onClick={() => void exportPlan('xlsx')} disabled={!!busy} title="导出结构化明细和来源说明">
                  <FileSpreadsheet size={16}/> Excel
                </button>
                <button type="button" onClick={() => void exportPlan('png')} disabled={!!busy}>
                  <FileImage size={16}/> PNG
                </button>
                <button type="button" onClick={() => void exportPlan('svg')} disabled={!!busy}>
                  <Download size={16}/> SVG
                </button>
              </div>
            </section>

            <section className={styles.statGrid} aria-label="来源办公空间摘要">
              <div><small>已建模办公楼层</small><strong>{summary.officeFloors} <em>层</em></strong></div>
              <div><small>办公楼层面积合计</small><strong>{fmt(summary.officeArea)} <em>㎡</em></strong></div>
              <div><small>原图标注已租面积</small><strong>{fmt(summary.occupiedArea)} <em>㎡</em></strong></div>
              <div><small>原图标注空置面积</small><strong>{fmt(summary.vacantArea)} <em>㎡</em></strong></div>
              <div className={styles.qualityCard}>
                <small>逐项已核验</small><strong>{summary.verifiedUnits} <em>/ {summary.allUnits} 单元</em></strong>
                <div className={styles.qualityTrack}><span style={{ width: (summary.allUnits ? summary.verifiedUnits / summary.allUnits * 100 : 0) + '%' }}/></div>
              </div>
            </section>

            {(missingFloorLabels.length > 0 || summary.areaConflicts > 0 || summary.missingAreaUnits > 0) && (
              <div className={styles.qualityNotice}>
                <Layers3 size={16}/>
                <span>
                  {missingFloorLabels.length > 0 && '资料未覆盖楼层编号：' + missingFloorLabels.join('、') + '（不代表该层一定存在）；'}
                  {summary.missingAreaUnits > 0 && ' ' + summary.missingAreaUnits + ' 个单元未记录面积；'}
                  {summary.areaConflicts > 0 && ' ' + summary.areaConflicts + ' 个办公楼层面积存在超额差异；'}
                  未知面积不得直接判定为空置。
                </span>
              </div>
            )}

            <div className={styles.layout}>
              <section className={styles.plan} aria-label="楼宇租赁立面">
                <div className={styles.sectionTitle}>
                  <div>
                    <p className={styles.sectionKicker}>FLOOR STACK / SOURCE SNAPSHOT</p>
                    <h2>{tower?.display_name ?? '楼座'} · 楼层租赁分布</h2>
                    <p>{filtered ? '当前显示符合筛选的单元，其余面积以留白标注。' : '点击租户色块查看详情；相同租户标注可联动高亮。'}</p>
                  </div>
                  <span className={styles.floorCount}>{rows.length} 层可见</span>
                </div>

                <div className={styles.facade}>
                  <div className={styles.roof}><Building2 size={16}/><span>{tower?.display_name ?? '楼座'}</span></div>
                  <div className={styles.tower}>
                    {rows.length ? rows.map(({ floor, spaces }) => {
                      const wholeFloor = unitList.filter(s => s.floor_id === floor.id);
                      const audit = areaCheck(floor, wholeFloor);
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
                                space.verification_status !== 'verified' ? styles.unverified : '',
                              ].filter(Boolean).join(' ')}
                              onClick={() => selectUnit(space)}
                              style={{ flexGrow: weight, flexBasis: 0 }}
                              title={asUnitName(space) + ' · ' + fmt(space.area_sqm) + '㎡ · ' + (space.verification_status === 'verified' ? '已核验' : '待核验')}
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
                          {(audit.overallocated > 0 || audit.missingUnitAreas > 0 || audit.gap !== null) &&
                            <small className={styles.areaMarker} title={'来源面积未完全核对：已录入 ' + fmt(audit.recorded) + '㎡'}>
                              待核
                            </small>}
                        </div>
                      </div>;
                    }) : <p className={styles.emptyFloor}>没有符合条件的单元。可清空搜索或切换状态筛选。</p>}
                  </div>
                  <div className={styles.plinth}><span>{tower?.display_name} · 资料形象示意，非建筑精确测绘</span></div>
                </div>

                <div className={styles.legend}>
                  <span><i className={styles.occupied}/> 已租</span>
                  <span><i className={styles.vacant}/> 空置</span>
                  <span><i className={styles.other}/> 其他用途</span>
                  <span><i className={styles.unknown}/> 待确认</span>
                  <span><i className={styles.unverifiedKey}/> 斜纹：未逐项核验</span>
                  <span><i className={styles.unallocatedKey}/> 虚线：未展示/未覆盖面积</span>
                </div>
                <p className={styles.disclaimer}>
                  资料截至 {source?.source_as_of ?? '待确认'}。单元宽度按有记录的面积近似比例绘制，不反映实际平面几何；
                  未知面积使用视觉占位，不据此估算面积。所有出租及空置标注均须与正式租赁资料核对。
                </p>
              </section>

              {selected && <button type="button" aria-label="关闭租赁详情" className={styles.drawerBackdrop}
                onClick={() => { if (!isEditing || window.confirm('编辑内容尚未保存，确定关闭吗？')) { setSelectedId(null); setIsEditing(false); } }}/>}
              <aside className={[styles.details, selected ? styles.drawerActive : ''].join(' ')}
                aria-label="租赁单元详情">
                {selected ? <>
                  <div className={styles.detailHeader}>
                    <div className={styles.sectionKicker}>SPACE RECORD / SOURCE</div>
                    <button type="button" aria-label="关闭详情" onClick={() => {
                      if (isEditing && !window.confirm('编辑内容尚未保存，确定关闭吗？')) return;
                      setSelectedId(null); setIsEditing(false);
                    }}><X size={18}/></button>
                  </div>
                  <h2>{selected.tenant_name || asUnitName(selected)}</h2>
                  <p className={styles.detailHint}>{tower?.display_name} · {selectedFloor?.floor_code}F · {selected.unit_code}</p>
                  <div className={styles.detailFacts}>
                    <div><small>来源标注状态</small><strong>{OCCUPANCY_LABELS[selected.occupancy_status]}</strong></div>
                    <div><small>单元面积</small><strong>{fmt(selected.area_sqm)} ㎡</strong></div>
                    <div><small>数据核验</small><strong>{selected.verification_status === 'verified' ? '已核验' : '待逐项核验'}</strong></div>
                    <div><small>记录版本</small><strong>v{selected.revision}</strong></div>
                  </div>
                  {linked.length > 1 && <div className={styles.linkedTenants}>
                    <div className={styles.linkedTitle}><Link2 size={15}/> 同名来源标注 · {linked.length} 个单元</div>
                    <div className={styles.linkedList}>
                      {linked.map(space => {
                        const floor = floors.find(f => f.id === space.floor_id);
                        return <button key={space.id} type="button" aria-current={selected.id === space.id}
                          onClick={() => selectUnit(space)}>
                          {floor?.floor_code}F <span>{fmt(space.area_sqm)}㎡</span>
                        </button>;
                      })}
                    </div>
                    <p>仅联动同名文本，不表示已核验为同一法律承租方。</p>
                  </div>}
                  <h3>原图租金阶段</h3>
                  {selected.lease_steps.length ? selected.lease_steps.map((step, index) =>
                    <div className={styles.step} key={index}>
                      <strong>{step.face_rent_monthly != null ? fmt(step.face_rent_monthly) + ' 元/㎡/月'
                        : step.monthly_total_rent != null ? fmt(step.monthly_total_rent) + ' 元/月（总租金）'
                          : '租金未注明'}</strong>
                      <span>{step.start || '日期未知'} — {step.end || '日期未知'}</span>
                      {step.area_sqm != null && <span>阶段面积 {fmt(step.area_sqm)} ㎡</span>}
                    </div>) : <p className={styles.none}>原图未提供租金阶段</p>}

                  {!isEditing ? <>
                    <h3>备注 / 待核验事项</h3>
                    <p className={styles.notes}>{selected.notes || '暂无备注'}</p>
                    <button type="button" className={styles.editButton} onClick={() => setIsEditing(true)}>
                      <Edit3 size={16}/> 编辑来源草稿 <ChevronRight size={15}/>
                    </button>
                  </> : <div className={styles.editPanel}>
                    <div className={styles.editPanelHeader}><h3>修改来源草稿</h3><button type="button"
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
                      <Check size={16}/>{saving ? '正在保存…' : '保存来源草稿'}
                    </button>
                    <p className={styles.detailHint}>保存保留版本与前后审计，不自动核验原图或回写季度、成交、销控。</p>
                  </div>}
                </> : <>
                  <div className={styles.sectionKicker}>BUILDING OVERVIEW</div>
                  <div className={styles.overviewIcon}><Layers3 size={25}/></div>
                  <h2>{tower?.display_name ?? '楼座'} · 数据概览</h2>
                  <p className={styles.detailHint}>选择任意楼层色块查看租户、面积、租金阶段和证据；同名来源标注将联动显示。</p>
                  <div className={styles.infoLine}><span>数据截至</span><strong>{source?.source_as_of ?? '待确认'}</strong></div>
                  <div className={styles.infoLine}><span>核验覆盖</span><strong>{summary.verifiedUnits} / {summary.allUnits} 单元</strong></div>
                  <div className={styles.infoLine}><span>来源原件</span><strong>{source?.evidence_storage_path ? '已私有归档' : '待归档'}</strong></div>
                  <div className={styles.infoLine}><span>原图其他用途面积</span><strong>{fmt(summary.otherArea)} ㎡</strong></div>
                  <div className={styles.overviewNotice}>数据来源未逐项核验；不要将标注空置面积直接作为招商供应。</div>
                </>}
              </aside>
            </div>

            <details className={styles.sourceDetails}>
              <summary>数据来源与核验说明 <ChevronRight size={15}/></summary>
              <div className={styles.sourceDetailsBody}>
                <p><strong>资料标题：</strong>{source?.title ?? '未提供'}</p>
                <p><strong>业务截至：</strong>{source?.source_as_of ?? '未确认'}；{source?.review_state === 'date_confirmed' ? '已确认来源日期' : '来源日期未确认'}，不代表空间事实核验通过。</p>
                <p><strong>原始文件：</strong>{source?.evidence_filename ?? '尚未归档'}{source?.evidence_sha256 ? '；SHA-256：' + source.evidence_sha256 : ''}</p>
                <p><strong>记录问题：</strong>{summary.missingAreaUnits} 个单元面积未知；{summary.unknownStatusUnits} 个状态未知；{summary.areaConflicts} 个办公楼层面积超额冲突。</p>
                {source?.source_note && <p><strong>来源说明：</strong>{source.source_note}</p>}
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
