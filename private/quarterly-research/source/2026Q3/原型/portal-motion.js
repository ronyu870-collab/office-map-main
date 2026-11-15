(() => {
let frame=0,overlay=null;
window.stopResearchPortal=()=>{cancelAnimationFrame(frame);overlay?.remove();overlay=null;};
window.playResearchPortal=(dialog,trigger,reverse=false)=>{
window.stopResearchPortal();if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
const area=trigger?.closest('[data-region]')?.dataset.region;if(!area)return;
const group=document.querySelector('#forms [data-region="'+CSS.escape(area)+'"]'),bar=dialog.querySelector('.world-bar:first-child .world-rail i'),destination=bar||dialog.querySelector('#world-body');if(!group||!destination)return;const bounds=group.getBoundingClientRect();if(bounds.bottom<=0||bounds.right<=0||bounds.top>=innerHeight||bounds.left>=innerWidth)return;
const nodes=[...group.querySelectorAll('.region-form')],target=destination.getBoundingClientRect();if(target.width<1||!nodes.length)return;
const NS='http://www.w3.org/2000/svg',N=64,svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);svg.classList.add('portal-shape');svg.setAttribute('aria-hidden','true');overlay=svg;dialog.append(svg);
const rectPoints=(x,y,w,h)=>Array.from({length:N},(_,i)=>{const edge=Math.floor(i/16),t=i%16/16;return edge===0?{x:x+w*t,y}:edge===1?{x:x+w,y:y+h*t}:edge===2?{x:x+w*(1-t),y:y+h}:{x,y:y+h*(1-t)};});
const items=nodes.map((node,index)=>{const matrix=node.getScreenCTM(),length=node.getTotalLength(),source=Array.from({length:N},(_,i)=>{const p=node.getPointAtLength(i/N*length);return{x:matrix.a*p.x+matrix.c*p.y+matrix.e,y:matrix.b*p.x+matrix.d*p.y+matrix.f};}),end=bar?rectPoints(target.x+target.width/nodes.length*index,target.y,target.width/nodes.length,target.height):source.map(p=>({x:target.x+target.width/2+(p.x-(bounds.x+bounds.width/2))*Math.min(150/bounds.width,150/bounds.height),y:target.y+target.height/2+(p.y-(bounds.y+bounds.height/2))*Math.min(150/bounds.width,150/bounds.height)})),path=document.createElementNS(NS,'path');path.setAttribute('fill',getComputedStyle(node).fill);svg.append(path);return{source,end,path};});
const center=points=>({x:points.reduce((a,p)=>a+p.x,0)/N,y:points.reduce((a,p)=>a+p.y,0)/N});
const mix=(a,b,t)=>a.map((p,i)=>({x:p.x+(b[i].x-p.x)*t,y:p.y+(b[i].y-p.y)*t}));const ease=t=>1-Math.pow(1-Math.max(0,Math.min(1,t)),3),start=performance.now();
function tick(now){const p=Math.min(1,(now-start)/420),t=reverse?1-p:p;for(const it of items){const a=center(it.source),b=center(it.end),tinyA=it.source.map(pt=>({x:a.x+(pt.x-a.x)*.018,y:a.y+(pt.y-a.y)*.018})),tinyB=it.end.map(pt=>({x:b.x+(pt.x-b.x)*.018,y:b.y+(pt.y-b.y)*.018}));let points=t<.3?mix(it.source,tinyA,ease(t/.3)):t<.65?mix(tinyA,tinyB,ease((t-.3)/.35)):mix(tinyB,it.end,ease((t-.65)/.35));it.path.setAttribute('d','M'+points.map(pt=>pt.x.toFixed(2)+','+pt.y.toFixed(2)).join('L')+'Z');}svg.dataset.phase=String(p);if(p<1)frame=requestAnimationFrame(tick);else window.stopResearchPortal();}frame=requestAnimationFrame(tick);
};
})();
