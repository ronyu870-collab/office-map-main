import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quote = value => "'" + value.replaceAll("'", "''") + "'";

/** DBA-operated, explicit one-account activation. Does not discover recipients,
 * execute SQL, change business records, seed roles, or renew existing grants. */
export function buildExistingAdminEnablement(input) {
  if (!input || Object.keys(input).sort().join() !== 'actorId,changeReference,documentIds,expectedRevision'
    || !uuid.test(input.actorId) || !uuid.test(input.expectedRevision)
    || typeof input.changeReference !== 'string' || input.changeReference.length < 1 || input.changeReference.length > 500
    || input.changeReference.includes('$ai5_enable$') || input.changeReference.includes('\0')
    || !Array.isArray(input.documentIds) || input.documentIds.length > 100
    || input.documentIds.some(id => typeof id !== 'string' || !uuid.test(id))
    || new Set(input.documentIds.map(id => id.toLowerCase())).size !== input.documentIds.length) throw new Error('INVALID_AI5_ENABLEMENT');
  const docs = 'ARRAY[' + input.documentIds.map(id => quote(id) + '::uuid').join(',') + ']::uuid[]';
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $ai5_enable$
declare g private.ai_query_grants; docs uuid[] := ${docs}; ref text := ${quote(input.changeReference)};
begin
 select * into g from private.ai_query_grants where user_id=${quote(input.actorId)}::uuid for share;
 if not found or not g.enabled or g.valid_until<=clock_timestamp()
  or g.revision<>${quote(input.expectedRevision)}::uuid or not('query:catalog'=any(g.capabilities))
  or not exists(select 1 from private.ai_query_control where singleton and enabled)
  or not exists(select 1 from public.user_roles r join auth.users u on u.id=r.user_id
    where r.user_id=g.user_id and r.role='admin' and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()))
 then raise exception 'AI5_EXISTING_ADMIN_REQUIRED'; end if;
 if exists(select 1 from private.ai_lease_research_grants where user_id=g.user_id)
  or exists(select 1 from private.ai_business_research_grants where user_id=g.user_id)
  or exists(select 1 from private.ai_knowledge_grants where user_id=g.user_id)
 then raise exception 'AI5_GRANT_ALREADY_EXISTS'; end if;
 -- Explicit selected originals only; never grant the first N documents or an
 -- entire bucket. Scope and availability are checked again at every runtime read.
 if exists(select 1 from unnest(docs) d where not exists(
  select 1 from public.building_sales_materials m join public.buildings b on b.id=m.building_id
  where m.id=d and m.status='ready' and m.association_status='confirmed'
   and m.original_location='cloud' and m.storage_path is not null
   and m.file_size between 1 and 25165824 and m.source_sha256 ~ '^[0-9a-f]{64}$'
   and m.mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation')
   and b.is_active and b.tracking_scope='tracked' and b.merged_into_id is null
   and (g.all_buildings or b.id=any(g.building_ids)) and (g.all_submarkets or b.submarket=any(g.submarkets))))
 then raise exception 'AI5_DOCUMENT_NOT_AUTHORIZED'; end if;
 insert into private.ai_lease_research_grants(user_id,enabled,valid_until,sources,allow_details,allow_financials,allow_export,min_group_size,all_submarkets,submarkets,all_buildings,building_ids,change_reference)
 values(g.user_id,true,g.valid_until,array['live','history'],false,false,'export:internal'=any(g.capabilities),3,g.all_submarkets,g.submarkets,g.all_buildings,g.building_ids,ref);
 insert into private.ai_business_research_grants(user_id,enabled,valid_until,modules,profile_fields,allow_submissions,allow_export,all_submarkets,submarkets,all_buildings,building_ids,change_reference)
 values(g.user_id,true,g.valid_until,array['profile','submarket','supply','stacking'],
  array['district','submarket','grade','completionYear','leasableArea','address','brochureDistrict','completionDate','gfaTotal','gfaOffice','standardFloorArea','height','floors','floorsAbove','floorsBelow','parking','metro','leed','well','greenStandard','propertyManagement','delivery','elevators','telecom','hvac','availablePeriods'],
  'query:quarter'=any(g.capabilities),'export:internal'=any(g.capabilities),g.all_submarkets,g.submarkets,g.all_buildings,g.building_ids,ref);
 insert into private.ai_knowledge_grants(user_id,enabled,valid_until,document_ids,allow_public_search,change_reference)
 values(g.user_id,true,g.valid_until,docs,false,ref);
end $ai5_enable$;
commit;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/intelligence/ai5-enablement.mjs <reviewed-plan.json>');
  process.stdout.write(buildExistingAdminEnablement(JSON.parse(await readFile(process.argv[2], 'utf8'))));
}
