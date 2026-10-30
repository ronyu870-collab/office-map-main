import assert from 'node:assert/strict';
import{importToSupabase}from'./ingest.mjs';
import{sha256}from'./local-store.mjs';
const bytes=Buffer.from('synthetic original');const bid='11111111-1111-4111-8111-111111111111';
const manifest={building_id:bid,building_name:'合成楼宇',title:'历史佣金',document_date:null,source:'合成',notes:'',series_key:'history',scope_label:'历史',content_types:['commission'],details:[],commission_policies:[{key:'old',summary:'2个月'}],project_facts:[],association_status:'confirmed',association_note:'',historical_context:{period_label:'日期未知',evidence:'合成',not_current:true},extraction:{method:'codex-document',source_sha256:sha256(bytes),reviewed:true,historical_import_authorized:true}};
let stored=null;let storageCalls=0;let writes=0;
const client={storage:{from(){storageCalls++;throw Error('must not access Storage');}},from(table){
 if(table==='audit_logs')return{insert:async()=>({error:null})};
 const chain={select(){return this;},eq(){return this;},async maybeSingle(){return{data:table==='buildings'?{id:bid,name:'合成楼宇'}:stored,error:null};},async insert(row){stored={...row};writes++;return{error:null};},update(patch){Object.assign(stored,patch);writes++;return this;}};
 return chain;
}};
const first=await importToSupabase(manifest,bytes,'application/pdf','synthetic.pdf',client,true,'local_archive');
assert.equal(first.duplicate,false);assert.equal(stored.status,'ready');assert.equal(stored.storage_path,null);assert.equal(stored.original_location,'local_archive');assert.equal(stored.archive_reference,'sha256:'+sha256(bytes));assert.equal(stored.document_date,null);assert.equal(storageCalls,0);
const duplicate=await importToSupabase(manifest,bytes,'application/pdf','synthetic.pdf',client,true,'local_archive');assert.equal(duplicate.id,first.id);assert.equal(duplicate.duplicate,true);assert.equal(writes,2);
await assert.rejects(importToSupabase({...manifest,historical_context:null},bytes,'application/pdf','synthetic.pdf',client,true,'local_archive'),/仅已授权历史资料/);
await assert.rejects(importToSupabase({...manifest,extraction:{...manifest.extraction,historical_import_authorized:false}},bytes,'application/pdf','synthetic.pdf',client,true,'local_archive'),/仅已授权历史资料/);
assert.equal(storageCalls,0);console.log('PASS data-only ingestion: no Storage, ready data, immutable archive hash, unknown date, retry deduplication, current-data refusal.');
