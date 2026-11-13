(() => {
'use strict';
const $=s=>document.querySelector(s),B=window.REPORT,P=window.QUARTERS[0],city=P.metrics.find(r=>r.area==='全市'),number=v=>Number(String(v).replace(/[% ,]/g,''));
const delta=B.city.absorption_previous==null?null:B.city.absorption-B.city.absorption_previous,rentChange=number(city.rent_qoq_reported),supply=B.forecast.a[B.id],share=(supply[0]+supply[1])/supply.reduce((s,v)=>s+v,0)*100;
const findings=[
 {tag:'本期已发生',text:delta==null?`本期净吸纳量${B.city.absorption}万平方米；上期未录入，不作环比判断。`:`净吸纳量较上季${delta>=0?'增加':'减少'}${Math.abs(delta).toFixed(1)}万平方米。`,link:'overview',label:'回看全市需求'},
 {tag:rentChange<0?'本期仍承压':'本期价格变化',text:`全市净有效租金环比${rentChange<0?'下降':'上升'}${Math.abs(rentChange).toFixed(1)}%；各分区表现仍需分别判断。`,link:'ranking',metric:'rent',label:'比较分区租金'},
 {tag:'后续待观察',text:`前两年占三年预测供应的${share.toFixed(0)}%。后续需求能否持续消化供应，仍需跟踪。`,link:'forecast',label:'回看供应预测'}
];
const wrap=document.createElement('div');wrap.className='research-findings';
for(const f of findings){const row=document.createElement('article'),tag=document.createElement('span'),text=document.createElement('p'),a=document.createElement('a');tag.textContent=f.tag;text.textContent=f.text;a.textContent=f.label+' →';a.href='#'+f.link;a.dataset.go=f.link;if(f.metric)a.dataset.evidenceMetric=f.metric;row.append(tag,text,a);wrap.append(row);}
$('#conclusion .analysis').replaceWith(wrap);$('#conclusion .conclusion-links').remove();
$('#conclusion h2').innerHTML=delta>=0&&rentChange<0?'去化与租金，<br>需要分别判断。':'本期变化，<br>回到证据中判断。';
document.addEventListener('click',e=>{const a=e.target.closest('[data-evidence-metric]');if(a)window.setResearchState({dataset:'reported',at:B.id,metric:a.dataset.evidenceMetric,pin:'0'},false);},true);
})();
