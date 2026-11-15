(() => {
const NS='http://www.w3.org/2000/svg';
window.renderChangeMap=(host,values,highlighted,unit)=>{
const model=window.getResearchMap?.();if(!model?.shapes?.length){host.textContent='本期区位未收录，可切换幅度对照。';return;}
const W=Math.max(240,host.clientWidth||300),H=Math.max(180,Math.min(420,(host.parentElement.clientHeight||340)-24)),all=model.shapes.flatMap(s=>s.points),minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
const scale=Math.min((W-60)/(maxX-minX),(H-80)/(maxY-minY)),tx=(W-(maxX-minX)*scale)/2-minX*scale,ty=40+(H-80-(maxY-minY)*scale)/2-minY*scale;
const svg=document.createElementNS(NS,'svg');svg.classList.add('change-map');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.style.height=H+'px';svg.setAttribute('role','group');svg.setAttribute('aria-label','主要子市场变化的区位示意');host.append(svg);
const el=(name,attrs,parent=svg)=>{const n=document.createElementNS(NS,name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;};
if(model.road){const road=el('g',{transform:`translate(${tx} ${ty}) scale(${scale})`,'pointer-events':'none','aria-hidden':'true'});road.append(model.road);}
const labels=[];for(const shape of model.shapes){const points=shape.points.map(p=>({x:p.x*scale+tx,y:p.y*scale+ty})),value=values.find(r=>r.area===shape.area),on=highlighted.has(shape.area),group=el('g',{'data-change-area':shape.area,role:'button',tabindex:0,'aria-label':shape.area+'，'+(value?.delta==null?'暂无对照':value.delta.toFixed(1)+unit)+'，进入区域探索'});el('path',{d:'M'+points.map(p=>p.x+','+p.y).join('L')+'Z',fill:'var(--blue)','fill-opacity':on?.88:.22,stroke:'var(--muted)','stroke-width':on?1.6:.8},group);const xs=points.map(p=>p.x),ys=points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;let x,y;const width=shape.area.length*16;if(['金融街','东城商务区','中关村'].includes(shape.area)){x=W<600?6:Math.min(...xs)-width-14;y=cy+5;}else if(['亚奥','望京-酒仙桥'].includes(shape.area)){x=Math.max(6,Math.min(W-width-6,cx-width/2));y=Math.min(...ys)-16;}else if(shape.area==='丽泽'){x=cx-width/2;y=Math.max(...ys)+25;}else{x=W<600?W-width-6:Math.max(...xs)+12;y=cy+5;}labels.push({area:shape.area,x,y,cx,cy,width,on});el('title',{},group).textContent=group.getAttribute('aria-label');}
const left=labels.filter(l=>l.x===6).sort((a,b)=>a.cy-b.cy);let last=20;for(const l of left){l.y=Math.max(last+24,l.y);last=l.y;}
const layer=el('g',{'aria-hidden':'true'});for(const l of labels){el('line',{x1:l.cx,y1:l.cy,x2:l.cx<l.x?l.x-3:l.cx>l.x+l.width?l.x+l.width+3:l.cx,y2:l.y-5,stroke:'var(--line)','stroke-width':1,'pointer-events':'none'},layer);const t=el('text',{x:l.x,y:l.y,'data-change-area':l.area,fill:'var(--ink)'},layer);t.textContent=l.area;}
};
})();
