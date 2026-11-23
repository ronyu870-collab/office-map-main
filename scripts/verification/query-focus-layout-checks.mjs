import assert from 'node:assert/strict';

// Controlled delayed-content/layout changes exercise the actual keyboard owner.
// These are isolated DOM fixtures, not a claim about the exact CI race trigger.
export async function checkKeyboardLayoutContinuity(page) {
  const paint=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await page.evaluate(()=>{const tail=document.createElement('div');tail.dataset.keyboardLayoutTail='';tail.style.height='1000px';tail.textContent='隔离的后续问答布局';document.querySelector('[aria-label="对话记录"]').firstElementChild.append(tail);});
  await page.locator('#home-query').focus();
  let found=false;
  for(let index=0;index<100;index++){
    await page.keyboard.press('Tab');
    found=await page.evaluate(()=>{
      const target=document.activeElement;
      if(target?.tagName!=='BUTTON'||target.textContent.trim()!=='复制结论'||!target.closest('[aria-label="对话记录"]'))return false;
      window.__keyboardLayoutTarget=target;return true;
    });
    if(found)break;
  }
  assert.ok(found,'keyboard reaches a real answer control');
  const facts=()=>page.evaluate(()=>{
    const target=window.__keyboardLayoutTarget,host=target.closest('[aria-label="对话记录"]');
    const box=target.getBoundingClientRect(),viewport=host.getBoundingClientRect();
    return {top:box.top,bottom:box.bottom,viewportTop:viewport.top,viewportBottom:viewport.bottom,scrollTop:host.scrollTop,background:document.querySelector('main > div')?.scrollTop||0,focused:target===document.activeElement,visible:box.bottom>viewport.top&&box.top<viewport.bottom};
  });
  const before=await facts();assert.ok(before.visible&&before.focused);
  await page.evaluate(()=>{
    const target=window.__keyboardLayoutTarget,turn=target.closest('[data-query-turn]');
    if(!turn)throw new Error('Actual query turn missing');
    const late=document.createElement('div');late.dataset.keyboardLayoutFixture='';late.style.height='600px';late.textContent='隔离的延迟排版内容';
    turn.prepend(late);
  });
  try{
    await paint();const inserted=await facts();assert.ok(inserted.visible&&inserted.focused,`delayed content must keep the keyboard control visible: ${JSON.stringify({before,inserted})}`);
    await page.evaluate(()=>{document.querySelector('[data-keyboard-layout-fixture]').style.height='1200px';});
    await paint();const resized=await facts();assert.ok(resized.visible&&resized.focused,`later size change must keep the keyboard control visible: ${JSON.stringify({inserted,resized})}`);
    await page.getByRole('region',{name:'对话记录',exact:true}).dispatchEvent('wheel',{deltaY:-400});
    await page.evaluate(()=>{const host=document.querySelector('[aria-label="对话记录"]');host.scrollTop=0;document.querySelector('[data-keyboard-layout-fixture]').style.height='1800px';});
    await paint();const takeover=await facts();assert.equal(takeover.scrollTop,0,'reader movement takes over from the old keyboard target');
    assert.equal(inserted.background,before.background);assert.equal(resized.background,before.background);assert.equal(takeover.background,before.background);
    return {before,inserted,resized,takeover,backgroundStayedFixed:true};
  }finally{
    await page.getByRole('region',{name:'对话记录',exact:true}).dispatchEvent('wheel',{deltaY:0});
    await page.evaluate(()=>{document.querySelector('[data-keyboard-layout-fixture]')?.remove();document.querySelector('[data-keyboard-layout-tail]')?.remove();delete window.__keyboardLayoutTarget;});
  }
}
