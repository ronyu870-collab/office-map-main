import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import JSZip from 'jszip';
export async function verifyPitchEcosystem({app,owner,other,scope,call,check,until}){
 const workspace=async(who,input,write=true)=>{const response=await fetch(app+'/api/intelligence/pitch/workspace'+(write?'':'?'+new URLSearchParams(input)),{method:write?'POST':'GET',headers:{Authorization:'Bearer '+who.token,...(write?{'Content-Type':'application/json'}:{})},...(write?{body:JSON.stringify(input)}:{})});return {status:response.status,body:await response.json()};};
 await check('ecosystem real HTTP registers expanded catalog, renders business examples and runs an entire durable demo kit',async()=>{
  const catalogResponse=await fetch(app+'/api/intelligence/pitch/business?action=catalog',{headers:{Authorization:'Bearer '+owner.token}});assert.equal(catalogResponse.status,200);const catalog=await catalogResponse.json();assert.equal(catalog.recipes.length,95);
  const thumbnail=await workspace(other,{action:'thumbnail',templateId:'mandate-summary'},false);assert.equal(thumbnail.status,200);assert.ok(thumbnail.body.example);assert.match(thumbnail.body.svg,/<svg/);
  const projectId=randomUUID(),created=await workspace(owner,{action:'create',projectId,title:'隔离 1.1 套装演示',scope,themeId:'colliers-default-v1',themeVersion:2,context:{language:'zh',period:'2026-Q1'}});assert.equal(created.status,200,JSON.stringify(created.body));
  const taskId=randomUUID(),ids=['mandate-summary','building-photo-overview','market-dashboard','leasing-strategy','leasing-audience','leasing-channel-plan','leasing-campaign','delivery-leadership','commercial-fee-basis','decision-request'];
  const queued=await workspace(owner,{action:'start',projectId,expectedVersion:created.body.project.version,taskId,part:{mode:'example',kit:{id:'leasing-agency',version:1},templateIds:ids},replaceIds:[]});assert.equal(queued.status,202,JSON.stringify(queued.body));
  await until(async()=>{const receipt=await workspace(owner,{action:'status',projectId,taskId});assert.equal(receipt.status,200);assert.notEqual(receipt.body.state,'failed',JSON.stringify(receipt.body));return receipt.body.state==='completed';},'complete ecosystem kit');
  const reopened=await workspace(owner,{action:'get',projectId});assert.equal(reopened.status,200);assert.ok(reopened.body.slides.length>=10);for(const id of ids)assert.ok(reopened.body.slides.some(s=>s.content.sources.some(source=>source.locator==='template-example:'+id)));
  assert.equal((await workspace(other,{action:'get',projectId})).status,403);
  const exportId=randomUUID();assert.equal((await call(owner,{action:'export_start',projectId,exportId,audience:'client',format:'pptx'},true)).status,403);assert.equal((await call(owner,{action:'export_start',projectId,exportId,audience:'internal',format:'pptx'},true)).status,202);
  await until(async()=>{const receipt=await call(owner,{action:'export_status',projectId,exportId});assert.notEqual(receipt.body.state,'failed',JSON.stringify(receipt.body));return receipt.body.state==='ready';},'ecosystem native export');const file=await call(owner,{action:'download',projectId,exportId,audience:'internal'});assert.equal(file.status,200);const zip=await JSZip.loadAsync(file.body);// PptxGenJS increments its chart counter across decks in one server process.
  const charts=Object.keys(zip.files).filter(name=>/^ppt\/charts\/chart\d+[.]xml$/.test(name));
  assert.ok(charts.length>0,'Native chart parts required');
  for(const name of charts)assert.match(await zip.file(name).async('string'),/<c:chartSpace/);
  const slideXml=(await Promise.all(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+[.]xml$/.test(name)).map(name=>zip.file(name).async('string')))).join('');
  assert.match(slideXml,/<c:chart /);assert.match(await zip.file('ppt/slides/slide1.xml').async('string'),/<a:t>/);
 });
}
