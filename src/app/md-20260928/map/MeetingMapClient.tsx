'use client';

import AMapLoader from '@amap/amap-jsapi-loader';
import * as React from 'react';

type Building = {
  name: string;
  submarket: string;
  grade: string;
  leed: string;
  lng: number;
  lat: number;
  rent: number | null;
  vacancy: number | null;
  area: number | null;
  asking: number | null;
  mgmt: number | null;
  face: number | null;
  free: number | null;
  vacant: number | null;
};

// Frozen meeting point data. Keep only fields read by the markers, filters and detail card.
const BUILDINGS: Building[] = [
  {"name":"嘉里中心","submarket":"CBD","grade":"A","leed":"Platinum","lng":116.45963,"lat":39.914045,"rent":204.44,"vacancy":6.34,"area":80091,"asking":400,"mgmt":43,"face":230,"free":4,"vacant":5077},
  {"name":"金地中心","submarket":"CBD","grade":"A","leed":"Platinum","lng":116.474482,"lat":39.909105,"rent":183.33,"vacancy":13.2,"area":102796,"asking":450,"mgmt":35,"face":220,"free":6,"vacant":13574},
  {"name":"英皇集团中心","submarket":"CBD","grade":"A","leed":"Platinum","lng":116.444738,"lat":39.907772,"rent":225,"vacancy":18.65,"area":47261,"asking":550,"mgmt":37,"face":300,"free":9,"vacant":8814},
  {"name":"中信大厦","submarket":"CBD","grade":"P","leed":"Gold","lng":116.466276,"lat":39.912916,"rent":406.11,"vacancy":6.28,"area":350000,"asking":490,"mgmt":58,"face":430,"free":2,"vacant":21965},
  {"name":"中海广场","submarket":"CBD","grade":"A","leed":"Platinum","lng":116.45642,"lat":39.910934,"rent":179.11,"vacancy":12.44,"area":83000,"asking":320,"mgmt":32,"face":208,"free":5,"vacant":10324},
  {"name":"远洋国际中心A座","submarket":"CBD","grade":"A","leed":"Platinum","lng":116.49162,"lat":39.914782,"rent":141.67,"vacancy":16.41,"area":85300,"asking":240,"mgmt":30,"face":170,"free":6,"vacant":14000},
  {"name":"万通中心D座","submarket":"CBD","grade":"A","leed":"Gold","lng":116.456973,"lat":39.919557,"rent":177.78,"vacancy":8.16,"area":33305,"asking":290,"mgmt":28,"face":200,"free":4,"vacant":2718},
  {"name":"WWT世界财富大厦","submarket":"CBD","grade":"A","leed":"Platinum","lng":116.456769,"lat":39.907882,"rent":174.17,"vacancy":27.61,"area":95000,"asking":240,"mgmt":33,"face":190,"free":3,"vacant":26225},
  {"name":"三星大厦（中区+低区）","submarket":"CBD","grade":"P","leed":"Platinum","lng":116.464627,"lat":39.912332,"rent":183.33,"vacancy":22.91,"area":65000,"asking":520,"mgmt":38,"face":220,"free":6,"vacant":14892},
  {"name":"世纪财富中心西塔","submarket":"CBD","grade":"A","leed":"Gold","lng":116.455983,"lat":39.914081,"rent":191.67,"vacancy":25.46,"area":49200,"asking":360,"mgmt":36,"face":230,"free":6,"vacant":12526},
  {"name":"PICC大厦","submarket":"CBD","grade":"A","leed":"None","lng":116.460321,"lat":39.906941,"rent":null,"vacancy":null,"area":26000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"中环世贸中心D座","submarket":"CBD","grade":"A","leed":"None","lng":116.456758,"lat":39.907509,"rent":null,"vacancy":null,"area":46720,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"光华路SOHOII","submarket":"CBD","grade":"B","leed":"None","lng":116.452111,"lat":39.913933,"rent":null,"vacancy":null,"area":60000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"世贸天阶","submarket":"CBD","grade":"B","leed":"None","lng":116.451954,"lat":39.916417,"rent":null,"vacancy":null,"area":21000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"京广中心","submarket":"CBD","grade":"B","leed":"None","lng":116.460649,"lat":39.920494,"rent":null,"vacancy":null,"area":25000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"京汇大厦","submarket":"CBD","grade":"B","leed":"None","lng":116.46331,"lat":39.906822,"rent":null,"vacancy":null,"area":41000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"以太广场一期（B座）","submarket":"CBD","grade":"A","leed":"None","lng":116.456907,"lat":39.915569,"rent":null,"vacancy":null,"area":38000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"佳兆业广场北塔","submarket":"CBD","grade":"B","leed":"None","lng":116.479032,"lat":39.907259,"rent":null,"vacancy":null,"area":75000,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"CBD国际大厦","submarket":"CBD","grade":"B","leed":"None","lng":116.452008,"lat":39.904636,"rent":null,"vacancy":null,"area":56250,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"国贸写字楼2座","submarket":"CBD","grade":"A","leed":"None","lng":116.460469,"lat":39.910838,"rent":null,"vacancy":null,"area":null,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
  {"name":"国贸大厦A座(三期)","submarket":"CBD","grade":"A","leed":"None","lng":116.458154,"lat":39.912298,"rent":null,"vacancy":null,"area":null,"asking":null,"mgmt":null,"face":null,"free":null,"vacant":null},
];
const SERVICE_HOST = 'https://www.colliersdata.com/md-20260928/_AMapService';

type Mode = 'project' | 'rent' | 'vacancy' | 'leed';

type MeetingCommand =
  | { type: 'colliers-map-command'; command: 'mode'; value: Mode }
  | { type: 'colliers-map-command'; command: 'search'; value: string }
  | { type: 'colliers-map-command'; command: 'focus'; value: string }
  | { type: 'colliers-map-command'; command: 'filter'; value: { grades?: string[]; leeds?: string[]; field?: string; op?: string; value?: number | null } }
  | { type: 'colliers-map-command'; command: 'reset' };

function colorFor(building: Building, mode: Mode) {
  if (mode === 'rent') {
    if (!Number.isFinite(building.rent)) return '#94a3b8';
    const value = Number(building.rent);
    return value >= 300 ? '#ef4444' : value >= 200 ? '#f97316' : value >= 100 ? '#f59e0b' : '#10b981';
  }
  if (mode === 'vacancy') {
    if (!Number.isFinite(building.vacancy)) return '#94a3b8';
    const value = Number(building.vacancy);
    return value >= 30 ? '#ef4444' : value >= 20 ? '#f97316' : value >= 10 ? '#f59e0b' : '#10b981';
  }
  if (mode === 'leed') {
    if (building.leed === 'Platinum') return '#38bdf8';
    if (building.leed === 'Gold') return '#fbbf24';
    return '#94a3b8';
  }
  if (building.grade === 'P') return '#003e7e';
  if (building.grade === 'A') return '#2563a8';
  if (building.grade === 'B') return '#059669';
  return '#94a3b8';
}

function markerText(building: Building, mode: Mode) {
  if (mode === 'rent') return Number.isFinite(building.rent) ? String(Math.round(Number(building.rent))) : '-';
  if (mode === 'vacancy') return Number.isFinite(building.vacancy) ? `${Math.round(Number(building.vacancy))}%` : '-';
  if (mode === 'leed') return building.leed === 'Platinum' ? 'P' : building.leed === 'Gold' ? 'G' : 'N';
  return building.grade === 'P' ? 'P' : building.grade === 'A' ? 'A' : building.grade === 'B' ? 'B' : 'U';
}

function markerHtml(building: Building, mode: Mode) {
  const color = colorFor(building, mode);
  const label = markerText(building, mode);
  const fontSize = mode === 'project' ? '12px' : label.length > 2 ? '9px' : '10px';
  return `<div data-md-building="${building.name.replaceAll('"', '&quot;')}" style="width:27px;height:27px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:${fontSize};cursor:pointer;transition:transform .15s">${label}</div>`;
}

function formatNumber(value: number | null, suffix = '') {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix}`;
}

function infoHtml(building: Building) {
  return `<div style="width:330px;max-width:calc(100vw - 60px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:#fff;padding:4px">
    <div style="display:flex;align-items:start;justify-content:space-between;border-bottom:2px solid #003e7e;padding:2px 2px 9px;margin-bottom:8px">
      <div><div style="font-size:16px;font-weight:800;color:#172033">${building.name}</div><div style="font-size:10px;color:#8090a0;margin-top:3px">${building.submarket} · ${building.grade === 'P' ? 'P级' : building.grade === 'A' ? 'A级' : 'B级'} · ${building.leed === 'None' ? '无 LEED' : `LEED ${building.leed}`}</div></div>
      <span style="font-size:9px;color:#16855b;background:#eef8f3;border:1px solid #d0e9dc;padding:3px 6px;border-radius:4px">冻结快照</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 15px">
      <div style="font-size:11px;color:#64748b;padding:5px 0;border-bottom:1px solid #eef1f4">净有效租金 <b style="float:right;color:#003e7e">${formatNumber(building.rent)}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0;border-bottom:1px solid #eef1f4">空置率 <b style="float:right;color:#172033">${formatNumber(building.vacancy, '%')}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0;border-bottom:1px solid #eef1f4">报价 <b style="float:right;color:#172033">${formatNumber(building.asking)}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0;border-bottom:1px solid #eef1f4">物业费 <b style="float:right;color:#172033">${formatNumber(building.mgmt)}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0;border-bottom:1px solid #eef1f4">表面租金 <b style="float:right;color:#172033">${formatNumber(building.face)}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0;border-bottom:1px solid #eef1f4">免租期 <b style="float:right;color:#172033">${formatNumber(building.free, '个月')}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0">总面积 <b style="float:right;color:#172033">${formatNumber(building.area, '㎡')}</b></div>
      <div style="font-size:11px;color:#64748b;padding:5px 0">空置面积 <b style="float:right;color:#172033">${formatNumber(building.vacant, '㎡')}</b></div>
    </div>
    <div style="margin-top:9px;padding:7px 9px;background:#f5f8fb;border-left:3px solid #003e7e;font-size:10px;color:#536477">会议页只展示冻结事实；实时可租单元与交付日期仍不在当前数据底座中。</div>
  </div>`;
}

export default function MeetingMapClient() {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const amapRef = React.useRef<any>(null);
  const overlaysRef = React.useRef<any[]>([]);
  const infoRef = React.useRef<any>(null);
  const [mode, setMode] = React.useState<Mode>('project');
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<any>(null);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');

  const visibleBuildings = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return BUILDINGS.filter(building => {
      if (q && !building.name.toLowerCase().includes(q) && !building.submarket.toLowerCase().includes(q)) return false;
      if (filter?.grades?.length && !filter.grades.includes(building.grade)) return false;
      if (filter?.leeds?.length && !filter.leeds.includes(building.leed)) return false;
      if (filter?.field && filter?.value !== null && filter?.value !== undefined) {
        const metric = filter.field === 'rent' ? building.rent : filter.field === 'vacancy' ? building.vacancy : building.area;
        if (!Number.isFinite(metric)) return false;
        if (filter.op === '>=' && Number(metric) < Number(filter.value)) return false;
        if (filter.op !== '>=' && Number(metric) > Number(filter.value)) return false;
      }
      return true;
    });
  }, [query, filter]);

  const renderOverlays = React.useCallback((fit = false) => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap) return;
    if (overlaysRef.current.length) map.remove(overlaysRef.current);
    overlaysRef.current = [];
    try { infoRef.current?.close(); } catch {}

    const overlays = visibleBuildings.map(building => {
      const marker = new AMap.Marker({
        position: [building.lng, building.lat],
        content: markerHtml(building, mode),
        offset: new AMap.Pixel(-13.5, -13.5),
        zIndex: 100,
        extData: building,
      });
      marker.on('click', () => {
        const info = new AMap.InfoWindow({ isCustom: false, offset: new AMap.Pixel(0, -34), autoMove: true, content: infoHtml(building) });
        infoRef.current = info;
        info.open(map, [building.lng, building.lat]);
        window.parent?.postMessage({ type: 'colliers-map-selected', building: building.name }, '*');
      });
      return marker;
    });
    if (overlays.length) map.add(overlays);
    overlaysRef.current = overlays;
    if (fit && overlays.length) {
      try { map.setFitView(overlays, false, [60, 60, 60, 60], 16); } catch {}
    }
  }, [mode, visibleBuildings]);

  React.useEffect(() => {
    let cancelled = false;
    (window as any)._AMapSecurityConfig = { serviceHost: SERVICE_HOST };
    const key = process.env.NEXT_PUBLIC_AMAP_KEY?.trim();
    if (!key) {
      setStatus('error');
      window.parent?.postMessage({ type: 'colliers-map-error', reason: 'missing-key' }, '*');
      return;
    }

    AMapLoader.load({ key, version: '2.0', plugins: ['AMap.Scale', 'AMap.InfoWindow'] })
      .then((AMap: any) => {
        if (cancelled || !containerRef.current) return;
        amapRef.current = AMap;
        const map = new AMap.Map(containerRef.current, {
          zoom: 14.4,
          center: [116.4635, 39.9125],
          viewMode: '2D',
          mapStyle: 'amap://styles/whitesmoke',
          showLabel: true,
          features: ['bg', 'road', 'building', 'point'],
          resizeEnable: true,
          rotateEnable: false,
          pitchEnable: false,
          scrollWheel: true,
          keyboardEnable: true,
        });
        map.addControl(new AMap.Scale({ position: 'RB' }));
        mapRef.current = map;
        setStatus('ready');
        window.parent?.postMessage({ type: 'colliers-map-ready' }, '*');
      })
      .catch(error => {
        console.error('[MeetingMap] AMap initialization failed', error);
        if (!cancelled) {
          setStatus('error');
          window.parent?.postMessage({ type: 'colliers-map-error', reason: 'amap-load' }, '*');
        }
      });

    return () => {
      cancelled = true;
      try { mapRef.current?.destroy?.(); } catch {}
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (status === 'ready') renderOverlays(true);
  }, [status, renderOverlays]);

  React.useEffect(() => {
    const handler = (event: MessageEvent<MeetingCommand>) => {
      const data = event.data;
      if (!data || data.type !== 'colliers-map-command') return;
      if (data.command === 'mode') setMode(data.value);
      else if (data.command === 'search') setQuery(data.value || '');
      else if (data.command === 'filter') setFilter(data.value || null);
      else if (data.command === 'reset') { setQuery(''); setFilter(null); setMode('project'); }
      else if (data.command === 'focus') {
        const building = BUILDINGS.find(item => item.name === data.value);
        if (building && mapRef.current) mapRef.current.setZoomAndCenter(16, [building.lng, building.lat], false, 260);
      }
    };
    window.addEventListener('message', handler as EventListener);
    return () => window.removeEventListener('message', handler as EventListener);
  }, []);

  return <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#eef2f5' }}>
    <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    {status !== 'ready' ? <div style={{ position: 'absolute', left: 14, top: 14, zIndex: 20, border: '1px solid #d7e0e8', background: 'rgba(255,255,255,.95)', padding: '7px 10px', borderRadius: 5, color: status === 'error' ? '#8f6200' : '#607184', fontSize: 11, boxShadow: '0 2px 8px rgba(23,32,51,.08)' }}>{status === 'error' ? '高德地图暂不可用' : '正在加载高德地图…'}</div> : null}
    <div style={{ position: 'absolute', right: 8, bottom: 4, zIndex: 20, color: '#88939e', background: 'rgba(255,255,255,.82)', padding: '2px 5px', borderRadius: 3, fontSize: 9, pointerEvents: 'none' }}>MD Meeting · 冻结业务数据</div>
  </div>;
}
