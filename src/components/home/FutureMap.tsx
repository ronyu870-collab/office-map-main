'use client';
import * as React from 'react';
import {Button} from '@/src/components/ui/Button';
import type {ResultChart} from '@/src/lib/intelligence/query/charts';
import {fitMap,mapGeometry,moveMap,projectMap,mapCaveat,mapBaseNote,type MapBase,type MapViewport} from '@/src/lib/intelligence/query/future/map';
import {mapBaseDescriptor} from '@/src/lib/intelligence/query/future/mapBaseDescriptor';
import type {QueryClientScope} from '@/src/services/trustedQueryClient';
import {useQueryPresentationReceipt} from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';

type Props={chart:ResultChart;scope:QueryClientScope;onSource:(ids:readonly string[],label:string,trigger:HTMLButtonElement)=>void};
export function FutureMap({chart,scope,onSource}:Props){
 const [base,setBase]=React.useState<MapBase|null>(null),[baseStatus,setBaseStatus]=React.useState<'loading'|'ready'|'error'>('loading'),[retry,setRetry]=React.useState(0);
 const [width,setWidth]=React.useState(640),height=360,container=React.useRef<HTMLDivElement>(null);
 const [customView,setView]=React.useState<MapViewport|null>(null),[selected,setSelected]=React.useState<number[]|null>(null),[page,setPage]=React.useState(0);
 const [moving,setMoving]=React.useState(false);
 const baseSha=chart.mapBase?.sha256;
 const drag=React.useRef<{id:number;x:number;y:number;view:MapViewport}|null>(null),dragged=React.useRef(false);
 React.useEffect(()=>{const target=container.current;if(!target)return;const resize=()=>setWidth(Math.max(64,Math.min(4096,Math.round(target.clientWidth))));resize();const observer=new ResizeObserver(resize);observer.observe(target);return()=>observer.disconnect();},[]);
 React.useEffect(()=>{
  const controller=new AbortController();
  void (async()=>{try{
   if(baseSha!==mapBaseDescriptor.sha256)throw Error();
   const response=await fetch(mapBaseDescriptor.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),credentials:'omit',redirect:'error'});
   if(!response.ok)throw Error();const raw=await response.text();if(raw.length>300000)throw Error();const data=JSON.parse(raw);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==mapBaseDescriptor.sha256)throw Error();if(!controller.signal.aborted){setBase(data as MapBase);setBaseStatus('ready');}
  }catch{if(!controller.signal.aborted)setBaseStatus('error');}})();return()=>controller.abort();
 },[baseSha,retry]);
 const view=customView??fitMap(chart,width,height),geometry=view?mapGeometry(chart,base,view,width,height):null;
 const indices=selected??chart.points.map((_,i)=>i),shown=indices.slice(page*25,(page+1)*25);
 useQueryPresentationReceipt(scope,chart,moving?null:{surface:'map',page,pageSize:25,viewport:view,width,height,selectedIndices:selected,baseStatus});
 function reset(){setView(null);setSelected(null);setPage(0);}
 function select(indices:number[]){if(dragged.current)return;setSelected([...indices].sort((a,b)=>a-b));setPage(0);}
 function shift(dx:number,dy:number){if(view)setView(moveMap(view,dx*view.span,dy*view.span));}
 return <div className={styles.mapContent}>
  <p className={styles.notice}>{mapCaveat}</p>
  <div className={styles.actions} aria-label="地图操作">
   <Button variant="ghost" disabled={!view} onClick={()=>view&&setView(moveMap(view,0,0,0.5))}>放大地图</Button>
   <Button variant="ghost" disabled={!view} onClick={()=>view&&setView(moveMap(view,0,0,2))}>缩小地图</Button>
   <Button variant="ghost" onClick={reset}>显示全部点位</Button>
  </div>
  <div className={styles.queryMap} ref={container}>
   {geometry&&view?<svg width="100%" height={height} tabIndex={0} role="group" aria-label="未来供应位置图，可拖动；方向键平移，加减号缩放，Home显示全部"
    onKeyDown={e=>{if(e.target!==e.currentTarget)return;const key=e.key;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','=','Home'].includes(key))e.preventDefault();
     if(key==='ArrowLeft')shift(-0.2,0);if(key==='ArrowRight')shift(0.2,0);if(key==='ArrowUp')shift(0,-0.2);if(key==='ArrowDown')shift(0,0.2);
     if(key==='+'||key==='=')setView(moveMap(view,0,0,0.5));if(key==='-')setView(moveMap(view,0,0,2));if(key==='Home')reset();}}
    onPointerDown={e=>{if(e.button!==0)return;dragged.current=false;if((e.target as Element).closest('[role=button]'))return;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,view};setMoving(true);e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>5){dragged.current=true;setView(moveMap(d.view,-dx/width*d.view.span,-dy/width*d.view.span));}}}
    onPointerUp={()=>{drag.current=null;setMoving(false);}} onPointerCancel={()=>{drag.current=null;setMoving(false);}} onLostPointerCapture={()=>{drag.current=null;setMoving(false);}}>
    <g pointerEvents="none">{geometry.paths.map((p,i)=><path key={i} d={p.d} fill="none" stroke={p.kind==='district'?'#c5ced8':'#dce4ec'} strokeWidth={p.kind==='district'?1:2}/>)}
     {geometry.labels.map((l,i)=><text key={i} x={l.x} y={l.y} fill="#667085">{l.name}</text>)}
    </g>
    {geometry.groups.map(g=><g key={g.indices.join(',')} role="button" tabIndex={0} aria-label={`查看此处 ${g.indices.length} 条记录`} aria-pressed={selected?.join(',')===g.indices.join(',')}
     onClick={()=>select(g.indices)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();dragged.current=false;select(g.indices);}}}>
     <circle cx={g.x} cy={g.y} r="22" fill="transparent"/>
     <circle cx={g.x} cy={g.y} r="16" fill="#003e7e"/><text x={g.x} y={g.y+5} textAnchor="middle" fill="white">{g.indices.length}</text>
    </g>)}
   </svg>:<p className={styles.notice}>没有可显示的原坐标；未知记录保留在下方。</p>}
  </div>
  <p className={styles.notice}>{baseStatus==='loading'?'正在加载本地参照底图…':baseStatus==='error'?'底图未加载或校验失败；点位仅按原坐标相对展示，坐标与来源仍可查看。':mapBaseNote}</p>
  {baseStatus==='error'&&<Button variant="ghost" onClick={()=>{setBaseStatus('loading');setBase(null);setRetry(r=>r+1);}}>重试底图</Button>}
  <div className={styles.tableFooter}><p>{selected?`所选点位共 ${indices.length} 条记录`:`本次查询共 ${indices.length} 条记录，含坐标未知项`}；地图分组数字为记录数。</p>{selected&&<Button variant="ghost" onClick={()=>{setSelected(null);setPage(0);}}>查看全部记录</Button>}</div>
  <ul className={styles.mapRecords}>{shown.map(i=>{const p=chart.points[i];return <li key={p.yCell.entityId}><div><span>{p.label}</span><button type="button" className={styles.cell} onClick={e=>onSource(p.yCell.sourceIds,`${p.label}：${p.yText}`,e.currentTarget)}>{p.yText} · 查看来源</button></div>
   {p.state==='valid'&&<Button variant="ghost" onClick={()=>{const pos=projectMap(p.x as number,p.y!);setView({cx:pos.x,cy:pos.y,span:0.04});}}>定位</Button>}</li>;})}</ul>
  {indices.length>25&&<div className={styles.tableFooter}><p>明细第 {page*25+1}–{Math.min((page+1)*25,indices.length)} 条，共 {indices.length} 条。</p><div className={styles.actions}><Button variant="ghost" disabled={page===0} onClick={()=>setPage(p=>p-1)}>上一页地图明细</Button><Button variant="ghost" disabled={(page+1)*25>=indices.length} onClick={()=>setPage(p=>p+1)}>下一页地图明细</Button></div></div>}
 </div>;
}
