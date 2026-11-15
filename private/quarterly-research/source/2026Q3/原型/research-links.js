(() => {
const $=s=>document.querySelector(s);
$('#time-changes').onclick=e=>window.openResearchWorld('changes',{base:window.getResearchState().baseline==='quarter'?'quarter':'year'},e.currentTarget);
document.querySelectorAll('#supply-chart .supply-column').forEach((el,i)=>{const year=String(window.REPORT.forecast.years[i]).replace('F','');el.dataset.supplyYear=year;el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label','查看'+year+'年相关项目');el.addEventListener('click',()=>window.openResearchWorld('supply',{year,grade:$('#supply-grade').value},el));el.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();el.click();}});});
})();
