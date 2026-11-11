// Bundle the actual submission service and audited shared client for execution in a real
// logged-in browser. This is a test entrypoint only; no auth, SQL, HTTP or service mocks.
import assert from 'node:assert/strict';
import { rolldown } from 'rolldown';
export async function leaseServiceBrowserBundle(root, settings) {
  assert.equal(settings.API_URL, 'http://127.0.0.1:55791');
  const entry='\0f6-real-submission';
  const bundle=await rolldown({
    input:entry, platform:'browser', resolve:{alias:{'@':root}},
    transform:{define:{'process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify(settings.API_URL),'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(settings.ANON_KEY),'process.env.NODE_ENV':'"production"'}},
    plugins:[{name:'actual-f6-submission-entry',resolveId(id){if(id===entry)return id;},load(id){if(id===entry)return `export { submitTransaction, updateTransaction } from ${JSON.stringify(root+'/src/services/leaseTransactionSubmitService.ts')}; export { getSupabaseClient } from ${JSON.stringify(root+'/src/services/supabaseClient.ts')};`;}}],
  });
  try {const {output}=await bundle.generate({format:'iife',name:'F6ActualSubmission'});return output.find(file=>file.type==='chunk').code;}
  finally {await bundle.close();}
}
