import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { stock, project } from '../performance/fixtures/workspace-data.mjs';
import { clickWorkspaceAction } from './workspace-actions.mjs';

// React updates the page label before PDF.js commits the new bitmap. Wait for
// visible, completed pixels that differ from the previous page and remain stable.
async function waitForPdfBitmap(page, pageNumber, previous = null) {
  return page.evaluate(async ({ pageNumber, previous }) => {
    const deadline = performance.now() + 15000;
    let stable = '', since = 0;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const host = document.querySelector('[data-sales-materials]');
      const canvas = host?.querySelector('canvas');
      const ready = canvas?.getAttribute('aria-label')?.endsWith(`第${pageNumber}页`)
        && getComputedStyle(canvas).display !== 'none'
        && !Array.from(host.querySelectorAll('[role="status"]')).some(node => node.textContent.includes('加载原件'));
      if (!ready) { stable = ''; continue; }
      const bitmap = canvas.toDataURL();
      if (bitmap === previous) { stable = ''; continue; }
      if (bitmap !== stable) { stable = bitmap; since = performance.now(); }
      if (performance.now() - since >= 200) return bitmap;
    }
    throw new Error(`PDF page ${pageNumber} did not finish drawing a stable new bitmap`);
  }, { pageNumber, previous });
}

