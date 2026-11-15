(() => {
'use strict';
const $=s=>document.querySelector(s),nav=$('.header nav'),links=[...nav.querySelectorAll('[data-go]')],order=['overview','space','time','topics'];
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const marker=document.createElement('span');marker.className='chapter-marker';marker.setAttribute('aria-hidden','true');nav.prepend(marker);
let pending=null,frame=0,idle=0,animations=[],last=window.getReadingChapter(),settled=last;
function stopEntrance(){animations.forEach(a=>a.cancel());animations=[];document.body.removeAttribute('data-chapter-motion');}
function mark(chapter,instant=false){
 const link=links.find(a=>a.dataset.go===chapter);if(!link)return;
 const r=link.getBoundingClientRect(),n=nav.getBoundingClientRect();
 if(instant)nav.classList.add('marker-instant');
 marker.style.width=r.width+'px';marker.style.height=r.height+'px';marker.style.transform=`translate(${r.left-n.left}px,${r.top-n.top}px)`;
 links.forEach(a=>{if(a===link)a.setAttribute('aria-current','true');else a.removeAttribute('aria-current');});
 nav.dataset.chapter=chapter;
 if(instant)requestAnimationFrame(()=>nav.classList.remove('marker-instant'));
}
function arrive(chapter,from){
 if(chapter===settled)return;settled=chapter;stopEntrance();
 if(reduce.matches||window.explorationOpen)return;
 const view=window.spaceModel().view,scene=['space','ranking','scatter','compare'].includes(view)?$('#content'):view.startsWith('t-')?$('.time-viewport'):$('#'+view);
 const heading=scene?.querySelector('h1,h2'),art=scene?.querySelector('#visual,.time-plot,.scene-body');
 if(!heading)return;const box=heading.getBoundingClientRect();if(box.bottom<$('.header').getBoundingClientRect().bottom||box.top>innerHeight)return;
 const direction=order.indexOf(chapter)>=order.indexOf(from)?1:-1,easing='cubic-bezier(.16,1,.3,1)';
 document.body.dataset.chapterMotion=chapter;
 // A short uncover introduces the chapter; chart motion itself remains untouched.
 animations.push(heading.animate([{clipPath:'inset(0 0 100% 0)',opacity:.65},{clipPath:'inset(0 0 0% 0)',opacity:1}],{duration:300,easing}));
 if(art)animations.push(art.animate([{opacity:.72,translate:`${direction*18}px 0`},{opacity:1,translate:'0px 0'}],{duration:380,delay:45,easing}));
 Promise.allSettled(animations.map(a=>a.finished)).then(()=>{if(document.body.dataset.chapterMotion===chapter)document.body.removeAttribute('data-chapter-motion');});
}
function observe(){frame=0;const current=window.getReadingChapter();
 if(pending){mark(pending.to);if(window.readingDestination!=null){request();return;}
  const intent=pending;pending=null;window.chapterNavigationTarget=null;mark(current);if(current===intent.to)arrive(current,intent.from);last=current;return;
 }
 if(current!==last){last=current;mark(current);}
 if(current!==settled){const from=settled;clearTimeout(idle);idle=setTimeout(()=>{if(!pending&&window.readingDestination==null&&window.getReadingChapter()===current)arrive(current,from);},200);}
}
function request(){if(!frame)frame=requestAnimationFrame(observe);}
function cancelIntent(){pending=null;window.chapterNavigationTarget=null;clearTimeout(idle);stopEntrance();last=window.getReadingChapter();mark(last);}
document.addEventListener('click',e=>{const a=e.target.closest('[data-go]');if(!a||window.explorationOpen||document.body.classList.contains('report-unavailable'))return;
 const to=window.readingChapterFor(a.dataset.go),from=window.getReadingChapter();
 clearTimeout(idle);stopEntrance();pending={to,from};window.chapterNavigationTarget=to;mark(to);request();
},true);
addEventListener('scroll',request,{passive:true});
addEventListener('wheel',cancelIntent,{passive:true});
addEventListener('touchstart',cancelIntent,{passive:true});
addEventListener('pointerdown',()=>{stopEntrance();if(pending)cancelIntent();},{passive:true});
addEventListener('keydown',e=>{if(['Escape','ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key))cancelIntent();});
addEventListener('popstate',()=>{pending=null;window.chapterNavigationTarget=null;stopEntrance();request();});
addEventListener('resize',()=>{cancelIntent();mark(window.getReadingChapter(),true);});
reduce.addEventListener('change',()=>{cancelIntent();mark(window.getReadingChapter(),true);});
// Font and viewport measurements do not change document flow or chart coordinates.
document.fonts.ready.then(()=>mark(window.getReadingChapter(),true));mark(last,true);
})();
