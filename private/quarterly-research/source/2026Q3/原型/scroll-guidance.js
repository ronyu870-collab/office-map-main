(() => {
const tracked=new Map();let frame=0;
function update(){frame=0;document.querySelectorAll('.table-scroll,.project-years').forEach(el=>{
 if(!tracked.has(el)){const hint=document.createElement('p');hint.className='scroll-remainder';hint.setAttribute('aria-live','polite');el.after(hint);tracked.set(el,hint);if(el.classList.contains('table-scroll')){el.parentElement.style.display='flex';el.parentElement.style.flexDirection='column';el.style.flex='1';el.style.height='auto';el.style.minHeight='0';}el.addEventListener('scroll',schedule,{passive:true});}
 const hint=tracked.get(el),visible=el.getClientRects().length,across=el.scrollWidth-el.clientWidth-el.scrollLeft>4,down=el.scrollHeight-el.clientHeight-el.scrollTop>4;
 hint.hidden=!visible||(!across&&!down);hint.textContent=across?'向右滑动，查看其余内容':down?'向下滑动，查看其余内容':'';
 });for(const [el,hint]of tracked)if(!el.isConnected){hint.remove();tracked.delete(el);}}
function schedule(){if(!frame)frame=requestAnimationFrame(update);}
for(const id of ['project-body','macro-body'])new MutationObserver(schedule).observe(document.getElementById(id),{childList:true});
addEventListener('resize',schedule);document.addEventListener('click',schedule);addEventListener('scroll',schedule,{passive:true});schedule();
})();