export async function verifyMaterialReading(page,{width,base}) {
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let index=1;index<=2;index++){const sheet=pdf.addPage([600,800]);sheet.drawText(`Isolated owner material - page ${index}`,{x:40,y:750,size:18,font});sheet.drawText('2026 Q3 | 100.0 RMB/sqm/month | 12.0% vacancy',{x:40,y:700,size:12,font});}
  const bytes=Buffer.from(await pdf.save());
  let pdfReads=0,downloadReads=0,denied=false;
  const material={id:'pdf-material',title:'办公项目资料与业主原件',source:'隔离业主',notes:'',original_name:'owner.pdf',mime_type:'application/pdf',file_size:bytes.length,document_date:null,created_at:'2026-11-21T00:00:00Z',content_types:['availability','commission','brochure']};
  const details=[
    {floor_unit:'A座12层1201–1208 · '+ '连续可租单元与交付信息'.repeat(2),area_sqm:2000,orientation:'东南',delivery_time:'业主确认后交付',delivery_condition:'标准交付；具体条件见原件',asking_rent:100,rent_basis:'month',rent_unit:'sqm',management_fee:30,price_note:'报价与可租状态以业主确认及原件为准',notes:'可按实际租赁方案组合，适用条件仍须向业主确认',source_row_ref:'PDF第1页',timing:{as_of:{value:'2026-11-01',evidence:'隔离业主逐行日期'},confirmed:null}},
    {floor_unit:'B座3层',area_sqm:900,orientation:'北',delivery_time:'',delivery_condition:'',asking_rent:null,rent_basis:'unspecified',rent_unit:'unspecified',management_fee:null,price_note:'报价与可租状态以业主确认及原件为准',notes:'',source_row_ref:'PDF第1页',timing:{as_of:null,confirmed:null}},
    {floor_unit:'C座1层',area_sqm:100,orientation:'',delivery_time:'',delivery_condition:'',asking_rent:0,rent_basis:'day',rent_unit:'sqm',management_fee:0,price_note:'报价与可租状态以业主确认及原件为准',notes:'隔离真实零值回归，不代表生产报价',source_row_ref:'PDF第1页',timing:{as_of:null,confirmed:null}},
  ];
  const commission_policies=[{key:'expired-fixture',title:'隔离佣金方案',scope:'A座办公租赁',summary:'按业主书面政策核算，历史条件保留',basis:'以实际成交租金和有效合同为计算依据',valid_from:'2025-01-01',valid_until:'2025-12-31',validity_note:'示例历史条款，不能当作当前承诺',settlement:'以业主复核及书面结佣条件为准',rules:[{kind:'base',label:'基础佣金',reward:'约定佣金',condition:'仅覆盖业主原件列明范围',applicability:'unconfirmed'}],source_ref:'PDF第2页',notes:['请向业主核对现行适用条件']}];
  await page.route('**/api/map/data?*',route=>new URL(route.request().url()).searchParams.get('mode')==='future'?route.fulfill({json:{future_supplies:[]}}):route.fulfill({json:{buildings:stock,display_overrides:[]}}));
  await page.route('**/api/map/sales-materials?*',route=>{
    const url=new URL(route.request().url());assert.equal(url.searchParams.get('building_id'),project);
    if(denied)return route.fulfill({status:403,json:{error:'当前账号无权读取此项目资料'}});
    if(url.searchParams.get('download')==='1')return ++downloadReads===1?route.fulfill({status:503,json:{error:'下载准备失败'}}):route.fulfill({json:{url:new URL('/__material-download.pdf',base).href}});
    return route.fulfill({json:url.searchParams.has('material_id')?{details,commission_policies,project_facts:[{label:'楼层与面积',value:'标准层约2,000㎡；可租范围以业主原件为准',source_ref:'PDF第1页'},{label:'物业服务',value:'专业物业管理与全天候维护服务',source_ref:'PDF第2页'}],preview_url:new URL('/__material-source.pdf',base).href,download_url:'',provenance:{document_date_evidence:'',received:null,version_recorded_at:material.created_at,source_sha256:'a'.repeat(64)}}:{records:[material],count:1}});
  });
  await page.route('**/__material-source.pdf',route=>++pdfReads===1?route.fulfill({status:503,body:'isolated transport failure'}):route.fulfill({contentType:'application/pdf',body:bytes}));
  await page.route('**/__material-download.pdf',route=>route.fulfill({contentType:'application/pdf',headers:{'content-disposition':'attachment; filename="owner.pdf"'},body:bytes}));
  await page.goto(new URL(`/map?building=${project}`,base).href);
  const detail=page.getByRole('region',{name:'CBD甲楼楼宇详情',exact:true});await detail.waitFor();
  if(width<640||width===844)await clickWorkspaceAction(page,'全屏阅读工作区');
  await detail.getByRole('tab',{name:'成交与资料',exact:true}).click();
  await detail.getByRole('button',{name:'楼书与资料',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByText('标准层约2,000㎡；可租范围以业主原件为准',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:`/tmp/map-material-structure-${width}.png`});
  await dialog.getByRole('button',{name:'查看原件',exact:true}).click();
  await dialog.getByRole('alert').filter({hasText:'PDF 原件加载失败'}).waitFor();
  await dialog.getByRole('button',{name:'重试',exact:true}).click();
  const pageNumber=dialog.getByRole('combobox',{name:'PDF页码'});
  const firstBitmap = await waitForPdfBitmap(page,1);
  assert.equal(await pageNumber.inputValue(),'1');
  await dialog.getByRole('button',{name:'下一页',exact:true}).click();
  const secondBitmap = await waitForPdfBitmap(page,2,firstBitmap);
  assert.notEqual(secondBitmap,firstBitmap,'page 2 must replace page 1 pixels');
  assert.equal(await pageNumber.inputValue(),'2');
  const pixels=await dialog.locator('canvas').evaluate(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4!==3 && v<200));assert.ok(pixels,'actual PDF renderer paints source content');
  await page.screenshot({animations:'disabled',path:`/tmp/map-material-pdf-${width}.png`});
  await dialog.getByRole('button',{name:'下载原件',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'下载未完成，请重试'}).waitFor();
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载原件',exact:true}).click();await(await download).cancel();
  denied=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await dialog.getByRole('alert').filter({hasText:'当前账号无权读取此项目资料'}).waitFor();
  assert.equal(await dialog.locator('canvas').count(),0,'denied refreshed access removes previous PDF canvas');
  denied=false;await dialog.getByRole('button',{name:'重试',exact:true}).click();
  await waitForPdfBitmap(page,1);
  await dialog.getByRole('button',{name:'返回项目资料',exact:true}).click();
  await dialog.getByText('标准层约2,000㎡；可租范围以业主原件为准',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'房源',exact:true}).click();
  const availability=dialog.getByRole('region',{name:'可租房源',exact:true});await availability.waitFor();
  assert.equal(await availability.getByRole('article').count(),3);
  await availability.getByRole('article').nth(1).getByText('未提供报价',{exact:true}).waitFor();
  await availability.getByRole('article').nth(2).getByText('0 元/㎡/月',{exact:true}).waitFor();
  await availability.getByRole('article').first().getByRole('button',{name:/时间来源/}).click();
  await availability.getByText('依据：隔离业主逐行日期',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:`/tmp/map-material-availability-${width}.png`});
  await dialog.getByRole('button',{name:'佣金政策',exact:true}).click();
  await dialog.getByText('已过期',{exact:true}).waitFor();
  const disclosure=dialog.locator('details').filter({has:page.locator('summary',{hasText:'佣金明细'})}).locator('summary');
  await disclosure.focus();await page.keyboard.press('Enter');
  await dialog.getByText('适用条件待确认',{exact:true}).waitFor();
  await dialog.getByText('来源：PDF第2页',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:`/tmp/map-material-commission-${width}.png`});
  assert.ok(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'material content fits dialog');
  await dialog.getByRole('button',{name:'关闭销控',exact:true}).click();await detail.waitFor();
  assert.equal(await detail.getByRole('tab',{name:'成交与资料',exact:true}).getAttribute('aria-selected'),'true');
  return {width,availabilityZeroAndMissingDistinct:true,mixedRowDatesTraceable:true,expiredCommissionAndUnknownApplicabilityVisible:true,actualPdfBytesRendered:true,pdfTransportRetry:true,pdfPageSelection:true,distinctStablePageBitmaps:true,downloadRetry:true,refreshedDenialRemovesCanvas:true,accessRetryRetainsProject:true,pdfReads,downloadReads};
}
