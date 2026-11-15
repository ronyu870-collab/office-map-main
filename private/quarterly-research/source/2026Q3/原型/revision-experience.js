(() => {
const $=s=>document.querySelector(s),B=window.REPORT;
function showProject(i){const r=B.cbd.projects[i];if(!r||!$('#cbd-detail'))return;$('#cbd-detail span').textContent='地块 '+r[0];$('#cbd-detail h3').textContent=r[1];}
function choose(i){document.querySelectorAll('[data-parcel]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.parcel===i)));if($('#cbd-picker'))$('#cbd-picker').value=String(i);showProject(i);}
$('#project-body').addEventListener('click',e=>{const p=e.target.closest('[data-parcel]');if(p)choose(+p.dataset.parcel);});
$('#project-body').addEventListener('change',e=>{if(e.target.id==='cbd-picker')choose(+e.target.value);});
$('#project-body').addEventListener('pointerover',e=>{const p=e.target.closest('[data-parcel]');if(e.pointerType!=='touch'){const selected=$('[data-parcel][aria-pressed="true"]');if(p)showProject(+p.dataset.parcel);else if(selected)showProject(+selected.dataset.parcel);}});
$('#project-body').addEventListener('pointerleave',()=>{const p=$('[data-parcel][aria-pressed="true"]');if(p)showProject(+p.dataset.parcel);});
$('#project-body').addEventListener('focusout',e=>{if(!e.relatedTarget?.closest('[data-parcel]')){const p=$('[data-parcel][aria-pressed="true"]');if(p)showProject(+p.dataset.parcel);}});
$('#project-body').addEventListener('focusin',e=>{const p=e.target.closest('[data-parcel]');if(p)showProject(+p.dataset.parcel);});
})();
