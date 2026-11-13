(() => {
'use strict';
const $=s=>document.querySelector(s),svg=$('#visual'),content=$('#content'),NS='http://www.w3.org/2000/svg';
const hint=document.createElement('div');hint.id='scatter-inspect-hint';hint.hidden=true;
hint.innerHTML='<span id="scatter-point-help">悬停或点选散点</span><select id="scatter-pick" aria-label="选择要查看的区域"><option value="">选择区域</option></select>';
$('.space-sidebar').insertBefore(hint,$('#copy').nextSibling);
const card=document.createElement('div');card.id='scatter-inspect-card';card.hidden=true;card.setAttribute('role','group');card.setAttribute('aria-label','所选区域');
card.innerHTML='<button id="scatter-open-detail"></button><button id="scatter-clear" aria-label="取消区域聚焦">×</button>';
content.append(card);
const link=document.createElementNS(NS,'line');link.id='scatter-inspect-link';link.setAttribute('aria-hidden','true');link.style.pointerEvents='none';svg.append(link);
let hovered=null,pinned=null,hideTimer=null,optionsKey='';
const active=()=>{const m=window.spaceModel();return m.view==='scatter'&&Math.abs(m.phase-2)<.12;};
const selected=()=>hovered||pinned;
function clear(){clearTimeout(hideTimer);hideTimer=null;hovered=null;pinned=null;paint();}
function choose(area,pin=false){clearTimeout(hideTimer);hideTimer=null;hovered=area;if(pin)pinned=area;paint();}
function leave(){if(hideTimer)return;hideTimer=setTimeout(()=>{hideTimer=null;hovered=null;paint();},180);}
function regionNode(area){return $('#forms [data-region="'+CSS.escape(area)+'"]');}
function point(area){const e=regionNode(area)?.querySelector('.region-form');if(!e)return null;const r=e.getBoundingClientRect(),s=svg.getBoundingClientRect();return{x:r.x+r.width/2-s.x,y:r.y+r.height/2-s.y};}
function paint(){
 const m=window.spaceModel(),on=active(),l=m.layout;hint.hidden=!on;document.querySelectorAll('#forms [data-region]').forEach(e=>{if(on)e.setAttribute('aria-describedby','scatter-point-help');else e.removeAttribute('aria-describedby');});
 if(!on){hovered=null;clearTimeout(hideTimer);hideTimer=null;card.hidden=true;link.style.display='none';document.querySelectorAll('#forms .inspect-active').forEach(e=>e.classList.remove('inspect-active'));return;}
 hint.style.left=l.scatter.left+'px';hint.style.top=(l.scatter.top-64)+'px';hint.style.width=(l.scatter.right-l.scatter.left)+'px';
 const key=m.areas.join('|');if(optionsKey!==key){optionsKey=key;$('#scatter-pick').replaceChildren(new Option('选择区域',''),...m.areas.map(a=>new Option(a,a)));}
 const area=selected();$('#scatter-pick').value=area||'';
 document.querySelectorAll('#forms [data-region]').forEach(e=>{e.classList.toggle('inspect-active',e.dataset.region===area);e.setAttribute('aria-describedby','scatter-point-help');});
 if(!area){card.hidden=true;link.style.display='none';return;}
 const p=point(area);if(!p)return;card.hidden=false;$('#scatter-open-detail').textContent=area+' · 查看详情 →';
 const width=Math.min(280,l.landscape?l.scatter.right-l.scatter.left:l.W-32),height=56,x=Math.max(l.landscape?l.scatter.left:16,Math.min(l.W-width-16,p.x-width/2));
 let y=p.y-height-20;if(y<l.scatter.top)y=p.y+20;
 y=Math.max(l.scatter.top,Math.min(l.H-(l.landscape?12:150)-height,y));
 card.style.width=width+'px';card.style.left=x+'px';card.style.top=y+'px';
 const endX=Math.max(x+16,Math.min(x+width-16,p.x)),endY=y>p.y?y:y+height;
 for(const[k,v]of Object.entries({x1:p.x,y1:p.y,x2:endX,y2:endY}))link.setAttribute(k,v);
 link.style.display='';
}
svg.addEventListener('pointermove',e=>{
 if(!active()||e.pointerType==='touch'||window.spaceGesture)return;
 if(e.target.closest('[data-threshold]')){leave();return;}
 const r=svg.getBoundingClientRect(),x=e.clientX-r.x,y=e.clientY-r.y;
 let nearest=null,dist=19;
 for(const area of window.spaceModel().areas){const p=point(area);if(!p)continue;const d=Math.hypot(p.x-x,p.y-y);if(d<dist){dist=d;nearest=area;}}
 if(nearest)choose(nearest);else if(!card.contains(e.target))leave();
});
svg.addEventListener('pointerleave',leave);
// Capture scatter taps before the existing region-world click handler.
svg.addEventListener('click',e=>{if(!active())return;const region=e.target.closest('#forms [data-region]');if(region){e.stopPropagation();choose(region.dataset.region,true);}},true);
svg.addEventListener('focusin',e=>{if(active()&&e.target.closest('#forms [data-region]'))choose(e.target.closest('[data-region]').dataset.region);});
svg.addEventListener('focusout',leave);
card.addEventListener('pointerenter',()=>{clearTimeout(hideTimer);hideTimer=null;});card.addEventListener('pointerleave',leave);
card.addEventListener('focusin',()=>{clearTimeout(hideTimer);hideTimer=null;});card.addEventListener('focusout',leave);
$('#scatter-pick').onchange=e=>e.target.value?choose(e.target.value,true):clear();
$('#scatter-open-detail').onclick=()=>{const area=selected();if(area){pinned=area;window.openRegionWorld(area,regionNode(area));}};
$('#scatter-clear').onclick=()=>{clear();$('#scatter-pick').focus({preventScroll:true});};
document.addEventListener('pointerdown',e=>{if(active()&&!window.explorationOpen&&svg.contains(e.target)&&!e.target.closest('#forms [data-region]'))clear();},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active()&&!window.explorationOpen&&selected()){e.preventDefault();e.stopImmediatePropagation();clear();$('#scatter-pick').focus({preventScroll:true});}},true);
window.paintScatterInspect=paint;paint();
})();
