'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft, FileImage } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Dialog } from '@/src/components/ui/Dialog';
import { MATERIAL_PAGE_SIZE, type AvailabilityRow, type MaterialAccess, type MaterialCategory, type SalesMaterial } from '@/src/lib/sales-materials/model';
import { currentMaterials, materialCategories } from '@/src/lib/sales-materials/catalog';
import { formatSourceTime, rowAsOf } from '@/src/lib/sales-materials/timing';
import { salesMaterialReader, type SalesMaterialReader } from '@/src/services/salesMaterialsClient';
import SalesMaterialViewer from './SalesMaterialViewer';
import SalesMaterialDetails from './SalesMaterialDetails';
import SalesCommissionPolicies from './SalesCommissionPolicies';
import SalesProjectFacts from './SalesProjectFacts';
import SalesMaterialTiming from './SalesMaterialTiming';
import styles from './SalesMaterials.module.css';

const EMPTY:SalesMaterial[]=[];
const tabs = [{key:'availability',label:'房源'}, {key:'commission',label:'佣金政策'}, {key:'brochure',label:'项目资料'}] as const;
type Entry = {material:SalesMaterial;access:MaterialAccess};
function dateLabel(entry:Entry) {
  if (entry.material.historical_context) return `历史资料 · ${entry.material.historical_context.period_label}`;
  const dates = entry.access.details.map(row=>rowAsOf(row,entry.material,entry.access.provenance));
  const shared = dates.length && dates.every(event=>event?.value === dates[0]?.value) ? dates[0]?.value : null;
  if (dates.length && dates.some(event=>event?.value !== dates[0]?.value)) return '数据日期见各房源';
  const value = dates.length ? shared : entry.access.provenance.as_of?.value;
  if (value) return `数据截至 ${value.length === 10 ? value.replaceAll('-','.') : formatSourceTime(value)}`;
  if (dates.some(Boolean)) return '数据日期见各房源';
  return entry.material.document_date ? `资料日期 ${entry.material.document_date.replaceAll('-','.')}` : '业主日期未注明';
}

function SharedTiming({entry, availability, onViewOriginal}:{entry:Entry;availability:boolean;onViewOriginal?:()=>void}) {
  const groups = new Map<string, AvailabilityRow[]>();
  if (availability) for (const row of entry.access.details) {
    const key=JSON.stringify([rowAsOf(row,entry.material,entry.access.provenance),row.timing?.confirmed || null]);
    const group=groups.get(key);
    if(group)group.push(row);else groups.set(key,[row]);
  }
  const rows = [...groups.values()];
  return <>{rows.length ? rows.map((group,index)=><div key={index}>
    {rows.length>1 ? <h4 className={styles.timingGroup}>{group.map(row=>row.floor_unit).join('、')}</h4> : null}
    <SalesMaterialTiming row={group[0]} material={entry.material} provenance={entry.access.provenance} sourceRef={group.map(row=>row.source_row_ref || row.floor_unit).join('；')} onViewOriginal={onViewOriginal}/>
  </div>) : <SalesMaterialTiming material={entry.material} provenance={entry.access.provenance} onViewOriginal={onViewOriginal}/>}</>;
}

