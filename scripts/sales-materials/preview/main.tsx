import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Minus, Plus } from 'lucide-react';
import { MapSalesMaterialsBridge } from '@/src/app/map/MapSalesMaterialsBridge';
import type { SalesMaterialReader } from '@/src/services/salesMaterialsClient';
import '@/src/app/globals.css';

type Building = { id: string; name: string; longitude: number; latitude: number; material_count: number };
type Feature = { properties: { building_id: string; building_name: string; point_lng: number; point_lat: number }; geometry: { type: string; coordinates: number[][][] } };
type MapData = { footprints: { features: Feature[] }; subways: { name: string; path: number[][] }[] };
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url,{cache:'no-store',signal});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '读取失败');
  return body;
}
const reader: SalesMaterialReader = {
  list: (building,page,signal) => json(`/api/local/sales-materials?${new URLSearchParams({building_id:building,page:String(page)})}`,signal),
  access: (building,material,signal) => json(`/api/local/sales-materials?${new URLSearchParams({building_id:building,material_id:material})}`,signal),
};

function LocalMap() {
  const [buildings,setBuildings] = useState<Building[]>([]);
  const [map,setMap] = useState<MapData | null>(null);
  const [selected,setSelected] = useState<Building | null>(null);
  const [scale,setScale] = useState(24000);
  const [error,setError] = useState('');
  useEffect(()=>{
    const controller=new AbortController();
    void Promise.all([json<{buildings:Building[]}>('/api/local/buildings',controller.signal),json<MapData>('/api/local/map',controller.signal)]).then(([data,geometry])=>{
      if (controller.signal.aborted) return;
      setBuildings(data.buildings);setSelected(data.buildings.find(building=>building.id===new URLSearchParams(window.location.search).get('building')) || data.buildings[0] || null);setMap(geometry);
    }).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[]);
  const center = selected || buildings[0];
  const xy = ([lng,lat]:number[]) => [720+(lng-(center?.longitude ??116.406354))*scale,420-(lat-(center?.latitude??39.979452))*scale*1.3];
  const points = (coordinates:number[][]) => coordinates.map(point=>xy(point).join(',')).join(' ');
  const nearby = map?.footprints.features.filter(feature=>Math.abs(feature.properties.point_lng-(center?.longitude??0))<0.035 && Math.abs(feature.properties.point_lat-(center?.latitude??0))<0.025) || [];
  return <div className="relative h-dvh overflow-hidden bg-[#f4f6f8] text-slate-800">
    <header className="absolute inset-x-0 top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200/70 bg-white px-6"><span className="hidden text-base font-medium tracking-tight sm:block">办公楼地图</span><select aria-label="选择楼宇" className="min-w-0 max-w-[65%] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm sm:max-w-[50%]" value={selected?.id || ''} onChange={event=>setSelected(buildings.find(building=>building.id===event.target.value)||null)}>{buildings.map(building=><option key={building.id} value={building.id}>{building.name}</option>)}</select><span className="shrink-0 text-xs text-slate-400">本地预览</span></header>
    <main className="absolute inset-x-0 bottom-0 top-16" aria-label="楼宇地图">
      <svg viewBox="0 0 1440 840" className="h-full w-full" preserveAspectRatio="xMidYMid slice" aria-label="北京楼宇与地铁地图">
        <rect width="1440" height="840" fill="#f4f6f8" />
        {map?.subways.map(line=><polyline key={line.name} points={points(line.path)} fill="none" stroke="#dfe5ec" strokeWidth="3" />)}
        {nearby.map(feature=><g key={feature.properties.building_id}>
          {feature.geometry.type==='Polygon' && feature.geometry.coordinates.map((polygon,index)=><polygon key={index} points={points(polygon)} fill={feature.properties.building_id===center?.id?'#aec4dc':'#e5eaf0'} stroke="#d3dce7" strokeWidth="1" />)}
          {feature.properties.building_id!==center?.id ? <g transform={`translate(${xy([feature.properties.point_lng,feature.properties.point_lat]).join(',')})`}><circle r="3" fill="#b4bfcd" /><text x="10" y="4" fill="#a1acbb" fontSize="11">{feature.properties.building_name}</text></g>:null}
        </g>)}
        {buildings.map(building=><g key={building.id} transform={`translate(${xy([building.longitude,building.latitude]).join(',')})`} role="button" tabIndex={0} aria-label={building.name} onClick={()=>setSelected(building)} onKeyDown={event=>{if(event.key==='Enter')setSelected(building);}} className="cursor-pointer">
          <circle r="22" fill="#003e7e" fillOpacity="0.07" /><circle r="9" fill="#003e7e" stroke="white" strokeWidth="3" />
        </g>)}
      </svg>
      {selected ? <section className="absolute left-1/2 top-1/2 w-[280px] -translate-x-1/2 -translate-y-[calc(100%+24px)] rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-label={`${selected.name}楼宇信息`}>
        <h1 className="text-base font-medium">{selected.name}</h1>
        <button type="button" data-map-action="building-sales-control" data-building-id={selected.id} data-building-name={selected.name} className="mt-4 w-full rounded-md bg-[#003e7e] py-2 text-sm text-white hover:bg-[#002f61] focus-visible:outline-2 focus-visible:outline-offset-2">楼宇销控</button>
      </section> : error ? <p role="alert" className="absolute inset-x-0 top-1/2 text-center text-sm text-slate-500">{error}</p> : <p className="absolute inset-x-0 top-1/2 text-center text-sm text-slate-400">{map?'暂无已入库资料':'加载中…'}</p>}
      <div className="absolute bottom-6 right-6 flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"><button aria-label="放大地图" className="p-3 hover:bg-slate-50" onClick={()=>setScale(value=>Math.min(value*1.4,100000))}><Plus size={16}/></button><button aria-label="缩小地图" className="border-t border-slate-100 p-3 hover:bg-slate-50" onClick={()=>setScale(value=>Math.max(value/1.4,10000))}><Minus size={16}/></button></div>
    </main>
    <MapSalesMaterialsBridge reader={reader} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<LocalMap />);
