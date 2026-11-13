(() => {
'use strict';
const $=s=>document.querySelector(s),ids=['stock','demand','leed','projects','transit','macro','gradeb','library'];
const names={stock:'存量与等级',demand:'分区需求',leed:'楼宇品质',projects:'重点项目',transit:'站点租金',macro:'宏观背景',gradeb:'乙级市场',library:'完整指标'};
let active=null;
const route=()=>location.hash.slice(1).split('?')[0]||'overview';
function prepare(target,origin){
 if(ids.includes(target)){
  const recorded=route()===target?new URLSearchParams(location.hash.split('?')[1]||'').get('readingFrom'):null;
  if(origin||recorded||!active)window.supplementOrigin=origin||recorded||location.hash||'#overview';
  if(ids.includes(window.supplementOrigin.slice(1).split('?')[0]))window.supplementOrigin='#topics';
  active=target;
 }else{active=null;window.supplementOrigin=null;}
 for(const id of ids)$('#'+id).hidden=id!==active;
 document.body.classList.toggle('reading-supplement',!!active);
}
window.prepareReadingRoute=target=>prepare(target);
for(const id of ids){
 const section=$('#'+id),button=document.createElement('button');button.className='return-reading';button.textContent='← 返回刚才的阅读';button.setAttribute('aria-label','关闭'+names[id]+'并返回原位置');section.prepend(button);
 button.onclick=()=>window.researchGo((window.supplementOrigin||'#topics').slice(1).split('?')[0]);
}
// Hidden supplements are still addressable from relevant evidence and the contents.
const link=(target,label)=>{const a=document.createElement('a');a.href='#'+target;a.dataset.go=target;a.textContent=label;return a;};
const overview=$('#overview'),bridge=document.createElement('nav');bridge.className='reading-questions';bridge.setAttribute('aria-label','本期研究主线');
[['space','差异在哪些分区'],['time','变化如何演进'],['topics','哪些需求值得关注']].forEach(([id,label])=>bridge.append(link(id,label+' →')));overview.append(bridge);
const topicNav=document.createElement('nav');topicNav.className='topic-index';topicNav.setAttribute('aria-label','按问题深入研究');
[['leed','品质是否带来更低空置'],['projects','哪些项目值得跟踪'],['macro','城市背景与行业变化'],['transit','沿线路观察租金']].forEach(([id,label])=>topicNav.append(link(id,label+' →')));$('#topics').append(topicNav);
const facts=document.createElement('nav');facts.className='reference-links';facts.setAttribute('aria-label','相关资料');[['stock','存量与等级'],['demand','分区净吸纳'],['gradeb','乙级市场'],['library','全部指标']].forEach(([id,label])=>facts.append(link(id,label)));$('#conclusion').append(facts);
const current=route(),incoming=new URLSearchParams(location.hash.split('?')[1]||'').get('readingFrom');prepare(current,incoming);
requestAnimationFrame(()=>window.researchGo(current,false,true));
addEventListener('popstate',()=>{const incoming=new URLSearchParams(location.hash.split('?')[1]||'').get('readingFrom');prepare(route(),incoming);},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&!window.explorationOpen&&!document.querySelector('.research-settings:not([hidden])')){e.preventDefault();window.researchGo((window.supplementOrigin||'#topics').slice(1).split('?')[0]);}});
})();
