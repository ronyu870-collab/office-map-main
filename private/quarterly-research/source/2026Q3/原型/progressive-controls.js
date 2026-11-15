(() => {
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const popups=[];
function settings(trigger,label,nodes){
 const panel=document.createElement('div');panel.className='research-settings';panel.hidden=true;panel.id=trigger.id+'-panel';panel.setAttribute('role','group');panel.setAttribute('aria-label',label);
 const done=document.createElement('button');done.className='settings-done';done.textContent='完成';panel.append(...nodes,done);document.body.append(panel);
 trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',panel.id);
 function position(){const r=trigger.getBoundingClientRect(),width=Math.min(340,innerWidth-32);panel.style.width=width+'px';panel.style.maxHeight=(innerHeight-32)+'px';panel.style.left=Math.max(16,Math.min(innerWidth-width-16,r.left))+'px';const h=panel.getBoundingClientRect().height;panel.style.top=Math.max(16,Math.min(innerHeight-h-16,r.bottom+8))+'px';}
 function close(focus=false){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});}
 function open(){popups.forEach(p=>p.close());panel.hidden=false;trigger.setAttribute('aria-expanded','true');position();[...panel.querySelectorAll('select,input')].find(el=>el.getClientRects().length)?.focus({preventScroll:true});}
 trigger.onclick=()=>panel.hidden?open():close(true);done.onclick=()=>close(true);
 const api={panel,trigger,close,position};popups.push(api);return api;
}
// Keep the existing controls and their listeners; only change when they are shown.
const toolbar=$('.time-toolbar'),oldViews=$('.time-toolbar .view-switch');oldViews.hidden=true;
const view=document.createElement('select');view.id='time-view-choice';view.setAttribute('aria-label','切换时间观察视角');
['全市供需','全市空置率','全市租金','区域对比','全市展望'].forEach((label,i)=>view.add(new Option(label,String(i))));
const adjust=document.createElement('button');adjust.id='time-adjust';adjust.className='text-control';toolbar.prepend(view,adjust);
const regions=$('#time-region-controls'),base=$('#time-base-label');
const timeSettings=settings(adjust,'调整时间比较',[regions,base]);
view.onchange=()=>{$('[data-time-view="'+view.value+'"]').click();timeSettings.close();};
let priorMode=null;
window.syncReadingControls=mode=>{
 view.value=String(mode);adjust.hidden=mode!==3;adjust.textContent=mode===3?'调整比较区域':mode===4?'选择观察指标':'调整对照基准';
 if(priorMode!==mode){timeSettings.close();priorMode=mode;}
};
// Original selectors live in one optional settings panel. Scope remains visible.
const supplyToolbar=$('#forecast .scene-toolbar'),scope=$('#supply-grade').closest('label'),compare=$('#supply-compare').closest('label');
const supplyAdjust=document.createElement('button');supplyAdjust.id='supply-adjust';supplyAdjust.className='text-control';supplyToolbar.append(supplyAdjust);
const cue=document.createElement('span');cue.className='interaction-cue';cue.textContent='点年份，查看相关项目';supplyToolbar.append(cue);
settings(supplyAdjust,'预测范围与版本对照',[scope,compare]);
function supplySummary(){supplyAdjust.textContent=($('#supply-grade').value==='a'?'甲级':'甲乙级合计')+($('#supply-compare').checked?' · 已对照上期':' · 对照设置');}
$('#supply-grade').addEventListener('change',supplySummary);$('#supply-compare').addEventListener('change',supplySummary);supplySummary();
// Reveal one CBD project name while keeping all parcel identifiers available.
const projectBody=$('#project-body');
function annotateParcels(){projectBody.querySelectorAll('[data-parcel]').forEach(el=>el.setAttribute('aria-label',window.REPORT.cbd.projects[Number(el.dataset.parcel)].join(' ')));}
function previewParcel(target){const board=projectBody.querySelector('.parcel-board');if(!board)return;board.classList.toggle('has-preview',!!target);board.querySelectorAll('.parcel').forEach(p=>p.classList.toggle('is-preview',p===target));}
projectBody.addEventListener('pointerover',e=>{if(e.pointerType!=='touch')previewParcel(e.target.closest('[data-parcel]'));});projectBody.addEventListener('pointerleave',()=>previewParcel(null));projectBody.addEventListener('focusin',e=>previewParcel(e.target.closest('[data-parcel]')));projectBody.addEventListener('focusout',e=>{if(!e.relatedTarget?.closest('[data-parcel]'))previewParcel(null);});
new MutationObserver(annotateParcels).observe(projectBody,{childList:true,subtree:true});annotateParcels();
// Dismiss transient controls when returning to the reading flow; values are retained.
document.addEventListener('pointerdown',e=>popups.forEach(p=>{if(!p.panel.hidden&&!p.panel.contains(e.target)&&!p.trigger.contains(e.target))p.close();}),true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const p=popups.find(p=>!p.panel.hidden);if(p){e.preventDefault();e.stopImmediatePropagation();p.close(true);}}},true);
addEventListener('wheel',e=>popups.forEach(p=>{if(!p.panel.contains(e.target))p.close();}),{passive:true});
addEventListener('scroll',e=>{if(e.target===document)popups.forEach(p=>{if(!p.panel.contains(document.activeElement))p.close();});},{passive:true});addEventListener('resize',()=>popups.forEach(p=>{if(!p.panel.hidden)p.position();}));
window.createResearchSettings=settings;
// Initialize from the existing mode without invoking navigation.
window.syncReadingControls(Number($('[data-time-view][aria-pressed="true"]')?.dataset.timeView||0));
})();
