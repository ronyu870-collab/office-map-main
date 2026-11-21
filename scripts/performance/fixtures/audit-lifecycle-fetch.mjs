// Isolated production-build probe only. No real remote connection is permitted.
import { appendFileSync } from 'node:fs';
if(process.env.AUDIT_LIFECYCLE_SYNTHETIC!=='yes')throw new Error('Synthetic lifecycle probe only');
const nativeFetch=globalThis.fetch;
const actor='11111111-1111-4111-8111-111111111111';
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(['127.0.0.1','localhost'].includes(url.hostname))return nativeFetch(input,init);
 if(url.origin!=='https://example.supabase.co')throw new Error('Remote connection blocked by synthetic probe');
 const headers=new Headers(init?.headers||input?.headers);const object=headers.get('accept')?.includes('vnd.pgrst.object');
 const json=value=>Response.json(value);
 if(url.pathname==='/auth/v1/user')return json({id:actor,email:'probe@example.test',app_metadata:{},user_metadata:{}});
 if(url.pathname==='/rest/v1/user_roles')return json(object?{role:'viewer'}:[{role:'viewer'}]);
 if(url.pathname==='/rest/v1/buildings')return json(object?{id:actor,name:'Synthetic'}:[{id:actor,name:'Synthetic'}]);
 if(process.env.AUDIT_READING_PROBE==='yes'){
  const fail=process.env.AUDIT_READING_FAIL;
  const event=(kind,payload)=>appendFileSync(process.env.AUDIT_LIFECYCLE_EVENTS,JSON.stringify({kind,payload})+'\n');
  if(url.pathname==='/rest/v1/audit_operation_receipts'){
   const payload=JSON.parse(init.body);event('receipt',payload);await new Promise(resolve=>setTimeout(resolve,25));
   return fail==='receipt'?Response.json({code:'offline'},{status:503}):json([]);
  }
  if(url.pathname==='/rest/v1/rpc/audit_complete_operation'){
   const payload=JSON.parse(init.body);event('complete',payload);await new Promise(resolve=>setTimeout(resolve,25));
   return fail==='completion'?Response.json({code:'offline'},{status:503}):json(true);
  }
  if(url.pathname==='/rest/v1/building_sales_materials'){
   const material={id:actor,title:'Synthetic original',original_location:'cloud',storage_path:actor+'/'+actor+'/original.png',original_name:'original.png',created_at:'2026-11-22T00:00:00Z',details:[]};
   return json(object?material:[material]);
  }
  if(url.pathname.startsWith('/storage/v1/object/sign/'))return json({signedURL:'/object/sign/private/original?token=synthetic-only'});
 }
 if(url.pathname==='/rest/v1/building_photos'){
  const photo={id:actor,caption:'Synthetic',storage_path:process.env.AUDIT_READING_PROBE==='yes'?`building-photos/v1/${actor}/${actor}/exterior.webp`:null,image_url:'https://example.org/photo.jpg',source_url:'https://example.org/source',source_name:'Synthetic'};
  return json(object?photo:[photo]);
 }
 if(url.pathname==='/rest/v1/audit_logs'){
  const started=Date.now();await new Promise(resolve=>setTimeout(resolve,400));
  appendFileSync(process.env.AUDIT_LIFECYCLE_EVENTS,JSON.stringify({started,finished:Date.now(),failed:process.env.AUDIT_LIFECYCLE_FAIL==='yes'})+'\n');
  return process.env.AUDIT_LIFECYCLE_FAIL==='yes'?Response.json({code:'synthetic_failure',message:'injected'},{status:503}):json([]);
 }
 throw new Error('Unconfigured synthetic request: '+url.pathname);
};