export default function SalesMaterialsPanel({ buildingId, buildingName, onClose, reader = salesMaterialReader }: {
  buildingId:string;buildingName:string;onClose:()=>void;reader?:SalesMaterialReader;
}) {
  const [reload,setReload]=useState(0);
  const [catalog,setCatalog]=useState<{key:string;records:SalesMaterial[];error:string}|null>(null);
  const [requested,setRequested]=useState<MaterialCategory|null>(null);
  const [historyId,setHistoryId]=useState('');
  const [original,setOriginal]=useState<{id:string;page?:number}|null>(null);
  const [timingOpen,setTimingOpen]=useState(false);
  const timingId=useId();
  const [refresh,setRefresh]=useState(0);
  const [resource,setResource]=useState<{key:string;entries:Entry[];error:string}|null>(null);
  const listKey=`${buildingId}:${reload}`;
  const records=catalog?.key===listKey ? catalog.records : EMPTY;
  const category=requested || tabs.find(tab=>records.some(record=>materialCategories(record).includes(tab.key)))?.key || 'availability';
  const targets=useMemo(()=>{
    const selected=original?.id || historyId;
    return selected ? records.filter(record=>record.id===selected) : currentMaterials(records,category);
  },[records,original?.id,historyId,category]);
  const accessKey=`${buildingId}:${targets.map(item=>item.id).join(',')}:${refresh}`;
  const entries=resource?.key===accessKey ? resource.entries : [];
  const first=entries[0];
  const error=(catalog?.key===listKey ? catalog.error : '') || (resource?.key===accessKey ? resource.error : '');
  const loading=catalog?.key!==listKey || (targets.length>0 && resource?.key!==accessKey);

  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      const firstPage=await reader.list(buildingId,0,controller.signal);
      if(firstPage.count>3000)throw new Error('资料版本过多，请联系管理员整理归档');
      const all=[...firstPage.records];
      for(let page=1;page*MATERIAL_PAGE_SIZE<firstPage.count;page++){
        const next=await reader.list(buildingId,page,controller.signal);all.push(...next.records);
      }
      if(!controller.signal.aborted)setCatalog({key:listKey,records:[...new Map(all.map(item=>[item.id,item])).values()],error:''});
    })().catch(failure=>{if(!controller.signal.aborted)setCatalog({key:listKey,records:[],error:failure instanceof Error?failure.message:'读取失败'});});
    return()=>controller.abort();
  },[buildingId,listKey,reader]);

  useEffect(()=>{
    if(!targets.length)return;
    const controller=new AbortController();
    void Promise.all(targets.map(async material=>({material,access:await reader.access(buildingId,material.id,controller.signal)}))).then(value=>{
      if(!controller.signal.aborted)setResource({key:accessKey,entries:value,error:''});
    }).catch(failure=>{if(!controller.signal.aborted)setResource({key:accessKey,entries:[],error:failure instanceof Error?failure.message:'读取失败'});});
    return()=>controller.abort();
  },[buildingId,accessKey,reader,targets]);

  useEffect(()=>{
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setRefresh(value=>value+1);},240_000);
    const visible=()=>{if(document.visibilityState==='visible')setRefresh(value=>value+1);};
    document.addEventListener('visibilitychange',visible);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);

  const showOriginal=(material:SalesMaterial,page?:number)=>{setTimingOpen(false);setOriginal({id:material.id,page});};
  const originalPage=first && category==='commission' ? Number(first.access.commission_policies?.[0]?.source_ref.match(/PDF第(\d+)页/)?.[1]) || undefined : undefined;
  const categoryRecords=records.filter(record=>materialCategories(record).includes(category));
  const manyTypes=records.some(record=>materialCategories(record).some(kind=>kind!=='availability'));
  const backLabel=category==='commission'?'返回佣金政策':category==='brochure'?'返回项目资料':'返回房源';
  const headerDate=first && entries.every(entry=>dateLabel(entry)===dateLabel(first))?dateLabel(first):'数据日期见各份资料';
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}} title={<span className={styles.title}>{buildingName}</span>} size="xl" layer="map" closeLabel="关闭销控">
    <div data-sales-materials>
      <div className={styles.toolbar}>
        <div className={styles.source}>{first ? <><span>{entries.length===1?first.material.source:`${entries.length}份资料`}</span>{!original ? <button type="button" className={`${styles.sourceDate} ${styles.sourceDateButton}`} data-unknown={headerDate==='业主日期未注明'} title="查看时间依据" aria-expanded={timingOpen} aria-controls={timingOpen?timingId:undefined} onClick={()=>setTimingOpen(value=>!value)}>{headerDate}</button> : <span className={styles.sourceDate} data-unknown={headerDate==='业主日期未注明'}>{headerDate}</span>}</> : null}</div>
        {first && (original || first.access.preview_url) ? <button type="button" className={styles.originalButton} onClick={()=>original?setOriginal(null):showOriginal(first.material,originalPage)}>{original?<ArrowLeft size={14}/>:<FileImage size={14}/>} {original?backLabel:'查看原件'}</button> : null}
      </div>
      {timingOpen && !original ? <div id={timingId} className={styles.sharedTiming} aria-label="资料时间依据">{entries.map(entry=><SharedTiming key={entry.material.id} entry={entry} availability={category==='availability'} onViewOriginal={entry.access.preview_url ? ()=>showOriginal(entry.material) : undefined}/>)}</div> : null}
      {manyTypes && !original ? <nav className={styles.tabs} aria-label="楼宇资料类型">{tabs.filter(tab=>tab.key!=='brochure'||records.some(record=>materialCategories(record).includes('brochure'))).map(tab=><button key={tab.key} type="button" aria-pressed={category===tab.key} onClick={()=>{setRequested(tab.key);setHistoryId('');setTimingOpen(false);}}>{tab.label}</button>)}</nav> : null}
      {(original?records:categoryRecords).length>1 ? <div className={styles.versionRow}>
        <select aria-label="资料版本" value={original?.id || historyId} onChange={event=>{if(original)setOriginal({id:event.target.value});else setHistoryId(event.target.value);}}>
          {!original ? <option value="">最新与历史资料</option> : null}
          {(original?records:categoryRecords).map(record=><option key={record.id} value={record.id}>{record.scope_label || record.title} · {record.historical_context?`历史 ${record.historical_context.period_label}`:record.data_date?`数据 ${record.data_date}`:record.document_date?`资料 ${record.document_date}`:`收录 ${new Date(record.created_at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}`} · {record.title}</option>)}
        </select>
      </div> : null}
      {error ? <div role="alert" className={styles.empty}>{error}<Button variant="ghost" size="sm" onClick={()=>{setReload(value=>value+1);setRefresh(value=>value+1);}}>重试</Button></div>
        : loading ? <p role="status" className={styles.empty}>加载中…</p>
        : !records.length ? <p className={styles.empty}>暂无销控资料</p>
        : !entries.length ? <p className={styles.empty}>{category==='commission'?'暂无佣金政策':category==='brochure'?'暂无项目资料':'暂无房源资料'}</p>
        : original && first ? <SalesMaterialViewer key={`${first.material.id}:${original.page || 1}`} material={first.material} access={original.page && first.material.mime_type==='application/pdf' && first.access.preview_url?{...first.access,preview_url:`${first.access.preview_url}#page=${original.page}`} : first.access} onRetry={()=>setRefresh(value=>value+1)}/>
        : entries.map(entry=><section key={entry.material.id} className={styles.materialSection} aria-label={entry.material.scope_label || entry.material.title}>
          {entries.length>1 ? <div className={styles.sectionHeader}><h3>{entry.material.scope_label || entry.material.title}</h3>{headerDate!==dateLabel(entry) ? <span>{dateLabel(entry)}</span> : null}{entry.access.preview_url ? <button type="button" onClick={()=>showOriginal(entry.material)}>查看原件</button> : null}</div> : null}
          {entry.material.historical_context ? <p className={styles.historyNote}>历史参考 · {entry.material.historical_context.period_label}。当前适用条件请向业主确认。</p> : null}
          {entry.material.association_status==='unconfirmed' ? <p className={styles.associationNote}><strong>楼宇归属未确认</strong></p> : null}
          {category==='availability' ? <SalesMaterialDetails rows={entry.access.details} material={entry.material} provenance={entry.access.provenance} onViewOriginal={()=>showOriginal(entry.material)}/>
            : category==='commission' ? <SalesCommissionPolicies policies={entry.access.commission_policies || []} historical={!!entry.material.historical_context}/>
            : <SalesProjectFacts facts={entry.access.project_facts || []} showSources={!entry.access.preview_url}/>}
        </section>)}
    </div>
  </Dialog>;
}
