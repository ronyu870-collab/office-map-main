import assert from 'node:assert/strict';

export async function verifySubmarketReading(page,{width,base,evidencePrefix='map-submarket'}) {
  const points=[['2025Q4',180,10],['2026Q1',0,0],['2026Q2',null,null],['2026Q3',170,13]].map(([period,rent,vacancyPct])=>({period,year:Number(period.slice(0,4)),quarter:Number(period.at(-1)),rent,vacancyPct,rentSamples:rent==null?0:2,vacancySamples:vacancyPct==null?0:3,rentArea:100,vacancyArea:100}));
  let withTrend=true;
  await page.route('**/api/map/submarket?*',route=>route.fulfill({json:{
    submarket:'CBD',stockCount:3,profileAvailable:true,profilePublished:true,
    profile:{submarket:'CBD',headline:'国际商务集聚区',overview:'区域介绍与已收录办公项目。',industries:'',transport:'',demographics:[],policies:[],insights:[],updatedAt:'2026-11-18T00:00:00Z',updatedBy:null},
    trends:{all:withTrend?points:[],a:withTrend?points:[],b:[]},trendError:false,quarterMethod:'same quarter',source:'building_metrics',
  }}));
  await page.goto(new URL('/map',base).href);
  await page.waitForFunction(()=>window.__workspaceMap?.getCenter());
  const clear=page.getByRole('button',{name:'清空',exact:true});if(await clear.isVisible())await clear.click();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name:'CBD'}})));
  const panel=page.getByRole('region',{name:'CBD',exact:true});await panel.waitFor();
  await panel.getByText('国际商务集聚区',{exact:true}).waitFor();
  const capture=async name=>{
    if(!await page.locator('#map-container').evaluate(el=>Boolean(el.closest('[inert],[aria-hidden="true"],[hidden]'))))
      await page.locator('.map-live-stats[aria-busy="false"]').waitFor({state:'attached'});
    const failure=page.getByText('地图加载失败',{exact:true});
    if(await failure.count()){
      console.error('submarket map failure',{width,canvas:await page.locator('#map-container').boundingBox(),message:await failure.locator('..').textContent(),ancestors:await page.locator('#map-container').evaluate(el=>{const rows=[];for(let node=el;node&&rows.length<7;node=node.parentElement)rows.push({class:node.className,hidden:node.getAttribute('aria-hidden'),inert:node.inert,rect:[node.clientWidth,node.clientHeight]});return rows;})});
      await page.screenshot({path:`/tmp/${evidencePrefix}-failure-${width}.png`});
    }
    assert.equal(await failure.count(),0,'short-stage map is not reported as a failed surface');
    await page.waitForFunction(()=>{
      const canvases=[...document.querySelectorAll('[data-map-submarket-panel] canvas')];
      if(!canvases.length)return true;
      const pixels=canvases.map(canvas=>canvas.toDataURL()).join('|');
      const previous=window.__submarketCapturePixels;
      if(!previous || previous.pixels!==pixels){window.__submarketCapturePixels={pixels,since:performance.now()};return false;}
      return performance.now()-previous.since>=200;
    });
    await page.waitForFunction(()=>!document.querySelector('.map-workspace-layout [data-exiting]'));
    await page.screenshot({animations:'disabled',path:`/tmp/${evidencePrefix}-${name}-${width}.png`});
  };
  await panel.locator('canvas').waitFor();
  await capture('summary');
  const metrics=await panel.getByRole('region',{name:'市场核心指标',exact:true}).boundingBox();
  if(await page.locator('.map-workspace-layout[data-short-stage]').count()){const bounds=await panel.boundingBox();assert.ok(metrics.y+metrics.height<=bounds.y+bounds.height+1,`short summary contains all three market values: ${JSON.stringify({metrics,bounds})}`);}
  const intro=await panel.getByRole('region',{name:'区域定位',exact:true}).boundingBox();
  assert.ok(metrics.y<intro.y,'core metrics precede introduction');
  const primary=await panel.getByRole('button',{name:'查看全部项目',exact:true}).boundingBox();
  const title=await panel.getByRole('heading',{name:'CBD',exact:true}).boundingBox();
  assert.ok(Math.abs((primary.y+primary.height/2)-(title.y+title.height/2))<2,'project action shares title row');
  assert.equal(await panel.getByRole('region',{name:'区域特点',exact:true}).count(),0);
  assert.equal(await panel.getByRole('region',{name:'楼宇结构',exact:true}).count(),1);
  if(await panel.locator('.workspace-mobile-tools > summary').isVisible()){
    await panel.locator('.workspace-mobile-tools > summary').click();
    await page.getByRole('button',{name:'全屏阅读工作区',exact:true}).click();
  } else if(width===844) await panel.getByRole('button',{name:'全屏阅读工作区',exact:true}).click();
  await panel.getByRole('tab',{name:'行情趋势',exact:true}).click();
  const summary=panel.locator('.submarket-quarter-data > summary');
  await summary.waitFor();await panel.locator('canvas').waitFor();
  await capture('trend');
  await summary.focus();await page.keyboard.press('Enter');
  await panel.getByRole('table',{name:'季度租金与空置率'}).waitFor();
  assert.equal(await panel.locator('.submarket-quarter-data').getAttribute('open'),'');
  const rows=panel.getByRole('row');assert.equal(await rows.count(),5);
  assert.match(await rows.nth(2).innerText(),/2026Q1\s+0\.0\s+2 个样本\s+0\.0\s+3 个样本/);
  assert.match(await rows.nth(3).innerText(),/2026Q2\s+—\s+0 个样本\s+—\s+0 个样本/);
  await rows.nth(4).scrollIntoViewIfNeeded();
  const table=await panel.getByRole('table').boundingBox(),bounds=await panel.boundingBox();
  assert.ok(table.x>=bounds.x && table.x+table.width<=bounds.x+bounds.width+1,'quarter table fits panel');
  await capture('quarters');
  await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await panel.locator('.submarket-quarter-data').getAttribute('open'),null);
  await panel.getByRole('button',{name:'乙级',exact:true}).click();
  await panel.getByText('当前等级暂无有效季度走势',{exact:true}).waitFor();
  await panel.getByRole('tab',{name:'市场概览',exact:true}).click();
  await panel.locator('canvas').waitFor();
  await panel.getByRole('button',{name:'查看全部项目',exact:true}).click();
  await page.getByRole('region',{name:'项目列表',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回子市场研究',exact:true}).click();
  await panel.waitFor();
  withTrend=false;
  await page.reload();await page.waitForFunction(()=>window.__workspaceMap?.getCenter());
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name:'CBD'}})));
  await panel.getByText('近期暂无足够的同季度可比数据',{exact:true}).waitFor();
  const empty=await panel.getByText('近期暂无足够的同季度可比数据',{exact:true}).locator('..').boundingBox();
  assert.ok(empty.height<=120,'settled empty trend uses content height');
  await capture('empty');
  if(await page.locator('#map-container').evaluate(el=>Boolean(el.closest('[inert],[aria-hidden="true"],[hidden]')))){
    const tools=panel.locator('.workspace-mobile-tools > summary');
    if(await tools.isVisible())await tools.click();
    await page.getByRole('button',{name:'返回地图分屏',exact:true}).click();
    await page.locator('.map-live-stats[aria-busy="false"]').waitFor({state:'attached'});
    await capture('restored');
  }
  return {width,height:page.viewportSize().height,coreMetricsFirst:true,primaryActionInTitleRow:true,introductionOnlyUsesBuildingComposition:true,canvasRendered:true,keyboardQuarterTable:true,zeroAndMissingRemainDistinct:true,tableFitsPanel:true,listRoundTripPreservesRegion:true,overviewRestoresAllGradesAfterEmptyGrade:true,settledEmptyTrendUsesContentHeight:true,fullReadingReloadRestoresMapWithoutFalseError:true};
}
