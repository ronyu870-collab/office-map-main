import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifySubmarketReading(page,{width,base,evidencePrefix='map-submarket'}) {
  const points=[['2025Q4',180,10],['2026Q1',0,0],['2026Q2',null,null],['2026Q3',170,13],['2026Q4',165,10],['2027Q1',160,9]].map(([period,rent,vacancyPct])=>({period,year:Number(period.slice(0,4)),quarter:Number(period.at(-1)),rent,vacancyPct,rentSamples:rent==null?0:2,vacancySamples:vacancyPct==null?0:3,rentArea:100,vacancyArea:100}));
  let withTrend=true;
  await page.route('**/api/map/submarket?*',route=>route.fulfill({json:{
    submarket:'CBD',stockCount:3,profileAvailable:true,profilePublished:true,
    profile:{submarket:'CBD',headline:'国际商务集聚区',overview:'区域介绍与已收录办公项目。',industries:'',transport:'',demographics:[],policies:[],insights:[],updatedAt:'2026-11-18T00:00:00Z',updatedBy:null},
    trends:{all:withTrend?points:[],a:withTrend?points:[],b:[]},trendError:false,quarterMethod:'same quarter',source:'building_metrics',
  }}));
  const layout=page.locator('.map-workspace-layout');
  const panel=page.getByRole('region',{name:'CBD',exact:true});
  const primary=panel.getByRole('button',{name:'查看全部项目',exact:true});
  const scroller=panel.locator('.workspace-scroll');
  const standard=page.locator('[data-map-submarket-panel][data-submarket-layout="standard"]');
  const expanded=page.locator('[data-map-submarket-panel][data-submarket-layout="expanded"]');
  const readyLayout=()=>page.locator('.map-workspace-layout[data-map-layout-ready="true"]').waitFor();
  const openResearch=async()=>{
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name:'CBD'}})));
    await panel.waitFor();
    await readyLayout();
  };
  const openTabbedReading=async()=>{
    if(await panel.getAttribute('data-submarket-layout')==='quick'){
      const read=panel.getByRole('button',{name:'阅读完整研究',exact:true});
      if(await read.isVisible())await read.click();
      else await clickWorkspaceAction(page,'展开到阅读高度');
    }
    await standard.waitFor();
    await readyLayout();
    await panel.getByRole('tablist',{name:'子市场研究内容',exact:true}).waitFor();
  };
  const assertMapReady=async()=>{
    await page.locator('.map-live-stats[aria-busy="false"]').waitFor({state:'attached'});
    assert.equal(await page.getByText('地图加载失败',{exact:true}).count(),0,`${evidencePrefix} ${width}: map is not reported as failed`);
  };
  const visitAllProjects=async()=>{
    await primary.click();
    const list=page.getByRole('region',{name:'项目列表',exact:true});
    await list.getByRole('button',{name:/^CBD甲楼(?:\s|$)/}).waitFor();
    await list.getByRole('button',{name:'返回子市场研究',exact:true}).click();
    await panel.waitFor();
  };

  await page.goto(new URL('/map',base).href);
  await page.waitForFunction(()=>window.__workspaceMap?.getCenter());
  const clear=page.getByRole('button',{name:'清空',exact:true});if(await clear.isVisible())await clear.click();
  await openResearch();
  const identityOnly=await page.locator('.map-workspace-layout[data-header-only]').count()>0;
  if(identityOnly)assert.equal(await panel.getByRole('region',{name:'市场核心指标',exact:true}).isVisible(),false,'identity summary does not expose clipped metric controls');
  await primary.waitFor();
  await panel.getByRole('heading',{name:'CBD',exact:true}).waitFor();
  // Compare one frame: separate boundingBox calls can straddle the mobile sheet transition.
  const titleActionOffset=await primary.evaluate(button=>{
    const title=button.closest('.workspace-panel-title-row')?.querySelector('h2');
    if(!title)return null;
    const actionBox=button.getBoundingClientRect(),titleBox=title.getBoundingClientRect();
    return Math.abs((actionBox.y+actionBox.height/2)-(titleBox.y+titleBox.height/2));
  });
  assert.ok(titleActionOffset!==null && titleActionOffset<2,`project action shares title row (offset ${titleActionOffset})`);
  if(identityOnly)await visitAllProjects();
  await openTabbedReading();

  const overviewTab=panel.getByRole('tab',{name:'市场概览',exact:true});
  const trendTab=panel.getByRole('tab',{name:'行情趋势',exact:true});
  const projectsTab=panel.getByRole('tab',{name:'代表项目',exact:true});
  await overviewTab.click();
  const overview=panel.getByRole('tabpanel',{name:'市场概览',exact:true});
  const metrics=overview.getByRole('region',{name:'市场核心指标',exact:true});
  const composition=overview.getByRole('region',{name:'楼宇构成',exact:true});
  await panel.getByText('国际商务集聚区',{exact:true}).waitFor();
  await panel.getByRole('tab',{name:'区域画像',exact:true}).click();
  await panel.getByRole('tabpanel',{name:'区域画像',exact:true}).getByText('区域介绍与已收录办公项目。',{exact:true}).waitFor();
  await overviewTab.click();
  await composition.getByText('甲级写字楼',{exact:true}).waitFor();
  await composition.getByText('乙级写字楼',{exact:true}).waitFor();
  assert.equal(await overview.locator('canvas').count(),0,'overview does not duplicate the trend charts');
  assert.ok((await metrics.boundingBox()).y<(await composition.boundingBox()).y,'core metrics precede the composition');
  const splitGeometry=()=>layout.evaluate(el=>{
    const research=el.querySelector('.map-workspace-right[data-open]');
    const left=el.querySelector('.map-workspace-left[data-open]');
    // The stable map canvas spans the stage underneath the panels. Layout offsets
    // measure the uncovered column without counting entry/resize transforms.
    return {stageWidth:el.clientWidth,researchWidth:research.offsetWidth,mapWidth:research.offsetLeft-(left ? left.offsetLeft+left.offsetWidth : 0)};
  });
  let adaptiveMapBudget;
  if(width===1536){
    const initial=await splitGeometry();
    const resize=page.getByRole('separator',{name:'调整业务工作区宽度',exact:true});
    await resize.press('End');
    adaptiveMapBudget=await splitGeometry();
    assert.ok(initial.researchWidth>520,'the default desktop split is wider than the old ceiling');
    assert.ok(adaptiveMapBudget.researchWidth>initial.researchWidth,'desktop research can be widened beyond the adaptive default');
    assert.ok(adaptiveMapBudget.mapWidth>=adaptiveMapBudget.stageWidth*.56-1,'even the widest desktop research split keeps the map budget');
  }

  await trendTab.click();
  const trend=panel.getByRole('region',{name:'租金与空置率趋势',exact:true});
  const grades=trend.getByRole('group',{name:'楼宇等级',exact:true});
  const grade=label=>grades.getByRole('button',{name:label,exact:true});
  const canvasLabels=['净有效租金季度趋势图','空置率季度趋势图'];
  const waitForCharts=async()=>{
    for(const [index,label] of canvasLabels.entries()){
      const rgb=index===0 ? [0,62,126] : [50,106,120];
      await page.waitForFunction(({label,rgb})=>{
        const canvas=document.querySelector(`[aria-label="${label}"] canvas`);
        if(!canvas?.width || !canvas.height)return false;
        const pixels=canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;
        if(!pixels)return false;
        for(let i=0;i<pixels.length;i+=4){
          if(pixels[i]===rgb[0] && pixels[i+1]===rgb[1] && pixels[i+2]===rgb[2] && pixels[i+3]===255)return true;
        }
        return false;
      },{label,rgb});
    }
  };
  await waitForCharts();
  assert.equal(await grade('甲乙级').getAttribute('aria-pressed'),'true');
  const rentCanvas=trend.getByRole('img',{name:'净有效租金季度趋势图',exact:true}).locator('canvas').first();
  const originalCanvas=await rentCanvas.elementHandle();
  await trend.getByRole('button',{name:'查看完整历史',exact:true}).click();
  assert.equal(await trend.getByText('2025Q4 至 2027Q1 · 离散观测',{exact:true}).count(),2);
  await waitForCharts();
  assert.ok(await rentCanvas.evaluate((next,original)=>next===original,originalCanvas),'history updates the existing chart canvas');
  await originalCanvas.dispose();
  await trend.getByRole('button',{name:'返回默认区间',exact:true}).click();
  assert.equal(await trend.getByText('2026Q3 至 2027Q1 · 另有早期观测',{exact:true}).count(),2);

  await grade('甲级').click();
  assert.equal(await grade('甲级').getAttribute('aria-pressed'),'true');
  await grade('乙级').click();
  await trend.getByText('当前等级暂无已发布的有效季度观测。',{exact:true}).waitFor();
  assert.equal(await trend.locator('canvas').count(),0,'empty grade does not render charts');
  await overviewTab.click();
  await composition.waitFor();
  await trendTab.click();
  assert.equal(await grade('乙级').getAttribute('aria-pressed'),'true','overview does not reset the trend grade');
  await grade('甲乙级').click();
  await waitForCharts();

  const surface=await page.evaluateHandle(()=>({map:window.__workspaceMap,container:document.querySelector('#map-container')}));
  if(width===1536)await trend.getByRole('button',{name:'展开图表',exact:true}).click();
  else await clickWorkspaceAction(page,'全屏阅读工作区');
  await expanded.waitFor();
  await page.waitForFunction(()=>Boolean(document.querySelector('#map-container')?.closest('[inert],[aria-hidden="true"],[hidden]')));
  await waitForCharts();

  if(identityOnly){
    const fullMetrics=panel.getByRole('region',{name:'市场核心指标',exact:true});
    for(const label of ['平均净有效租金','平均空置率','甲乙级项目']){
      const metric=fullMetrics.getByText(label,{exact:true}).locator('..');
      await metric.scrollIntoViewIfNeeded();
      const box=await metric.boundingBox(), reading=await scroller.boundingBox();
      assert.ok(box.y>=reading.y-1 && box.y+box.height<=reading.y+reading.height+1,'expanded reading exposes each full metric');
    }
  }

  const summary=trend.locator('summary').filter({hasText:'查看季度数据'});
  const table=trend.getByRole('table',{name:'季度租金与空置率',exact:true});
  await summary.focus();await page.keyboard.press('Enter');
  await table.waitFor();
  const rows=table.getByRole('row');assert.equal(await rows.count(),7);
  assert.match(await rows.nth(2).innerText(),/2026Q1\s+0\.0\s*2 个样本\s*100 ㎡\s+0\.0\s*3 个样本/);
  assert.match(await rows.nth(3).innerText(),/2026Q2\s+未收录\s*0 个样本\s+未收录\s*0 个样本/);
  await rows.last().scrollIntoViewIfNeeded();
  const tableBox=await table.boundingBox(), bounds=await scroller.boundingBox(), lastRow=await rows.last().boundingBox();
  assert.ok(tableBox.x>=bounds.x-1 && tableBox.x+tableBox.width<=bounds.x+bounds.width+1,'quarter table fits the reading area');
  assert.ok(lastRow.y>=bounds.y-1 && lastRow.y+lastRow.height<=bounds.y+bounds.height+1,'the last quarter scrolls fully into view');
  await summary.focus();await page.keyboard.press('Enter');
  await table.waitFor({state:'hidden'});

  await clickWorkspaceAction(page,'返回地图分屏');
  await standard.waitFor();
  await readyLayout();
  await page.waitForFunction(()=>{
    const current=document.querySelector('#map-container');
    return current && !current.closest('[inert],[aria-hidden="true"],[hidden]') && getComputedStyle(current).visibility==='visible' && current.clientWidth>0 && current.clientHeight>0;
  });
  assert.ok(await surface.evaluate(({map,container})=>window.__workspaceMap===map && document.querySelector('#map-container')===container),'full reading keeps the map container and SDK instance mounted');
  await surface.dispose();
  await assertMapReady();
  assert.equal(await trendTab.getAttribute('aria-selected'),'true','returning to split preserves the trend tab');
  if(adaptiveMapBudget){
    const restored=await splitGeometry();
    assert.ok(Math.abs(restored.researchWidth-adaptiveMapBudget.researchWidth)<=1,'split restores the desktop research width');
    assert.ok(Math.abs(restored.mapWidth-adaptiveMapBudget.mapWidth)<=1,'split restores the exposed desktop map width');
  }

  await projectsTab.click();
  const projects=panel.getByRole('tabpanel',{name:'代表项目',exact:true}).getByRole('region',{name:'代表性项目',exact:true});
  // Use the host's located CBD fixture and the actual project button, not a synthetic open event.
  await projects.getByRole('button',{name:'CBD甲楼',exact:true}).click();
  const building=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});
  await building.waitFor();
  await building.getByRole('button',{name:'返回子市场研究',exact:true}).click();
  await projects.waitFor();
  assert.equal(await projectsTab.getAttribute('aria-selected'),'true','building round trip preserves the representative projects tab');

  assert.equal(await panel.locator('.map-methodology-trigger').count(),0,'customer submarket reading does not expose statistical methodology');
  assert.equal(await panel.locator('a[target="_blank"]').count(),0,'representative projects do not expose research source links');

  await visitAllProjects();
  await projects.waitFor();
  assert.equal(await projectsTab.getAttribute('aria-selected'),'true','all-projects action still returns to the selected research tab');

  withTrend=false;
  await page.reload();await page.waitForFunction(()=>window.__workspaceMap?.getCenter());
  await openResearch();
  await openTabbedReading();
  await trendTab.click();
  const empty=trend.getByText('当前等级暂无已发布的有效季度观测。',{exact:true});
  await empty.waitFor();
  assert.ok((await empty.boundingBox()).height<=120,'settled empty trend uses content height');
  assert.equal(await trend.locator('canvas').count(),0);
  await assertMapReady();
  return {width,height:page.viewportSize().height,identityOnlyExpandedForReading:identityOnly,coreMetricsFirst:true,primaryActionInTitleRow:true,
    overviewCompositionAndPublishedIntro:true,adaptiveMapBudget,fullReadingPreservesMapCanvas:true,trendTabPreserved:true,
    canvasRendered:true,gradeNavigation:true,keyboardQuarterTable:true,zeroAndMissingRemainDistinct:true,tableFitsPanel:true,
    representativeProjectRoundTripPreservesTab:true,listRoundTripPreservesRegion:true,settledEmptyTrendUsesContentHeight:true};
}
