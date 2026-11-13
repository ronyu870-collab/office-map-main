(() => {
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],D=window.DEMO,NS='http://www.w3.org/2000/svg',host=$('#time-plot'),svg=$('#time-chart');
const periods=D.periods,rows=new Map(D.rows.map(r=>[r.area+'|'+r.period,r])),routes=['t-demand','t-vacancy','t-rent','t-regions','t-outlook'];
const get=(a,i)=>rows.get(a+'|'+periods[i]),finite=v=>typeof v==='number'&&Number.isFinite(v),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let cursor=D.history_end_index,mode=0,raf=0,signature='',start=0,shapes=[],geometry=null,outlook='supply';
const left=document.createElement('div'),right=document.createElement('div'),viewport=$('.time-viewport');left.className='time-left';right.className='time-right';viewport.prepend(left);left.append($('#time-headline'),$('.time-toolbar'),$('#time-legend'));left.after(right);right.append(host,$('#time-readouts'),$('.timeline-control'));
const futureControl=document.createElement('label');futureControl.id='outlook-control';futureControl.innerHTML='展望指标 <select id="outlook-metric"><option value="supply">供应与需求</option><option value="vacancy">空置率</option><option value="rent">租金</option></select>';left.append(futureControl);$('#outlook-metric').onchange=e=>{outlook=e.target.value;signature='';schedule();};
const base=document.createElement('select');base.id='time-base';base.hidden=true;base.innerHTML='<option value="quarter">较上季</option>';const baseLabel=document.createElement('label');baseLabel.id='time-base-label';baseLabel.hidden=true;baseLabel.append(base);left.append(baseLabel);
$('#history-cursor').min=0;$('#history-cursor').max=periods.length-1;$('#history-cursor').value=cursor;
function el(tag,attrs,parent=svg){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;}
function text(x,y,t,anchor='start'){const n=el('text',{x,y,'text-anchor':anchor});n.textContent=t;return n;}
function schedule(){if(!raf)raf=requestAnimationFrame(paint);}
function paint(now){raf=0;if(window.explorationOpen)return;const s=window.getResearchState();if(!s)return;const story=$('#time'),progress=clamp((scrollY-story.offsetTop)/Math.max(1,story.offsetHeight-innerHeight),0,1);mode=Math.round(progress*4);const at=periods.indexOf(s.at);if(at>=0)cursor=at;
 const future=mode===4,m=future?outlook:mode===0?'supply':mode===2?'rent':mode===3?s.metric:'vacancy',bars=m==='supply',unit=bars?'万平方米':m==='rent'?'元/平方米/月':'%',a=mode===3?s.a:'全市',b=mode===3?s.b:null;
 const rs=future?D.annual:periods.map((q,i)=>get(a,i)),data=rs.map(r=>r?.[m]),second=bars?rs.map(r=>r.absorption):b?periods.map((q,i)=>get(b,i)?.[m]):[],count=data.length;
 const W=host.clientWidth,H=Math.max(180,host.clientHeight),L=W<600?42:60,R=W-24,T=35,B=H-46,span=(R-L)/count,x=i=>L+span*(i+.5),all=[...data,...second].filter(finite),step=bars?20:m==='rent'?100:10,max=Math.max(step,Math.ceil(Math.max(...all)/step)*step),min=bars?Math.min(0,Math.floor(Math.min(...all)/10)*10):0,y=v=>B-(v-min)/(max-min)*(B-T),bw=Math.max(2,Math.min(24,span*.3));geometry={L,R,count};
 const key=[mode,s.a,s.b,s.metric,outlook,W,H].join('|');if(key!==signature){signature=key;start=now;svg.replaceChildren();shapes=[];svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
 if(future){el('rect',{x:x(7)-span*.5,y:T,width:R-x(7)+span*.5,height:B-T,fill:'var(--soft)',opacity:.65});text(x(7),18,'预测区间');}
 for(const v of [...new Set([min,0,max/2,max])]){el('line',{x1:L,x2:R,y1:y(v),y2:y(v),class:'grid-line'});text(L-8,y(v)+5,v+(m==='vacancy'?'%':''),'end');}text(L,18,unit);
 for(let i=0;i<count;i++){const label=future?D.annual[i].year+(i>=7?'F':''):periods[i].replace('Q',' Q');if(i===0||i===count-1||(W<600?i===Math.floor(count/2):i%(future?1:8)===0))text(i===0?L:i===count-1?R:x(i),H-12,W<600&&i!==count-1?label.slice(0,4):label,i===0?'start':i===count-1?'end':'middle');}
 if(bars){data.forEach((v,i)=>{[v,second[i]].forEach((value,k)=>{if(!finite(value))return;const rect=el('rect',{x:x(i)+(k?1:-bw-1),y:y(0),width:bw,height:0,class:k?'absorption-bar':'supply-bar'});shapes.push({rect,target:value});});});}else{[data,second].forEach((series,k)=>{for(const [from,to,dash]of(future?[[0,6,false],[6,9,true]]:[[0,count-1,false]])){let d='';for(let i=from;i<=to;i++){const v=series[i];if(!finite(v))continue;d+=(i>from&&finite(series[i-1])?'L':'M')+x(i)+','+y(v);}if(d){const path=el('path',{d,class:'history-line '+(k?'secondary-line':'primary-line'),fill:'none'});if(dash)path.setAttribute('stroke-dasharray','5 5');}}});}
 if(bars&&!future){const values=rs.map(r=>r.vacancy);el('path',{d:values.map((v,i)=>(i?'L':'M')+x(i)+','+(B-v/30*(B-T))).join(' '),class:'history-line vacancy-overlay',fill:'none','aria-label':'空置率，右轴'});text(R,T-8,'30%','end');text(R,B-8,'0%','end');}
 el('line',{id:'real-time-cursor',x1:x(cursor),x2:x(cursor),y1:T,y2:B,class:'cursor-line'});
 }
 const t=matchMedia('(prefers-reduced-motion: reduce)').matches?1:clamp((now-start)/440,0,1),ease=1-Math.pow(1-t,3);for(const {rect,target}of shapes){rect.setAttribute('y',Math.min(y(0),y(target*ease)));rect.setAttribute('height',Math.abs(y(target*ease)-y(0)));}if(t<1)schedule();
 const line=$('#real-time-cursor');line.style.display=future?'none':'';line.setAttribute('x1',x(cursor));line.setAttribute('x2',x(cursor));
 const recent=cursor>=periods.length-2,cycle=cursor<4?'供应扩张':cursor<8?'疫情冲击':cursor<12?'需求修复':cursor<16?'企业需求疲软':cursor<24?'疫后修复与结构调整':'价格调整与供应释放';
 const titles=['新增供应集中释放，<br>去化速度未能同步。','供应冲击东部市场，<br>全市空置率回升。','租金跌幅扩大，<br>价格调整尚未结束。',m==='rent'?'中关村跌幅收窄，<br>东部市场承受供给压力。':'同一季度，<br>区域空置压力不同。',outlook==='rent'?'供应消化需要时间，<br>租金修复仍在后段。':outlook==='vacancy'?'2027年仍处高位，<br>2028年去化环境改善。':'供应压力延续至2027年，<br>2028年新增供应减少。'];
 $('#time-headline').innerHTML=!future&&!recent?cycle+'，<br>沿时间观察市场演变。':titles[mode];
 const fmt=(v,u)=>finite(v)?v.toFixed(m==='rent'?2:1)+u:'—';
 $('#time-readouts').innerHTML=future?outlook==='supply'?'<span class="blue-key">全年供应</span><span class="copper-key">全年净吸纳</span><span>2026全年供应 94.9万㎡</span>':outlook==='vacancy'?'<span>2027年空置率预测 23.6%</span>':'<span>租金预测继续下行，降幅逐步收窄</span>':bars?`<span class="blue-key">供应 ${get(a,cursor).supply}万㎡</span><span class="copper-key">净吸纳 ${get(a,cursor).absorption}万㎡</span><span>空置率 ${get(a,cursor).vacancy}%</span>`:`<span class="blue-key">${a} ${fmt(data[cursor],unit)}</span>${b?`<span class="copper-key">${b} ${fmt(second[cursor],unit)}</span>`:''}`;
 $('#time-legend').textContent=future?'2019—2028F · 走势示意；供应及2027空置率为报告预测':recent?'历史段为示意 · Q2/Q3为披露值':'历史示意 · '+cycle;
 $('#timeline-label').textContent=periods[cursor].replace('Q',' Q');$('#history-cursor').value=cursor;$('#history-cursor').setAttribute('aria-valuetext',periods[cursor]+(recent?' 披露值':' 历史示意'));$('.timeline-control').hidden=future;futureControl.hidden=!future;
 $('#time-region-controls').hidden=mode!==3;$('#time-area-a').value=s.a;$('#time-area-b').value=s.b;$('#time-metric').value=s.metric;$('#time-metric-label').hidden=false;
 $$('[data-time-view]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.timeView===mode)));window.syncReadingControls?.(mode);
 $('#time-changes').hidden=future;$('#time-changes').textContent='比较区域变化';$('#time-to-space').hidden=future;$('#time-to-space').setAttribute('aria-disabled','false');$('.time-bottom > span').textContent=future?'报告展望':recent?'披露数据':'历史示意';svg.setAttribute('aria-label',future?'2019至2028年'+unit+'走势及预测':periods[cursor]+'，'+$('#time-readouts').textContent);
}
function choose(i){cursor=clamp(Math.round(Number(i)),0,periods.length-1);window.setResearchState({dataset:'history',at:periods[cursor],pin:'1'},false);schedule();}
$('#history-cursor').addEventListener('input',e=>choose(e.target.value));$('#history-cursor').addEventListener('change',e=>choose(e.target.value));
$$('[data-time-view]').forEach(b=>b.onclick=()=>window.researchGo(routes[Number(b.dataset.timeView)]));
$('#time-area-a').onchange=e=>{const s=window.getResearchState();window.setResearchState({a:e.target.value,b:e.target.value===s.b?s.a:s.b},false);};$('#time-area-b').onchange=e=>{const s=window.getResearchState();window.setResearchState({b:e.target.value,a:e.target.value===s.a?s.b:s.a},false);};$('#time-metric').onchange=e=>window.setResearchState({metric:e.target.value},false);
$('#time-to-space').addEventListener('click',()=>window.setResearchState({dataset:'history',at:periods[cursor],metric:mode===2?'rent':mode===3?window.getResearchState().metric:'vacancy',pin:'1'},false),true);
const pick=e=>{if(mode===4||!geometry)return;const r=svg.getBoundingClientRect();choose((e.clientX-r.left-geometry.L)/(geometry.R-geometry.L)*geometry.count-.5);};svg.addEventListener('click',pick);svg.addEventListener('pointerdown',e=>{if(mode!==4){svg.setPointerCapture(e.pointerId);pick(e);}});svg.addEventListener('pointermove',e=>{if(svg.hasPointerCapture(e.pointerId))pick(e);});svg.addEventListener('pointerup',e=>{if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);});
const prior=window.refreshResearch;window.refreshResearch=s=>{prior?.(s);schedule();};addEventListener('scroll',schedule,{passive:true});addEventListener('resize',()=>{signature='';schedule();});schedule();
})();
