(() => {
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.researchEditorial={
 scatter(rows,city){
  const valid=rows.filter(r=>Number.isFinite(r.rent)&&Number.isFinite(r.vacancy));
  if(valid.length<2)return '该季度的分区数据，<br>尚不足以比较。';
  const both=valid.filter(r=>r.rent>city.rent&&r.vacancy<city.vacancy).sort((a,b)=>b.rent-a.rent);
  if(both.length)return `${escape(both[0].area)}租金高于全市，<br>空置率仍低于全市。`;
  const byVac=valid.slice().sort((a,b)=>a.vacancy-b.vacancy),lo=byVac[0],hi=byVac.at(-1);
  return `${escape(lo.area)}与${escape(hi.area)}，<br>空置率相差${(hi.vacancy-lo.vacancy).toFixed(1)}个百分点。`;
 },
 distribution(values,city,metric){const valid=values.filter(Number.isFinite);if(!valid.length||!Number.isFinite(city))return '所选季度，<br>尚无完整分区数据。';return `${valid.filter(v=>v>city).length}个分区的${metric}，<br>高于全市水平。`;}
};
})();
