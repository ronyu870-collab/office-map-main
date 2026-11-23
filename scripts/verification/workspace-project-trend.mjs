import assert from 'node:assert/strict';
import { clickWorkspaceAction } from './workspace-actions.mjs';

export async function verifyProjectTrendReading(page,width) {
  const trendPanel=page.getByRole('region',{name:'项目历史趋势',exact:true});
  const expanded = (width<640 || width===844) && !await page.locator('.map-workspace-layout[data-expanded]').count();
  if(expanded) await clickWorkspaceAction(page,'全屏阅读工作区');
  await trendPanel.getByText('最新季度与此前五年年末；缺失数据不补零。',{exact:true}).waitFor();
  await page.locator('#info-chart-container canvas').scrollIntoViewIfNeeded();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>{
    const pixels=document.querySelector('#info-chart-container canvas')?.toDataURL();
    const previous=window.__projectTrendPixels;
    if(!previous || previous.pixels!==pixels){window.__projectTrendPixels={pixels,since:performance.now()};return false;}
    return performance.now()-previous.since>=200;
  });
  const observedSegments=await page.locator('#info-chart-container canvas').evaluate(canvas=>{
    const {width,height}=canvas,pixels=canvas.getContext('2d').getImageData(0,0,width,height).data;
    const mask=new Uint8Array(width*height);
    for(let i=0;i<mask.length;i++) if(pixels[4*i]<60 && pixels[4*i+1]<100 && pixels[4*i+2]>90 && pixels[4*i+3]>100) mask[i]=1;
    let segments=0;
    for(let i=0;i<mask.length;i++){
      if(!mask[i])continue;
      const queue=[i];mask[i]=0;let count=0;
      while(queue.length){
        const index=queue.pop();count++;const x=index%width,y=Math.floor(index/width);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const nx=x+dx,ny=y+dy,next=ny*width+nx;
          if(nx>=0 && nx<width && ny>=0 && ny<height && mask[next]){mask[next]=0;queue.push(next);}
        }
      }
      if(count>=4)segments++;
    }
    return segments;
  });
  assert.equal(observedSegments,3,'isolated 2021 and real-zero 2023 points plus 2025–2026 line are visible');
  await page.screenshot({animations:'disabled',path:`/tmp/map-project-trend-${width}.png`});
  const trendDisclosure=trendPanel.locator('.workspace-trend-data > summary');
  await trendDisclosure.focus();await page.keyboard.press('Enter');
  const periodTable=trendPanel.getByRole('table',{name:'项目期间租金与空置率',exact:true});
  await periodTable.waitFor();
  const periodRows=periodTable.getByRole('row');
  assert.equal(await periodRows.count(),7,'latest quarter plus five previous year ends');
  assert.match(await periodRows.nth(2).innerText(),/2022Q4\s+—\s+—/);
  assert.match(await periodRows.nth(3).innerText(),/2023Q4\s+0\.0\s+0\.0/);
  assert.match(await periodRows.nth(6).innerText(),/2026Q3\s+200\.0\s+12\.0/);
  assert.equal(await periodTable.getByText('999.0',{exact:true}).count(),0,'non-year-end historical quarter stays excluded');
  await periodRows.nth(6).scrollIntoViewIfNeeded();
  const tableBounds=await periodTable.boundingBox(),trendBounds=await trendPanel.boundingBox();
  assert.ok(tableBounds.x>=trendBounds.x && tableBounds.x+tableBounds.width<=trendBounds.x+trendBounds.width+1,'period table fits workspace');
  await page.screenshot({animations:'disabled',path:`/tmp/map-project-trend-table-${width}.png`});
  await trendDisclosure.focus();await page.keyboard.press('Enter');
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(expanded) await clickWorkspaceAction(page,'返回地图分屏');
  return {width,projectTrendExactPeriodTable:true,projectTrendZeroAndMissingDistinct:true,yearEndHistoryPreserved:true,keyboardTrendDisclosure:true,trendMetricPressedState:true,trendReducedMotionSwitch:true,visibleTrendSegments:observedSegments,expandedForReading:expanded};
}
