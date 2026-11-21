'use client';

import { downloadSalesMaterial } from '@/src/services/salesMaterialsClient';
import { observeBusinessReading } from '@/src/utils/businessReadingAudit';
import { createReadingContext,type ReadingContext } from '@/src/utils/readingAuditContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Minus, Plus, RotateCcw } from 'lucide-react';
import SalesPdfViewer from './SalesPdfViewer';
import { Button } from '@/src/components/ui/Button';
import { XLSX_MIME, PPTX_MIME, PPTM_MIME, DOCX_MIME, type MaterialAccess, type SalesMaterial } from '@/src/lib/sales-materials/model';

export default function SalesMaterialViewer({ material, access, onRetry, buildingId, context:providedContext }: { material: SalesMaterial; access: MaterialAccess; onRetry: () => void;buildingId:string;context?:ReadingContext }) {
  const context=useMemo(()=>providedContext ?? createReadingContext(),[providedContext]);
  const [zoom, setZoom] = useState(100);
  const [sheetIndex,setSheetIndex] = useState(0);
  const [downloading,setDownloading]=useState(false);
  const [downloadError,setDownloadError]=useState('');
  const [failed, setFailed] = useState(false);
  const lastDisplay=useRef('');
  const observe=useCallback((observation:string,position?:Record<string,unknown>)=>{
    const key=JSON.stringify([material.id,material.created_at,observation,position]);
    if(lastDisplay.current===key)return;lastDisplay.current=key;
    observeBusinessReading('VIEW_MATERIAL_CONTENT','map',{target_table:'building_sales_materials',target_id:material.id,material_id:material.id,building_id:buildingId,version_recorded_at:material.created_at,observation,...position},context);
  },[material.id,material.created_at,buildingId,context]);
  useEffect(()=>{
    if(access.preview_url && material.mime_type===XLSX_MIME && access.workbook_preview?.sheets[sheetIndex])
      observe('displayed',{sheet:sheetIndex+1});
  },[sheetIndex,material.id,material.created_at,material.mime_type,access.workbook_preview,access.preview_url,observe]);
  if (!access.preview_url) return <p className="text-sm">原件已本地归档，暂无在线预览。</p>;
  const downloadOnly = material.mime_type === DOCX_MIME || material.mime_type === PPTX_MIME || material.mime_type === PPTM_MIME;
  return <div>
    <div className="mb-3 flex items-center justify-between gap-3 text-slate-500">
      <div className="flex items-center gap-1">
        {!downloadOnly && material.mime_type !== 'application/pdf' && material.mime_type !== XLSX_MIME ? <>
          <Button size="sm" variant="ghost" aria-label="缩小原件" disabled={zoom <= 50} onClick={() => setZoom(value => Math.max(50, value - 25))}><Minus size={14} /></Button>
          <span className="w-10 text-center text-sm tabular-nums">{zoom}%</span>
          <Button size="sm" variant="ghost" aria-label="放大原件" disabled={zoom >= 300} onClick={() => setZoom(value => Math.min(300, value + 25))}><Plus size={14} /></Button>
          <Button size="sm" variant="ghost" aria-label="适应页面" onClick={() => setZoom(100)}><RotateCcw size={13} /></Button>
        </> : null}
      </div>
      <button type="button" disabled={downloading} className="inline-flex items-center gap-1.5 rounded px-1 py-2 text-sm hover:text-slate-900 focus-visible:outline-2" onClick={async(event)=>{
        event.preventDefault();if(downloading)return;
        setDownloading(true);setDownloadError('');
        try {
          const url=await downloadSalesMaterial(buildingId,material.id,context);
          const link=document.createElement('a');link.href=url;link.click();
        } catch { setDownloadError('下载未完成，请重试'); } finally { setDownloading(false); }
      }}><Download size={14} />{downloading?'正在准备…':'下载原件'}</button>
    </div>
    {downloadError?<p role="alert" className="mb-3 text-sm text-red-700">{downloadError}</p>:null}
    <div className="max-h-[62dvh] overflow-auto rounded bg-slate-50" tabIndex={0} aria-label="原件预览">
      {downloadOnly ? <p className="p-4 text-sm">{material.mime_type === DOCX_MIME ? 'Word 原件可下载查看。' : 'PowerPoint 原件可下载查看。'}</p> : material.mime_type === XLSX_MIME ? <div className="p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span>Excel 内容预览</span>{(access.workbook_preview?.sheets.length || 0)>1 ? <select aria-label="工作表" value={sheetIndex} onChange={event=>{ const sheet=Number(event.target.value);setSheetIndex(sheet); }}>{access.workbook_preview?.sheets.map((sheet,index)=><option key={index} value={index}>{sheet.name}</option>)}</select> : null}</div>{access.workbook_preview?.sheets[sheetIndex] ? <table className="w-full border-collapse bg-white text-left text-sm"><caption className="sr-only">{material.original_name} · {access.workbook_preview.sheets[sheetIndex].name}</caption><tbody>{access.workbook_preview.sheets[sheetIndex].rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column} className="whitespace-pre-wrap border border-slate-200 px-3 py-2">{cell}</td>)}</tr>)}</tbody></table> : <p className="py-8 text-center text-sm text-slate-500">暂无内容预览，可下载原件</p>}</div> : material.mime_type === 'application/pdf' ? <SalesPdfViewer url={access.preview_url} title={material.title} onObservation={(observation,page)=>observe(observation,{page})} /> : failed ? <div role="alert" className="p-8 text-center text-sm text-slate-500">原件加载失败 <Button size="sm" variant="ghost" onClick={() => { setFailed(false); onRetry(); }}>重试</Button></div> : (
        // Private owner original: retain source pixels and signed access.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={access.preview_url} alt={material.title} style={{ width: `${zoom}%`, maxWidth: 'none', ...(zoom === 100 ? { maxHeight: '58dvh', objectFit: 'contain' as const } : {}) }} className="block h-auto" onLoad={()=>observe('displayed')} onError={() => {setFailed(true);observe('failed');}} />
      )}
    </div>
  </div>;
}
