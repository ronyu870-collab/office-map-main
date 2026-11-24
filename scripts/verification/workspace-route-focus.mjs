import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifyRouteFocus(page,{base,width}) {
  const project='10000000-1111-4111-8111-111111111111';
  await page.route('**/api/intelligence/query/capabilities',route=>route.fulfill({json:{enabled:true,examples:[]}}));
  await page.route('https://example.supabase.co/rest/v1/user_roles*',route=>route.fulfill({headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, OPTIONS'},json:[{role:'admin',session_id:'45678901-1111-4111-8111-111111111111'}]}));
  await page.goto(new URL(`/map?building=${project}`,base).href);
  const panel=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});await panel.waitFor();
  if(width<640||width===844)await clickWorkspaceAction(page,'全屏阅读工作区');
  await panel.getByRole('tab',{name:'行情',exact:true}).click();
  const ai=panel.getByRole('button',{name:'AI 分析',exact:true});await ai.waitFor();await ai.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const before=await panel.locator('.workspace-building-scroll').evaluate(node=>node.scrollTop);
  await ai.click();await page.waitForURL(url=>url.searchParams.get('aiBuilding')===project&&url.hash==='#colliers-ai');
  await page.goBack();await panel.waitFor();
  await page.waitForFunction(()=>document.activeElement?.matches('.workspace-building .workspace-panel-header h2'),undefined,{timeout:3000});
  assert.equal(await panel.getByRole('heading',{name:/^CBD甲楼/}).evaluate(node=>node===document.activeElement),true);
  assert.equal(await panel.getByRole('tab',{name:'行情',exact:true}).getAttribute('aria-selected'),'true');
  const after=await panel.locator('.workspace-building-scroll').evaluate(node=>node.scrollTop);
  assert.ok(Math.abs(after-before)<=1,'restoring title focus does not move the saved reading scroll');
  const box=await panel.getByRole('heading',{name:/^CBD甲楼/}).boundingBox();
  assert.ok(box.width>0&&box.height>0&&box.y>=0&&box.y+box.height<=page.viewportSize().height,'restored focus is visibly readable');
  return {width,role:'admin',routeFocus:{titleFocused:true,projectAndMarketTabRetained:true,before,after}};
}
