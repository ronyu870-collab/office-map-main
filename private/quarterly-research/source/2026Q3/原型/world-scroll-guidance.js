(() => {
const body=document.querySelector('#world-body'),scope=document.querySelector('#world-scope');let base='',frame=0;
const suffix=/ · (?:上下滑动查看更多|左右滑动看逐季读数).*$/;
function update(){frame=0;if(!body.closest('dialog').open)return;const history=body.querySelector('.world-history'),projects=body.querySelector('.world-projects,.world-project-list');const y=!!projects&&body.scrollHeight-body.clientHeight-body.scrollTop>4,x=!!history&&history.scrollWidth-history.clientWidth-history.scrollLeft>4;scope.textContent=base+(y?' · 上下滑动查看更多':'')+(x?' · 左右滑动看逐季读数':'');}
function schedule(){if(!frame)frame=requestAnimationFrame(update);}
new MutationObserver(()=>{base=scope.textContent.replace(suffix,'');schedule();}).observe(body,{childList:true});
body.addEventListener('scroll',schedule,{passive:true,capture:true});addEventListener('resize',schedule);document.querySelector('#region-world').addEventListener('transitionend',schedule);
})();
