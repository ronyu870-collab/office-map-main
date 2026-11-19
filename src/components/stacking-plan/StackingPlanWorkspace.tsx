'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, Download, FileSpreadsheet, Image as ImageIcon, RefreshCw, Save, X } from 'lucide-react';
import { useAppSession } from '@/src/components/SessionProvider';
import { isUserAdmin } from '@/src/utils/accessControl';
import { getSessionFast } from '@/src/services/Auth';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import styles from './StackingPlanWorkspace.module.css';

type Tower = { id: string; code: string; display_name: string };
type Floor = { id: string; tower_id: string; floor_code: string; level_order: number; floor_area_sqm: number | string | null; zone: string | null; use_type: string };
type Step = { start: string | null; end: string | null; face_rent_monthly?: number | null; monthly_total_rent?: number | null; area_sqm?: number | null; unit?: string };
type Space = { id: string; floor_id: string; unit_code: string; occupancy_status: 'occupied' | 'vacant' | 'other' | 'unknown'; tenant_name: string | null; area_sqm: number | string | null; lease_steps: Step[]; notes: string; verification_status: string; revision: number; source_id: string };
type Source = { id: string; title: string; source_as_of: string | null; as_of_kind: string; review_state: string; source_note: string | null };
type Payload = { building: { id: string; name: string }; towers: Tower[]; floors: Floor[]; spaces: Space[]; sources: Source[]; basis: string };
type Filter = 'all' | Space['occupancy_status'];

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部楼层' }, { value: 'occupied', label: '已租' }, { value: 'vacant', label: '空置' },
  { value: 'other', label: '其他用途' }, { value: 'unknown', label: '待确认' },
];
const STATUS: Record<Space['occupancy_status'], string> = {
  occupied: '已租（原图）', vacant: '空置（原图）', other: '其他用途', unknown: '待确认',
};
const numeric = (value: number | string | null | undefined) => value === null || value === undefined || value === '' ? null : Number(value);
const fmt = (value: number | string | null | undefined) => {
  const n = numeric(value);
  return n !== null && Number.isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
};
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c));
const short = (text: string, length = 15) => text.length > length ? text.slice(0, length) + '…' : text;
const statusFill: Record<Space['occupancy_status'], string> = { occupied: '#DCEBF5', vacant: '#E9EDF1', other: '#E5E9E5', unknown: '#F3E5CA' };
const statusText: Record<Space['occupancy_status'], string> = { occupied: '#205F83', vacant: '#546272', other: '#476556', unknown: '#885D25' };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeSvg(tower: Tower, floors: Floor[], spaces: Space[], name: string, source: Source | null) {
  const width = 1080, rowHeight = 49, top = 163, margin = 34;
  const height = top + rowHeight * floors.length + 105;
  const rows = floors.map((floor, index) => {
    const y = top + index * rowHeight;
    const units = spaces.filter(s => s.floor_id === floor.id);
    const total = units.reduce((sum, s) => sum + Math.max(0, numeric(s.area_sqm) ?? 0), 0);
    const measured = units.filter(s => numeric(s.area_sqm) !== null).length;
    const fallbackArea = measured && total > 0 ? total / measured : 1;
    const weights = units.map(s => Math.max(0.01, numeric(s.area_sqm) ?? fallbackArea));
    const sumWeights = weights.reduce((s, n) => s + n, 0);
    let offset = 0;
    const tiles = units.map((unit, unitIndex) => {
      const w = (weights[unitIndex] / (sumWeights || 1)) * 794;
      const x = 119 + offset;
      offset += w;
      return `<rect x="${x.toFixed(2)}" y="${y + 3}" width="${Math.max(w - 3, 0).toFixed(2)}" height="42" rx="3" fill="${statusFill[unit.occupancy_status]}" stroke="#C6CFD9" />
        ${w > 66 ? `<text x="${(x + w / 2).toFixed(2)}" y="${y + 28}" text-anchor="middle" font-size="13" font-weight="600" fill="${statusText[unit.occupancy_status]}">${esc(short(unit.tenant_name || (unit.occupancy_status === 'vacant' ? '空置' : unit.occupancy_status === 'unknown' ? unit.unit_code + ' 待确认' : unit.unit_code), Math.max(3, Math.floor(w / 18))))}</text>` : ''}`;
    }).join('');
    return `<text x="58" y="${y + 29}" font-size="15" font-weight="700" fill="#334155">${esc(floor.floor_code)}F</text>
      <line x1="105" x2="1040" y1="${y + 48}" y2="${y + 48}" stroke="#E1E5EA"/>
      ${tiles}<text x="1038" y="${y + 28}" text-anchor="end" font-size="13" fill="#68788C">${esc(fmt(floor.floor_area_sqm))} ㎡</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#FFFFFF"/>
    <rect width="${width}" height="10" fill="#B82034"/>
    <text x="${margin}" y="52" font-size="15" letter-spacing="3" fill="#B82034" font-family="Arial,sans-serif">COLLIERS INTELLIGENCE</text>
    <text x="${margin}" y="94" font-size="29" font-weight="700" fill="#182536" font-family="Arial,'Microsoft YaHei',sans-serif">${esc(name)} · ${esc(tower.display_name)}</text>
    <text x="${margin}" y="124" font-size="14" fill="#718093" font-family="Arial,'Microsoft YaHei',sans-serif">STACKING PLAN · 原始资料展示（非已核实当前租赁状态）</text>
    <rect x="105" y="150" width="816" height="${rowHeight * floors.length + 9}" rx="5" fill="#F9FAFC" stroke="#C6D0DB"/>
    <g font-family="Arial,'Microsoft YaHei',sans-serif">${rows}</g>
    <text x="${margin}" y="${height - 69}" font-size="14" fill="#344255" font-family="Arial,'Microsoft YaHei',sans-serif">■ 已租  ■ 空置  ■ 其他用途  ■ 待确认</text>
    <text x="${margin}" y="${height - 40}" font-size="13" fill="#798595" font-family="Arial,'Microsoft YaHei',sans-serif">资料截至：${esc(source?.source_as_of || '未确认')} · 仅供内部分析 · 来源：${esc(short(source?.title || '暂无', 50))}</text>
  </svg>`;
}

export function StackingPlanWorkspace({ buildingId }: { buildingId: string }) {
  const { session, status } = useAppSession();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [towerCode, setTowerCode] = useState('A');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [edit, setEdit] = useState({ tenant_name: '', occupancy_status: 'unknown' as Space['occupancy_status'], area_sqm: '', notes: '' });
  const allowed = status === 'authenticated' && isUserAdmin(session?.role);
  const unauthorized = status === 'unauthenticated' || (status === 'authenticated' && !allowed);

  useEffect(() => {
    if (!allowed) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setPayload(null);
    (async () => {
      const current = await getSessionFast();
      const accessToken = current?.session.access_token;
      if (!accessToken) throw new Error('未取得有效登录凭据');
      const headers = withImpersonationHeaders({ Authorization: `Bearer ${accessToken}` });
      const response = await fetch(`/api/stacking-plan/${buildingId}`, { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载失败');
      if (!cancelled) setPayload(data as Payload);
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : '加载失败'); });
    return () => { cancelled = true; };
  }, [allowed, buildingId, refreshKey]);

  const tower = payload?.towers.find(t => t.code === towerCode) ?? payload?.towers[0] ?? null;
  const floors = useMemo(() => (payload?.floors ?? []).filter(f => f.tower_id === tower?.id)
    .sort((a, b) => b.level_order - a.level_order), [payload, tower?.id]);
  const unitList = useMemo(() => (payload?.spaces ?? []).filter(s => floors.some(f => f.id === s.floor_id)), [payload, floors]);
  const source = payload?.sources[0] ?? null;
  const visibleFloors = floors.filter(f => filter === 'all' || unitList.some(s => s.floor_id === f.id && s.occupancy_status === filter));
  const selected = (payload?.spaces ?? []).find(s => s.id === selectedId) ?? null;
  const selectedFloor = floors.find(f => f.id === selected?.floor_id);
  const officeFloors = floors.filter(f => f.use_type === 'office');
  const area = officeFloors.reduce((sum, f) => sum + (numeric(f.floor_area_sqm) ?? 0), 0);
  const officeIds = new Set(officeFloors.map(f => f.id));
  const leased = unitList.filter(s => officeIds.has(s.floor_id) && s.occupancy_status === 'occupied').reduce((n, s) => n + (numeric(s.area_sqm) ?? 0), 0);
  const vacant = unitList.filter(s => officeIds.has(s.floor_id) && s.occupancy_status === 'vacant').reduce((n, s) => n + (numeric(s.area_sqm) ?? 0), 0);

  function selectUnit(space: Space) {
    setSelectedId(space.id);
    setEdit({
      tenant_name: space.tenant_name ?? '', occupancy_status: space.occupancy_status,
      area_sqm: space.area_sqm === null ? '' : String(space.area_sqm), notes: space.notes ?? '',
    });
    setError(null);
  }

  async function authenticatedFetch(method: 'PATCH' | 'POST', body: unknown) {
    const current = await getSessionFast();
    if (!current?.session.access_token) throw new Error('请重新登录');
    const headers = withImpersonationHeaders({
      Authorization: `Bearer ${current.session.access_token}`,
      'Content-Type': 'application/json',
    });
    const response = await fetch(`/api/stacking-plan/${buildingId}`, { method, headers, body: JSON.stringify(body), cache: 'no-store' });
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
    setSaving(true); setError(null);
    try {
      const next = await authenticatedFetch('PATCH', {
        space_id: selected.id, expected_revision: selected.revision,
        patch: { tenant_name: edit.tenant_name.trim() || null, occupancy_status: edit.occupancy_status, area_sqm: parsedArea, notes: edit.notes },
      });
      setPayload(previous => previous && ({ ...previous, spaces: previous.spaces.map(s => s.id === selected.id ? next.space as Space : s) }));
      setError('保存成功。该记录仍属未核验来源，不会转成已确认当前房源。');
    } catch(e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally { setSaving(false); }
  }

  async function exportPlan(format: 'png' | 'svg' | 'xlsx') {
    if (!payload || !tower || busy) return;
    setBusy(format); setError(null);
    try {
      await authenticatedFetch('POST', { action: 'export', format });
      const name = `${payload.building.name}-${tower.display_name}-Stacking-Plan-未核验`;
      if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const rows = visibleFloors.flatMap(f => unitList.filter(s => s.floor_id === f.id && (filter === 'all' || s.occupancy_status === filter)).map(s => ({
          '项目': payload.building.name, '楼座': tower.display_name, '楼层': f.floor_code, '楼层建筑面积(㎡)': numeric(f.floor_area_sqm),
          '单元': s.unit_code, '租户': s.tenant_name ?? '', '空间状态(来源原图)': STATUS[s.occupancy_status],
          '单元面积(㎡)': numeric(s.area_sqm), '租金阶段及期限': (s.lease_steps ?? []).map(step => `${step.start || '日期未知'} 至 ${step.end || '日期未知'}：${step.face_rent_monthly ?? step.monthly_total_rent ?? '—'} ${step.unit ?? ''}`).join('；'),
          '数据截至': source?.source_as_of ?? '待确认', '审核状态': s.verification_status, '备注': s.notes, '来源': source?.title ?? '',
        })));
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.json_to_sheet(rows);
        sheet['!cols'] = [18,12,10,18,12,24,22,18,60,16,18,45,34].map(wch => ({ wch }));
        XLSX.utils.book_append_sheet(workbook, sheet, '楼层租赁明细');
        XLSX.writeFile(workbook, `${name}.xlsx`);
      } else {
        const svg = makeSvg(tower, visibleFloors, unitList, payload.building.name, source);
        if (format === 'svg') {
          saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`);
        } else {
          const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
          try {
            const img = new window.Image();
            await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('图片渲染失败')); img.src = svgUrl; });
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth * 2; canvas.height = img.naturalHeight * 2;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('无法生成图片');
            ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG 编码失败')), 'image/png'));
            saveBlob(blob, `${name}.png`);
          } finally { URL.revokeObjectURL(svgUrl); }
        }
      }
    } catch(e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally { setBusy(null); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a href={`/map?building=${encodeURIComponent(buildingId)}`} className={styles.back}><ArrowLeft size={17} /> 返回地图</a>
        <span className={styles.brand}>COLLIERS <span>INTELLIGENCE</span></span>
        <span className={styles.admin}>ADMIN · INTERNAL</span>
      </header>
      <div className={styles.container}>
        <div className={styles.heading}>
          <div>
            <div className={styles.eyebrow}><Building2 size={13} /> PROPERTY INTELLIGENCE / STACKING PLAN</div>
            <h1>{payload?.building.name ?? '楼宇租赁堆叠图'} <span>Stacking Plan</span></h1>
            <p>逐层查看租户、占用状态、楼层面积与租金阶段 · 资料独立于季度经营指标和成交库</p>
          </div>
          <button type="button" onClick={() => setRefreshKey(v => v + 1)} className={styles.lightButton}><RefreshCw size={15}/> 刷新</button>
        </div>
        {status === 'loading' ? <div className={styles.state}>正在验证管理员会话…</div> : unauthorized ? (
          <div className={styles.state}>仅真实 Admin 账号可访问该功能。<a href="/map">返回地图</a></div>
        ) : !payload && !error ? <div className={styles.state}>正在读取楼宇租赁资料…</div> : !payload ? (
          <div className={styles.state}>{error} <button type="button" onClick={() => setRefreshKey(v => v + 1)}>重试</button></div>
        ) : (
          <>
            <div className={styles.caution}><strong>数据截至：{source?.source_as_of ?? '待确认'}</strong> · {source?.review_state === 'date_confirmed' ? '用户已确认来源日期；' : '来源日期待确认；'}租户及单元信息仍待逐项核验。“已租”“空置”是截图标注，不得与当前季度经营空置率混用。</div>
            <section className={styles.toolbar}>
              <div className={styles.tabs} aria-label="楼座">
                {payload.towers.map(t => <button key={t.id} type="button" aria-pressed={tower?.id === t.id} className={tower?.id === t.id ? styles.activeTab : ''} onClick={() => { setTowerCode(t.code); setSelectedId(null); setFilter('all'); }}>{t.display_name}</button>)}
              </div>
              <div className={styles.controls}>
                <select aria-label="空间状态筛选" value={filter} onChange={e => setFilter(e.target.value as Filter)}>{FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
                <button type="button" onClick={() => void exportPlan('xlsx')} disabled={!!busy}><FileSpreadsheet size={15}/> Excel</button>
                <button type="button" onClick={() => void exportPlan('png')} disabled={!!busy}><ImageIcon size={15}/> PNG</button>
                <button type="button" onClick={() => void exportPlan('svg')} disabled={!!busy}><Download size={15}/> SVG</button>
              </div>
            </section>
            <section className={styles.statGrid}>
              <div><small>已建模办公楼层</small><strong>{officeFloors.length} <em>层</em></strong></div>
              <div><small>办公楼层建筑面积之和</small><strong>{fmt(area)} <em>㎡</em></strong></div>
              <div><small>原图标注已租面积</small><strong>{fmt(leased)} <em>㎡</em></strong></div>
              <div><small>原图标注空置面积</small><strong>{fmt(vacant)} <em>㎡</em></strong></div>
            </section>
            <div className={styles.layout}>
              <section className={styles.plan}>
                <div className={styles.sectionTitle}>
                  <div><h2>{tower?.display_name ?? '楼座'} · 垂直租赁分布</h2><p>点击彩色单元查看资料与修改草稿；色块宽度按有记录的单元面积比例绘制。</p></div>
                  <span>{visibleFloors.length} 层</span>
                </div>
                <div className={styles.roof}><span>{tower?.display_name}</span></div>
                <div className={styles.tower}>
                  {visibleFloors.length ? visibleFloors.map(f => {
                    const units = unitList.filter(s => s.floor_id === f.id);
                    const known = units.reduce((sum, s) => sum + (numeric(s.area_sqm) ?? 0), 0);
                    const measured = units.filter(s => numeric(s.area_sqm) !== null).length;
                    const fallbackArea = measured && known > 0 ? known / measured : 1;
                    const displayArea = units.reduce((sum, s) => sum + (numeric(s.area_sqm) ?? fallbackArea), 0);
                    return <div className={styles.floor} key={f.id}>
                      <div className={styles.level}><strong>{f.floor_code}</strong><small>{f.zone ?? ''}</small></div>
                      <div className={styles.units}>
                        {units.map(s => <button type="button" key={s.id} onClick={() => selectUnit(s)}
                          title={`${s.tenant_name || STATUS[s.occupancy_status]} · ${fmt(s.area_sqm)}㎡`}
                          className={`${styles.unit} ${styles[s.occupancy_status]} ${selected?.id === s.id ? styles.chosen : ''}`}
                          style={{ flex: displayArea > 0 ? (numeric(s.area_sqm) ?? fallbackArea) / displayArea : 1 / units.length }}>
                          <span>{s.tenant_name ?? (s.occupancy_status === 'vacant' ? '空置' : s.occupancy_status === 'unknown' ? s.unit_code + ' 待确认' : s.unit_code)}</span>
                          <small>{fmt(s.area_sqm)}㎡</small>
                        </button>)}
                        {!units.length && <div className={styles.emptyUnit}>无已录入单元</div>}
                      </div>
                      <div className={styles.floorArea}>{fmt(f.floor_area_sqm)} <small>㎡</small></div>
                    </div>;
                  }) : <p className={styles.emptyFloor}>此楼座暂无对应筛选状态的楼层记录。</p>}
                </div>
                <div className={styles.legend}>
                  <span><i className={styles.occupied}/>已租</span><span><i className={styles.vacant}/>空置</span>
                  <span><i className={styles.other}/>其他用途</span><span><i className={styles.unknown}/>待确认</span>
                </div>
                <p className={styles.disclaimer}>图片来源数据截至 {source?.source_as_of ?? '待确认'}；尚未逐项核验。单元横向宽度仅表达面积比例，不表示真实平面位置。未知面积不参加合计，B1 等特殊用途楼层不计入办公楼层面积。</p>
              </section>
              <aside className={styles.details}>
                {selected ? <>
                  <div className={styles.detailHeader}><div className={styles.eyebrow}>SPACE DETAILS</div><button type="button" aria-label="关闭详情" onClick={() => setSelectedId(null)}><X size={18}/></button></div>
                  <h2>{tower?.display_name} · {selectedFloor?.floor_code}F <span>/ {selected.unit_code}</span></h2>
                  <p className={styles.detailHint}>来源截图 · 记录版本 {selected.revision} · 尚未确认实时状态</p>
                  <div className={styles.field}><label htmlFor="sp-tenant">租户 / 用途</label><input id="sp-tenant" value={edit.tenant_name} onChange={e => setEdit(v => ({ ...v, tenant_name: e.target.value }))}/></div>
                  <div className={styles.field}><label htmlFor="sp-status">来源标注状态</label><select id="sp-status" value={edit.occupancy_status} onChange={e => setEdit(v => ({ ...v, occupancy_status: e.target.value as Space['occupancy_status'] }))}>{Object.entries(STATUS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
                  <div className={styles.field}><label htmlFor="sp-area">单元面积（㎡）</label><input id="sp-area" inputMode="decimal" value={edit.area_sqm} onChange={e => setEdit(v => ({ ...v, area_sqm: e.target.value }))}/></div>
                  <h3>原图租金阶段</h3>
                  {selected.lease_steps.length ? selected.lease_steps.map((step, i) => <div className={styles.step} key={i}>
                    <strong>{step.face_rent_monthly !== undefined && step.face_rent_monthly !== null ? `${fmt(step.face_rent_monthly)} 元/㎡/月` : step.monthly_total_rent != null ? `${fmt(step.monthly_total_rent)} 元/月（总租金）` : '租金未录入'}</strong>
                    <span>{step.start || '日期未知'} — {step.end || '日期未知'}</span>
                    {step.area_sqm != null && <span>该阶段面积 {fmt(step.area_sqm)}㎡</span>}
                  </div>) : <p className={styles.none}>原图未列明租金阶段</p>}
                  <div className={styles.field}><label htmlFor="sp-notes">备注 / 待核验事项</label><textarea id="sp-notes" rows={5} value={edit.notes} onChange={e => setEdit(v => ({ ...v, notes: e.target.value }))}/></div>
                  <button type="button" onClick={() => void save()} disabled={saving} className={styles.save}><Save size={15}/>{saving ? '正在保存…' : '保存草稿修改'}</button>
                  <p className={styles.detailHint}>采用期望版本校验，成功保存保留前后快照。来源日期已记录；空间事实仍须逐项核验后方可认定为正式记录。</p>
                </> : <>
                  <div className={styles.eyebrow}>BUILDING OVERVIEW</div>
                  <div className={styles.placeholderIcon}><Building2 size={30}/></div>
                  <h2>{tower?.display_name ?? '楼宇'}租赁详情</h2>
                  <p className={styles.detailHint}>在左侧选择任意楼层色块，查看租户、面积、阶梯租金和备注；Admin 可更正草稿并保留审计记录。</p>
                  <div className={styles.infoLine}><span>资料来源</span><strong>{source?.title ?? '暂无'}</strong></div>
                  <div className={styles.infoLine}><span>数据截至日期</span><strong>{source?.source_as_of ?? '待确认'}</strong></div>
                  <div className={styles.infoLine}><span>当前状态</span><strong>仅内部草稿</strong></div>
                  <a href="/map" className={styles.returnLink}>返回地图 <ChevronRight size={14}/></a>
                </>}
              </aside>
            </div>
          </>
        )}
        {error && payload && <p className={styles.notification} role="status">{error}</p>}
      </div>
    </main>
  );
}
