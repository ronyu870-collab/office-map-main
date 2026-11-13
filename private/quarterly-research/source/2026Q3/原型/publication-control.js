(() => {
 const select=document.createElement('select');select.id='publication';select.setAttribute('aria-label','选择报告季度');select.add(new Option('2026 Q3','2026Q3'));select.add(new Option('2026 Q2','2026Q2'));document.querySelector('.edition-label').before(select);document.querySelector('.edition-label').hidden=true;
 select.onchange=()=>{if(window.parent===window){select.value='2026Q3';return;}window.parent.postMessage({type:'research-edition',edition:select.value},'*');};
 const home=document.createElement('button');home.className='contents-toggle research-home';home.textContent='返回系统';home.onclick=()=>{if(parent!==window)parent.postMessage({type:'research-home'},'*');};home.hidden=parent===window;document.querySelector('.header').append(home);
 window.paintPublication=()=>{};
})();
