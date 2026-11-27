import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifySubmarketReading(page,{width,base,evidencePrefix='map-submarket'}) {
  const points=[['2025Q4',180,10],['2026Q1',0,0],['2026Q2',null,null],['2026Q3',170,13],['2026Q4',165,10],['2027Q1',160,9]].map(([period,rent,vacancyPct])=>({period,year:Number(period.slice(0,4)),quarter:Number(period.at(-1)),rent,vacancyPct,rentSamples:rent==null?0:2,vacancySamples:vacancyPct==null?0:3,rentArea:100,vacancyArea:100}));
  let withTrend=true, withStructured=false;
  const cbdEdition=JSON.parse(await readFile(new URL('../../data/submarket-research/2026-11-27/cbd.json',import.meta.url),'utf8'));
  await page.route('**/api/map/submarket?*',route=>{
    const market=new URL(route.request().url()).searchParams.get('submarket');
    if(['上地','望京-酒仙桥','四季青'].includes(market)){
      const mixed=market==='望京-酒仙桥', sparse=market==='四季青';
      const park=points.filter(p=>p.period==='2026Q4').map(p=>({...p,rent:101,vacancyPct:20,rentSamples:sparse?1:3,vacancySamples:sparse?1:3,stockArea:50000,stockSamples:sparse?1:3}));
      return route.fulfill({json:{submarket:market,stockCount:mixed?3:0,
        marketProducts:{type:mixed?'mixed':'park',officeCount:mixed?3:0,parkCount:sparse?6:3},
        profileAvailable:true,profilePublished:false,profile:{submarket:market,headline:'',overview:'',industries:'',transport:'',demographics:[],policies:[],insights:[],updatedAt:null,updatedBy:null},
        trends:{all:mixed?points:[],a:[],b:[],park},trendError:false,quarterMethod:'same quarter',source:'building_metrics'}});
    }
    return route.fulfill({json:{
    submarket:'CBD',stockCount:3,profileAvailable:true,profilePublished:true,
    profile:{submarket:'CBD',headline:withStructured?cbdEdition.positioning:'国际商务集聚区',overview:'区域介绍与已收录办公项目。',industries:'',transport:'',demographics:[],policies:[],insights:[],updatedAt:'2026-11-18T00:00:00Z',updatedBy:null,...(withStructured?{research:cbdEdition}:{})},
    trends:{all:withTrend?points:[],a:withTrend?points:[],b:[]},trendError:false,quarterMethod:'same quarter',source:'building_metrics',
  }});});
  // Isolated, synthetic asset observations exercise the actual workbench, not the
  // production database. The first CBD point uses the host's real fixture ID.
  let assetReads=0;
  await page.route('**/api/map/data?*',route=>{
    const params=new URL(route.request().url()).searchParams;
    if(params.get('mode')!=='research-assets')return route.fallback();
    assetReads++;
    const year=Number(params.get('year')),quarter=Number(params.get('quarter'));
    const names=params.getAll('submarket');
    const assets=names.flatMap(name=>Array.from({length:10},(_,index)=>{
      const grade=name==='上地'?'BP':name==='望京-酒仙桥'&&index>=5?'BP':index<8?'A':'B';
      const id=name==='CBD'&&index===0?'10000000-1111-4111-8111-111111111111':name+'-research-'+index;
      return {id,name:name==='CBD'&&index===0?'CBD甲楼':name+'分析项目'+index,submarket:name,grade,
        metrics:[{record_year:year,record_quarter:quarter,is_locked:true,is_draft:false,total_area:10000+1000*index,net_effective_rent:80+10*index,vacant_area:500+100*index}]};
    }));
    return route.fulfill({json:{period:year*4+quarter-1,assets,supplies:[],demand:{},demandAvailable:true,contexts:{}}});
  });
  const layout=page.locator('.map-workspace-layout');
  const panel=page.getByRole('region',{name:'CBD',exact:true});
  const primary=panel.getByRole('button',{name:'查看全部项目',exact:true});
  const scroller=panel.locator('.workspace-scroll');
  const standard=page.locator('[data-map-submarket-panel][data-submarket-layout="standard"]');
  const expanded=page.locator('[data-map-submarket-panel][data-submarket-layout="expanded"]');
  const readyLayout=()=>page.locator('.map-workspace-layout[data-map-layout-ready="true"]').waitFor();
  const exactAnalysisSelect=async(analysis,label)=>{
    // Validate the accessible role and exact label separately. This catches
    // accidental nested option text in labels before an opaque action timeout.
    const control=analysis.getByRole('combobox',{name:label,exact:true});
    await control.waitFor({state:'visible'});
    assert.equal(await analysis.getByLabel(label,{exact:true}).count(),1,'exact associated label: '+label);
    assert.equal(await control.evaluate((element,expected)=>element.labels?.length===1
      && element.labels[0].textContent===expected && element.labels[0].htmlFor===element.id
      && !element.labels[0].contains(element),label),true,'standalone native label: '+label);
    return control;
  };
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
  // The host fixture has three identical same-quarter rents, two with unusable
  // coordinates. The actual representative must prefer its locatable equivalent,
  // rather than relying on Chinese/Latin name collation or a synthetic open event.
  const representative=projects.getByRole('button',{name:'CBD甲楼',exact:true});
  await projects.getByRole('heading',{name:'代表性项目',exact:true}).waitFor();
  await representative.waitFor({state:'visible'});
  await representative.click();
  const building=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});
  await building.waitFor();
  await building.getByRole('button',{name:'返回子市场研究',exact:true}).click();
  await projects.waitFor();
  assert.equal(await projectsTab.getAttribute('aria-selected'),'true','building round trip preserves the representative projects tab');

  assert.equal(await panel.locator('.map-methodology-trigger').count(),0,'customer submarket reading does not expose statistical methodology');
  // The shared photo viewer pre-renders three anchors, including hidden license
  // and original-image controls. These are media provenance/actions, not research
  // citations. Only allow those exact controls inside the real gallery; still
  // reject all other anchors, even ones without target="_blank" or currently hidden.
  const researchLinks = await projects.locator('a').evaluateAll(links => links
    .filter(link => !(link.closest('.workspace-building-photos [data-building-photo-gallery]') &&
      link.matches('[data-building-photo-source], [data-building-photo-license], [data-building-photo-original]')))
    .map(link => ({ text: link.textContent?.trim(), href: link.getAttribute('href') })));
  assert.deepEqual(researchLinks, [], 'representative projects do not expose research source links');

  await visitAllProjects();
  await projects.waitFor();
  assert.equal(await projectsTab.getAttribute('aria-selected'),'true','all-projects action still returns to the selected research tab');
  if(width===1536){
    assert.equal(assetReads,0,'market analysis does not read on map startup or ordinary project reading');
    const analysis=projects.getByRole('region',{name:'市场深度分析',exact:true});
    await analysis.getByRole('button',{name:'市场深度分析与区域比较',exact:true}).click();
    const distribution=analysis.getByRole('region',{name:'租金价格分布',exact:true});
    await distribution.waitFor();
    await exactAnalysisSelect(analysis,'查询季度');
    await exactAnalysisSelect(analysis,'产品范围');
    await analysis.getByRole('img',{name:'同季度楼宇净有效租金与空置率散点图',exact:true}).locator('canvas').waitFor();
    assert.equal(assetReads,1,'one request serves distribution and scatter');
    const ranges=distribution.getByRole('group',{name:'选择租金区间查看楼宇',exact:true});
    await ranges.getByRole('button').first().click();
    await distribution.getByRole('button',{name:/CBD甲楼/}).click();
    await building.waitFor();
    await building.getByRole('button',{name:'返回子市场研究',exact:true}).click();
    await distribution.waitFor();
    await analysis.getByRole('button',{name:'添加比较区域',exact:true}).click();
    const regionSelect=await exactAnalysisSelect(analysis,'比较区域 1');
    await regionSelect.selectOption('上地');
    await analysis.getByRole('table',{name:'子市场同季度比较',exact:true}).waitFor();
    assert.equal(await analysis.getByRole('rowheader',{name:'上地',exact:true}).count(),1);
    await analysis.getByRole('button',{name:'添加比较区域',exact:true}).click();
    const second=await exactAnalysisSelect(analysis,'比较区域 2');
    assert.equal(await second.locator('option[value="上地"]').count(),0,'selected markets cannot be added twice');
    await second.selectOption('望京-酒仙桥');
    await analysis.getByRole('rowheader',{name:'望京-酒仙桥',exact:true}).waitFor();
    await analysis.getByRole('button',{name:'移除比较区域 2',exact:true}).click();
    await analysis.getByRole('rowheader',{name:'上地',exact:true}).waitFor();
    assert.equal(await analysis.getByRole('combobox',{name:'比较区域 2',exact:true}).count(),0);
    await analysis.getByRole('button',{name:'收起市场深度分析',exact:true}).click();
  }

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
  // Exercise the actual published CBD edition separately from the legacy fixture.
  withStructured=true;withTrend=true;
  await page.reload();await page.waitForFunction(()=>window.__workspaceMap?.getCenter());
  await openResearch();await openTabbedReading();await overviewTab.click();
  await page.locator('[data-map-submarket-panel][data-submarket-featured="true"]').waitFor();
  const lead=overview.getByRole('region',{name:'市场观察',exact:true});
  await lead.getByRole('heading',{name:cbdEdition.observations[0].title,exact:true}).waitFor();
  assert.ok((await metrics.boundingBox()).y<(await lead.boundingBox()).y,'CBD core metrics precede the single lead');
  assert.equal(await lead.getByRole('heading',{level:3}).count(),1,'CBD overview is not four research paragraphs');
  assert.equal(await overview.locator('canvas').count(),0,'CBD overview remains independent of chart runtime');
  assert.equal(await panel.locator('.workspace-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'CBD overview fits its reading width');
  await clickWorkspaceAction(page,'全屏阅读工作区');await expanded.waitFor();
  const fullMetrics=panel.getByRole('region',{name:'市场核心指标',exact:true});
  const fullSupply=panel.getByRole('region',{name:'供应与竞争格局',exact:true});
  await fullSupply.waitFor();
  assert.ok((await fullMetrics.boundingBox()).y<(await fullSupply.boundingBox()).y,'full CBD research starts with market data');
  assert.ok((await panel.getByRole('region',{name:'产业及租赁需求',exact:true}).boundingBox()).y>(await fullSupply.boundingBox()).y,'research chapters use successive thematic rows');
  assert.equal(await panel.locator('.workspace-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'full CBD research has no horizontal overflow');
  for(const source of cbdEdition.sources.filter(item=>item.scopeType==='external_market')){
    assert.ok(!(await panel.innerText()).includes(source.publisher),'client research excludes provider names');
  }
  await clickWorkspaceAction(page,'返回地图分屏');await standard.waitFor();await assertMapReady();
  // The synthetic API is the regression fixture, not published market data.
  if(width===1536){
    for(const market of ['上地','望京-酒仙桥','四季青']){
      await page.evaluate(name=>window.dispatchEvent(new CustomEvent('map-submarket-open',{detail:{name}})),market);
      const productPanel=page.getByRole('region',{name:market,exact:true});
      await productPanel.waitFor();
      if(await productPanel.getAttribute('data-submarket-layout')==='quick'){
        const read=productPanel.getByRole('button',{name:'阅读完整研究',exact:true});
        if(await read.isVisible())await read.click();else await clickWorkspaceAction(page,'展开到阅读高度');
      }
      await productPanel.getByRole('tab',{name:'市场概览',exact:true}).click();
      const type=market==='望京-酒仙桥'?'mixed':'park';
      await productPanel.getByText('完整子市场 · 产业园',{exact:true}).waitFor();
      assert.equal(await productPanel.getAttribute('data-submarket-market-type'),type);
      if(type==='mixed')await productPanel.getByRole('region',{name:'同季度产品比较'}).waitFor();
      if(market==='四季青')await productPanel.getByText(/暂不形成区域行情/).waitFor();
      else await productPanel.locator('[data-research-product="park"]').getByText('101.0',{exact:true}).waitFor();
      await productPanel.getByRole('tab',{name:'行情趋势',exact:true}).click();
      if(type==='mixed')await productPanel.getByRole('group',{name:'研究产品类型'}).getByRole('button',{name:'产业园',exact:true}).click();
      else assert.equal(await productPanel.getByRole('group',{name:'楼宇等级'}).count(),0);
      if(market==='四季青'){
        await productPanel.getByText('暂无具代表性的季度行情。',{exact:true}).waitFor();
        assert.equal(await productPanel.locator('canvas').count(),0);
      }
      await productPanel.getByText('完整子市场 · 产业园',{exact:true}).waitFor();
      if(market!=='四季青'){
        await productPanel.getByRole('tab',{name:'代表项目',exact:true}).click();
        const analysis=productPanel.getByRole('region',{name:'市场深度分析',exact:true});
        await analysis.getByRole('button',{name:'市场深度分析与区域比较',exact:true}).click();
        await exactAnalysisSelect(analysis,'查询季度');
        const product=await exactAnalysisSelect(analysis,'产品范围');
        await product.selectOption('park');
        const distribution=analysis.getByRole('region',{name:'租金价格分布',exact:true});
        await distribution.getByText(market==='上地'?'10 个楼宇样本 · 元/㎡/月':'5 个楼宇样本 · 元/㎡/月',{exact:true}).waitFor();
        await analysis.getByRole('img',{name:'同季度楼宇净有效租金与空置率散点图',exact:true}).locator('canvas').waitFor();
        assert.equal(await product.inputValue(),'park');
        await analysis.getByRole('button',{name:'收起市场深度分析',exact:true}).click();
      }
      await assertMapReady();
    }
    await openResearch();await openTabbedReading();
  }
  return {width,height:page.viewportSize().height,identityOnlyExpandedForReading:identityOnly,coreMetricsFirst:true,primaryActionInTitleRow:true,
    structuredCbdCoreFirst:true,structuredCbdThematicRows:true,structuredCbdNoHorizontalOverflow:true,
    overviewCompositionAndPublishedIntro:true,adaptiveMapBudget,fullReadingPreservesMapCanvas:true,trendTabPreserved:true,
    canvasRendered:true,gradeNavigation:true,keyboardQuarterTable:true,zeroAndMissingRemainDistinct:true,tableFitsPanel:true,
    representativeProjectRoundTripPreservesTab:true,listRoundTripPreservesRegion:true,settledEmptyTrendUsesContentHeight:true};
}
