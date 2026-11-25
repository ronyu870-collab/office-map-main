// Installs actual reviewed source SQL and deterministic rows in a DISPOSABLE DB.
import {readFile} from 'node:fs/promises';
import {addSnapshotFixture} from '../ai-query-authority/snapshot-fixture.mjs';
import {installAi5QuarterlyFixture} from '../ai-query-authority/ai5-fixture.mjs';
export async function installPitchDataFixture(db) {
 const load=file=>readFile(new URL('../../migrations/'+file,import.meta.url),'utf8');
 for(const file of ['20261113003933_ai_query_audit_foundation.sql','20261113023341_ai_query_authority.sql','20261113063257_ai_query_internal_export_grant.sql'])await db.setup.query(await load(file));
 // Keep the exact current admin-only authority; other audit-console functions are outside this fixture.
 const admin=await load('20261113123123_ai_admin_only_access.sql');
 await db.setup.query(admin.slice(admin.indexOf('create or replace function private.ai_query_authority'),admin.indexOf('create or replace function private.ai_audit_console_authority')));
 await db.setup.query('create or replace function private.is_admin() returns boolean language sql stable security definer set search_path=\'\' as $$select exists(select 1 from public.user_roles where user_id=auth.uid() and role=\'admin\')$$');
 await addSnapshotFixture(db);await installAi5QuarterlyFixture(db.setup,load);
}
