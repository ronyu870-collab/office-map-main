(() => {
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],B=window.REPORT;
$('.overview-body .bar-group').setAttribute('aria-label','三季度新增供应与净吸纳量');
$('.overview-body .bar-group').innerHTML='<div class="overview-row"><span>新增供应</span><div class="rail"><i style="width:100%"></i></div><span>56.9</span></div><div class="overview-row"><span>净吸纳量</span><div class="rail"><i class="secondary" style="width:26.54%"></i></div><span>15.1</span></div><p class="figure-meta">2026 Q3 · 万平方米</p>';
$('#overview .facts dt').textContent='前三季度累计净吸纳';$('#overview .facts dd').textContent=B.city.absorption_ytd+'万平方米';
$('#industry-scope').textContent='2026年前三季度 · 成交面积，不含续租';
function title(){if($('#topics h2'))$('#topics h2').innerHTML='科技与金融仍占半壁，<br>专业服务位列第三。';}
title();
const priorRefresh=window.refreshResearch;window.refreshResearch=s=>{priorRefresh?.(s);title();};
$$('[data-go="leed"],[data-world-mode="quality"]').forEach(n=>n.hidden=true);
$('#leed h2').textContent='本期没有认证品质资料';$('#leed .scene-body').textContent='本报告未收录该专题。';
$$('[data-go="transit"]').forEach(n=>n.textContent='重点轨道连接');
$('#transit h2').innerHTML='沿重点线路，<br>查看区域连接。';
const rail=B.rail.items;
$('#transit .scene-body').innerHTML='<div class="rail-research"><div class="view-switch" role="group" aria-label="选择轨道线路">'+rail.map((r,i)=>'<button data-rail="'+i+'" aria-pressed="'+(i===0)+'">'+r.label+'</button>').join('')+'</div><div id="rail-detail" aria-live="polite"></div></div>';
$('#transit .station-step').hidden=true;$('#transit .figure-meta').textContent='本期报告所载进度 · 不代表实时运营信息';
function showRail(i){$('#rail-detail').innerHTML='<h3>'+rail[i].title+'</h3><p>'+rail[i].description+'</p>';$$('[data-rail]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.rail===i)));}showRail(0);$$('[data-rail]').forEach(b=>b.onclick=()=>showRail(+b.dataset.rail));
const share=document.createElement('div');share.className='supply-regions';share.innerHTML='<button class="text-control" id="supply-distribution" aria-expanded="false">查看预测供应分区 →</button><div id="supply-region-body" hidden></div>';$('#forecast').append(share);
function supplyCopy(){const grade=$('#supply-grade').value;$('#forecast-title').innerHTML='供应压力，<br>延续至2027年。';$('#supply-compare').closest('label').hidden=true;$('#supply-meta').textContent=grade==='a'?'三季度报告预测 · 2026为年内剩余供应；2027/2028为全年 · 万平方米':'三季度报告原列甲乙合计 · 2026F/2027F/2028F · 万平方米';const first=$('#supply-chart .supply-column > span');if(first)first.textContent=grade==='a'?'2026年内剩余':'2026F';$('#supply-region-body').innerHTML=(grade==='a'?B.forecast.shares_a:B.forecast.shares_ab).map(([a,v])=>'<button data-supply-area="'+a+'"><span>'+a+'</span><span>'+v+'%</span></button>').join('')+'<p>所列未来供应窗口合计份额，不代表任一单独年份。</p>';}
$('#supply-distribution').onclick=()=>{const body=$('#supply-region-body');body.hidden=!body.hidden;$('#supply-distribution').setAttribute('aria-expanded',String(!body.hidden));};$('#supply-grade').addEventListener('change',supplyCopy);supplyCopy();
$('#supply-region-body').onclick=e=>{const b=e.target.closest('[data-supply-area]');if(!b)return;$$('[data-supply-area]').forEach(x=>x.classList.toggle('is-selected',x===b));if(['CBD','丽泽','通州'].includes(b.dataset.supplyArea)){window.researchGo('projects');document.querySelector('[data-project="'+({CBD:'cbd','丽泽':'lize','通州':'canal'}[b.dataset.supplyArea])+'"]').click();}};
function projectScope(){if($('[data-project="canal"]').getAttribute('aria-pressed')==='true')$('#project-meta').textContent='市场指标截至2026年二季度末 · 项目为本期报告所列预计交付';if($('[data-project="cbd"]').getAttribute('aria-pressed')==='true')$('#project-meta').textContent='点选地块查看项目 · 区位示意';}
document.addEventListener('click',e=>{if(e.target.closest('[data-project]'))projectScope();});projectScope();
const facts=[['本期已发生','前三季度净吸纳累计35.4万平方米；中关村本季去化5万平方米，租金环比降幅收窄至0.5%。','overview','回看全市供需'],['当前压力','新增供应56.9万平方米，空置率升至19.8%；租金环比下降4.1%。','t-demand','观察供需变化'],['未来供应','2027年预计供应53万平方米；2028年供应减至17万平方米，去化环境逐步改善，租金修复仍需时间。','forecast','查看供应预期']];
$('#conclusion h2').innerHTML='需求仍在释放，<br>后续供应仍需消化。';$('.research-findings').innerHTML=facts.map(([tag,text,route,label])=>'<article><span>'+tag+'</span><p>'+text+'</p><a href="#'+route+'" data-go="'+route+'">'+label+' →</a></article>').join('');
$('.copyright').textContent='© 2026 Colliers · 三季度交互研究 · 管理员预览';
function showDistrict(area){const r=B.districts.items.find(x=>x[0]===area);$('#district-readout').innerHTML='<dl class="macro-list"><div><dt>地区生产总值</dt><dd>'+r[1]+'亿元</dd><dd>同比 '+r[2]+'</dd></div>'+B.districts.industries[area].map(([n,v])=>'<div><dt>'+n+'</dt><dd>同比 '+(v>0?'+':'')+v.toFixed(1)+'%</dd></div>').join('')+'</dl>';}
document.addEventListener('click',e=>{const button=e.target.closest('[data-macro]');if(!button)return;if(button.dataset.macro==='districts'){$('#macro h2').innerHTML='六个中心城区，<br>观察各自经济结构。';$('#macro-body').innerHTML='<label class="district-choice">行政区 <select id="district-choice">'+B.districts.items.map(r=>'<option>'+r[0]+'</option>').join('')+'</select></label><div id="district-readout"></div>';$('#district-choice').onchange=e=>showDistrict(e.target.value);showDistrict(B.districts.items[0][0]);$('#macro-meta').textContent='2025年度 · GDP及占比前三行业的增加值增速 · 行政区不同于子市场';}else $('#macro h2').innerHTML='信息服务业与金融业，<br>增长快于第三产业整体。';});

$('#space-dataset').querySelector('[value="history"]').textContent='历史走势';
})();
