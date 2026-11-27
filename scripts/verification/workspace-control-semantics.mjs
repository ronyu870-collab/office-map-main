import assert from 'node:assert/strict';
import { clickWorkspaceAction, ensureWorkspacePhotoOpen } from './workspace-actions.mjs';
export async function verifyControlSemantics(page,{width,base,role=width===1024?'admin':'viewer'}) {
  // Do not consume the combined suite's intentional first-photo 403.
  let releasePhoto, photoFailure = true;
  const photoGate=new Promise(resolve=>{releasePhoto=resolve;});
  await page.route('**/api/map/building-photos?*',async route=>{
    await photoGate;
    return photoFailure ? route.fulfill({status:403,json:{error:'isolated permission denial'}})
      : route.fulfill({json:{url:'https://synthetic.invalid/semantics.svg',is_preview:false,can_download:true,source_url:'',source_name:''}});
  });
  await page.route('https://example.supabase.co/rest/v1/user_roles*',route=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},json:[{role,session_id:'45678901-1111-4111-8111-111111111111'}]}));
  const cdp=await page.context().newCDPSession(page),surfaces=[];
  const inspect=async label=>{
    const {nodes}=await cdp.send('Accessibility.getFullAXTree');
    const controls=nodes.filter(n=>!n.ignored&&['button','link','checkbox','textbox','searchbox','combobox','tab','slider','separator','DisclosureTriangle','spinbutton'].includes(n.role?.value));
    const unnamed=controls.filter(n=>!n.name?.value?.trim()).map(n=>({role:n.role.value,id:n.backendDOMNodeId}));
    for (const entry of unnamed) entry.html=(await cdp.send('DOM.getOuterHTML',{backendNodeId:entry.id})).outerHTML;
    const states=controls.filter(n=>n.properties?.some(p=>['selected','pressed','disabled','expanded','checked'].includes(p.name))).map(n=>({name:n.name?.value,role:n.role.value,states:Object.fromEntries(n.properties.filter(p=>['selected','pressed','disabled','expanded','checked'].includes(p.name)).map(p=>[p.name,p.value.value]))}));
    surfaces.push({surface:label,controls:controls.length,unnamed,states});
    assert.deepEqual(unnamed,[],`${label}: every exposed control has an accessible name`);
  };
  await page.goto(new URL('/map',base).href);
  await page.locator('#map-container [data-building-id]').first().waitFor();
  await inspect('map');
  const legend=page.locator('.map-workspace-legend > summary');
  assert.match(await legend.ariaSnapshot(),/图例/, 'the compact icon retains its accessible name');
  assert.equal(await legend.getAttribute('aria-expanded'),'false');
  await page.locator('.map-workspace-legend > summary').click();await inspect('legend');assert.equal(await legend.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'筛选',exact:true}).click();await page.locator('.map-workspace-filter').waitFor();await inspect('filters');
  await page.getByRole('button',{name:'筛选',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name:'CBD'}})));
  await page.getByRole('button',{name:'查看全部项目',exact:true}).waitFor();await inspect('submarket');
  await page.getByRole('button',{name:'查看全部项目',exact:true}).click();
  const list=page.getByRole('region',{name:'项目列表',exact:true});await list.waitFor();await inspect('list');
  await list.getByRole('button',{name:/^CBD甲楼/}).click();
  const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});await detail.waitFor();
  const compact = await page.locator('.map-workspace-layout').getAttribute('data-compact') !== null;
  if (!compact) await detail.locator('[data-building-photo-trigger][aria-expanded="true"]').waitFor({state:'visible'});
  if(width<640||width===844)await clickWorkspaceAction(page,'全屏阅读工作区');
  await inspect('overview');
  await ensureWorkspacePhotoOpen(detail);
  await detail.locator('[data-building-photo-status]').filter({hasText:'正在加载图片'}).waitFor({state:'visible'});
  await inspect('photo-loading');releasePhoto();
  await detail.getByRole('button',{name:'重试',exact:true}).waitFor();
  assert.ok((await detail.locator('[data-building-photo-status]').innerText()).trim().length>0, 'permission failure has visible explanatory text');
  await inspect('photo-error');photoFailure=false;
  await detail.getByRole('button',{name:'重试',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-building-photo]:not([hidden])')?.naturalWidth>0);
  assert.equal(await detail.getByRole('button',{name:'上一张',exact:true}).getAttribute('aria-disabled'),'true');
  await inspect('photo');
  await detail.getByRole('button',{name:'查看大图',exact:true}).click();
  await page.getByRole('dialog').waitFor();await inspect('lightbox');await page.keyboard.press('Escape');
  await detail.getByRole('tab',{name:'行情',exact:true}).click();await inspect('market');
  assert.equal(await detail.getByRole('tab',{name:'行情',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await detail.getByRole('button',{name:'编辑指标',exact:true}).count(),role==='admin'?1:0,'maintenance follows the isolated role');
  const actionLayout=await detail.locator('.workspace-business-actions').evaluateAll(groups=>groups.map(group=>({
    columns:getComputedStyle(group).gridTemplateColumns.split(' ').length,
    buttons:Array.from(group.querySelectorAll('button:not([hidden])')).map(button=>{const box=button.getBoundingClientRect();return {text:button.textContent.trim(),left:box.left,top:box.top,width:box.width,height:box.height};}),
  })));
  for(const group of actionLayout){
    assert.equal(group.columns,2,'task groups retain two stable action columns');
    assert.ok(group.buttons.every(button=>button.width>60&&button.height>=36),'task actions retain useful dimensions');
    assert.ok(new Set(group.buttons.map(button=>Math.round(button.left))).size<=2,'actions align to two column edges');
  }
  const action=detail.getByRole('button',{name:'周边项目对比',exact:true});
  await action.scrollIntoViewIfNeeded();await page.mouse.move(0,0);
  const background=()=>action.evaluate(async node=>{
    let previous='',stableSince=performance.now();const deadline=performance.now()+3000;
    while(performance.now()<deadline){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const color=getComputedStyle(node).backgroundColor;
      if(color!==previous){previous=color;stableSince=performance.now();}
      if(performance.now()-stableSince>=160)return color;
    }
    throw new Error('action feedback did not settle');
  });
  const normal=await background();await action.hover();
  await page.waitForFunction(({normal})=>getComputedStyle(document.querySelector('[data-map-action="nearby-compare"]')).backgroundColor!==normal,{normal});
  const hovered=await background();assert.notEqual(hovered,normal);await page.mouse.down();
  const pressed=await background();assert.notEqual(pressed,hovered,'pressed feedback differs after both states settle');assert.equal(await action.evaluate(node=>node.matches(':active')),true);await page.mouse.move(0,0);await page.mouse.up();
  await action.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  assert.equal(await action.evaluate(node=>node===document.activeElement&&node.matches(':focus-visible')&&parseFloat(getComputedStyle(node).outlineWidth)>=2),true,'keyboard focus has a visible outline');
  await detail.getByRole('button',{name:'季度趋势',exact:true}).click();await detail.locator('#info-chart-container canvas').waitFor();await inspect('trend');assert.equal(await detail.getByRole('button',{name:'净有效租金',exact:true}).getAttribute('aria-pressed'),'true');
  await detail.getByRole('tab',{name:'成交与资料',exact:true}).click();await inspect('materials');
  await detail.getByRole('button',{name:'楼书与资料',exact:true}).click();
  await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'查看原件',exact:true}).waitFor();await inspect('material-dialog');
  await page.getByRole('button',{name:'查看原件',exact:true}).click();await page.getByRole('button',{name:'放大原件',exact:true}).waitFor();await inspect('material-original');
  const shrink=page.getByRole('button',{name:'缩小原件',exact:true});await shrink.click();await shrink.click();
  assert.equal(await shrink.isDisabled(),true,'zoom limit uses native disabled state');
  await inspect('material-zoom-limit');
  const last=surfaces.at(-1).states.find(control=>control.name==='缩小原件');
  assert.equal(last.states.disabled,true,'disabled state is exposed in the browser accessibility tree');
  await page.keyboard.press('Escape');
  await page.goto(new URL('/map',base).href);
  await page.locator('#map-container [data-building-id]').first().waitFor();
  const fullList=page.getByRole('button',{name:'完整列表',exact:true});
  if(!await fullList.isVisible())await page.locator('.map-header-navigation-mobile summary').click();
  await fullList.click();await page.getByRole('region',{name:'完整楼宇列表',exact:true}).waitFor();await inspect('full-list');
  await cdp.detach();
  return {width,role,surfaces,actionLayout,actionStates:{normal,hovered,pressed,keyboardFocusVisible:true}};
}
