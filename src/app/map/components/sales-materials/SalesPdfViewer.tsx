'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Button } from '@/src/components/ui/Button';

export default function SalesPdfViewer({ url, title }: {url:string; title:string}) {
  const initialPage = Number(url.match(/#page=(\d+)/)?.[1]) || 1;
  const [page,setPage] = useState(initialPage);
  const [zoom,setZoom] = useState(100);
  const [document,setDocument] = useState<PDFDocumentProxy|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(true);
  const [retry,setRetry] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width,setWidth] = useState(900);
  const source = url.split('#')[0];

  useEffect(()=>{
    if(!container.current)return;
    const observer=new ResizeObserver(entries=>setWidth(Math.max(200,entries[0].contentRect.width-24)));
    observer.observe(container.current);
    return()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    let cancelled=false;
    let task:ReturnType<typeof import('pdfjs-dist').getDocument>|undefined;
    void import('pdfjs-dist').then(pdf=>{
      if(cancelled)return;
      const assets=`/vendor/pdfjs/${pdf.version}/`;
      pdf.GlobalWorkerOptions.workerSrc=`${assets}pdf.worker.min.mjs`;
      task=pdf.getDocument({url:source,cMapUrl:`${assets}cmaps/`,cMapPacked:true,standardFontDataUrl:`${assets}standard_fonts/`,wasmUrl:`${assets}wasm/`,enableXfa:false});
      return task.promise;
    }).then(pdf=>{if(pdf&&!cancelled)setDocument(pdf);}).catch(()=>{if(!cancelled){setError('PDF 原件加载失败');setLoading(false);}});
    return()=>{cancelled=true;void task?.destroy();};
  },[source,retry]);

  useEffect(()=>{
    if(!document || !canvas.current)return;
    let cancelled=false;
    let render:RenderTask|undefined;
    setLoading(true);
    void document.getPage(Math.min(page,document.numPages)).then(pdfPage=>{
      if(cancelled || !canvas.current)return;
      const viewport=pdfPage.getViewport({scale:(width*zoom/100)/pdfPage.getViewport({scale:1}).width});
      const pixelRatio=Math.min(window.devicePixelRatio || 1,2);
      const target=canvas.current;
      target.width=Math.ceil(viewport.width*pixelRatio);target.height=Math.ceil(viewport.height*pixelRatio);
      target.style.width=`${viewport.width}px`;target.style.height=`${viewport.height}px`;
      render=pdfPage.render({canvas:target,viewport,transform:pixelRatio===1?undefined:[pixelRatio,0,0,pixelRatio,0,0]});
      return render.promise;
    }).then(()=>{if(!cancelled)setLoading(false);}).catch(()=>{if(!cancelled){setError('PDF 页面加载失败');setLoading(false);}});
    return()=>{cancelled=true;render?.cancel();};
  },[document,page,width,zoom]);

  return <div ref={container} aria-label={`${title} PDF`}>
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-slate-200 bg-white p-2 text-sm text-slate-500">
      <Button size="sm" variant="ghost" disabled={!document||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</Button>
      <label>第 <select aria-label="PDF页码" value={document?Math.min(page,document.numPages):page} disabled={!document} onChange={event=>setPage(Number(event.target.value))} className="rounded border border-slate-200 bg-white px-2 py-1">{Array.from({length:document?.numPages || initialPage},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select> / {document?.numPages || '—'} 页</label>
      <Button size="sm" variant="ghost" disabled={!document||page>=document.numPages} onClick={()=>setPage(value=>value+1)}>下一页</Button>
      <div className="flex items-center gap-1 border-l border-slate-200 pl-2"><Button size="sm" variant="ghost" aria-label="缩小PDF" disabled={zoom<=50} onClick={()=>setZoom(value=>value-25)}>−</Button><button type="button" aria-label="PDF适应页面" onClick={()=>setZoom(100)}>{zoom}%</button><Button size="sm" variant="ghost" aria-label="放大PDF" disabled={zoom>=300} onClick={()=>setZoom(value=>value+25)}>+</Button></div>
    </div>
    {error?<p role="alert" className="p-6 text-center text-sm text-slate-500">{error}<Button size="sm" variant="ghost" onClick={()=>{setDocument(null);setError('');setLoading(true);setRetry(value=>value+1);}}>重试</Button></p>:null}
    {loading&&!error?<p role="status" className="p-3 text-center text-sm text-slate-500">加载原件…</p>:null}
    <canvas ref={canvas} aria-label={`${title} 第${page}页`} className="mx-auto my-3 block bg-white" style={{display:loading||error?'none':'block'}} />
  </div>;
}
